"""
API FastAPI — données Analytics + prédictions ML
"""

import ast
import asyncio
import json
import os
import pickle
import re
import sys
import warnings
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional

# Charge .env si présent (clés API locales)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # python-dotenv optionnel — variables d'env suffisent en prod

import requests as http_requests

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.feature_extraction import FeatureHasher
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import OneHotEncoder

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).parent / "pipeline"))

from config import CLEANED_ANALYTICS_PARQUET
from logger_config import setup_logger

logger = setup_logger(__name__)
app = FastAPI(title="PoliGraph API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT_DIR      = Path(__file__).parent
MODELS_DIR    = ROOT_DIR / "output/models"
VECTORS_DIR   = ROOT_DIR / "output/vectors"
ANALYTICS_DIR = ROOT_DIR / "output/analytics"

# État global
df               = None
_models          = {}
_feature_consumer = None
_raw_consumer     = None


# ============================================================
# Startup
# ============================================================

@app.on_event("startup")
def start_kafka_consumer():
    import threading
    global _feature_consumer, _raw_consumer
    kafka_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS")
    if kafka_servers:
        try:
            from streaming.consumer import FeatureConsumer
            _feature_consumer = FeatureConsumer(kafka_servers, topic="features")
            _feature_consumer.start()
            _raw_consumer = FeatureConsumer(kafka_servers, topic="raw-articles")
            _raw_consumer.start()
            logger.info(f"[API] Kafka consumers démarrés → {kafka_servers}")

            # Snapshot Parquet toutes les 5 min → utilisé par predict.py --live-sentiment
            _snapshot_path = str(ROOT_DIR / "output" / "stream_snapshot.parquet")

            def _snapshot_loop():
                import time
                while True:
                    time.sleep(300)
                    try:
                        _feature_consumer.dump_snapshot(_snapshot_path)
                    except Exception as exc:
                        logger.debug(f"Snapshot : {exc}")

            threading.Thread(target=_snapshot_loop, daemon=True,
                             name="snapshot-writer").start()

        except Exception as exc:
            logger.warning(f"[API] Kafka consumers non démarrés (mode dégradé) : {exc}")


@app.on_event("startup")
def load_data():
    global df
    # Priorité : parquet → CSV analytics → CSV data → DataFrame vide
    sc_path = ANALYTICS_DIR / "scandales_features.csv"
    if sc_path.exists():
        df = pd.read_csv(sc_path, low_memory=False)
        logger.info(f"[API] Données chargées depuis scandales_features.csv : {len(df)} lignes")
        return
    try:
        df = pd.read_parquet(CLEANED_ANALYTICS_PARQUET)
        logger.info(f"[API] Données chargées depuis parquet : {len(df)} lignes")
    except Exception as e:
        logger.warning(f"[API] Parquet introuvable : {e}")
        csv_path = ROOT_DIR / "data/cleaned_analytics.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path, low_memory=False)
            logger.info(f"[API] Données chargées depuis CSV data : {len(df)} lignes")
        else:
            df = pd.DataFrame()
            logger.warning("[API] Aucune donnée trouvée — DataFrame vide")


def get_model(name: str):
    if name not in _models:
        path = MODELS_DIR / f"{name}.pkl"
        if not path.exists():
            raise HTTPException(status_code=503, detail=f"Modèle {name} non disponible. Lance le pipeline d'abord.")
        with open(path, "rb") as f:
            obj = pickle.load(f)
        _models[name] = obj if isinstance(obj, dict) else {"model": obj, "label_encoder": None}
    return _models[name]["model"], _models[name]["label_encoder"]


# ============================================================
# Helpers vecteurs
# ============================================================

def build_scandale_vector(category=None, party=None, status=None,
                           institution=None, annee=None, description=""):
    df_ref = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
    with open(VECTORS_DIR / "scandales_vectors_features.json", encoding="utf-8") as f:
        feat_names = json.load(f)["features"]

    feat_idx = {name: i for i, name in enumerate(feat_names)}
    x = np.zeros((1, len(feat_names)))

    for value, prefix in [(party, "party_short"), (category, "category"), (status, "status")]:
        if value:
            key = f"{prefix}_{value}"
            if key in feat_idx:
                x[0, feat_idx[key]] = 1.0

    if institution:
        hasher = FeatureHasher(n_features=128, input_type="string")
        x_hash = hasher.transform([[institution]]).toarray()[0]
        hash_start = next((i for i, n in enumerate(feat_names) if n.startswith("hash_")), None)
        if hash_start is not None:
            x[0, hash_start:hash_start + 128] = x_hash

    if annee:
        col = pd.to_numeric(df_ref["annee_faits"], errors="coerce").dropna()
        if len(col) > 0 and col.std() > 0 and "annee_faits" in feat_idx:
            x[0, feat_idx["annee_faits"]] = (annee - col.mean()) / col.std()

    if description:
        tfidf = TfidfVectorizer(max_features=150, min_df=2,
                                 strip_accents="unicode", sublinear_tf=True)
        tfidf.fit(df_ref["description"].fillna("").astype(str))
        x_tfidf = tfidf.transform([description]).toarray()[0]
        for j, token in enumerate(tfidf.get_feature_names_out()):
            fname = f"tfidf_{token}"
            if fname in feat_idx:
                x[0, feat_idx[fname]] = x_tfidf[j]

    return x


def adapt_vector(x, model):
    n = model.n_features_in_ if hasattr(model, "n_features_in_") else x.shape[1]
    if x.shape[1] < n:
        return np.hstack([x, np.zeros((1, n - x.shape[1]))])
    return x[:, :n]


# ============================================================
# Routes Analytics existantes
# ============================================================

@app.get("/api/health")
def health():
    return {"status": "ok", "rows": int(len(df)) if df is not None else 0}


@app.get("/api/data")
def api_data(limit: int = 100, offset: int = 0):
    result = df.iloc[offset: offset + limit]
    return {"total": int(len(df)), "limit": limit, "offset": offset,
            "data": result.to_dict(orient="records")}


# ============================================================
# Recherche type SQL
# ============================================================

@app.get("/api/search/filters")
def search_filters():
    """Valeurs disponibles pour les menus déroulants."""
    sc = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
    vt = pd.read_csv(ANALYTICS_DIR / "votes_features.csv",     low_memory=False)
    return {
        "categories": sorted(sc["category"].dropna().unique().tolist()),
        "partis":     sorted(sc["party_short"].dropna().unique().tolist()),
        "statuts":    sorted(sc["status"].dropna().unique().tolist()),
        "resultats":  sorted(vt["result"].dropna().unique().tolist()),
    }


@app.get("/api/search/scandales")
def search_scandales(
    q:          str  = "",
    category:   str  = "",
    parti:      str  = "",
    statut:     str  = "",
    annee_min:  int  = 0,
    annee_max:  int  = 9999,
    limit:      int  = 20,
    offset:     int  = 0,
):
    sc = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)

    if q:
        mask = (
            sc["title"].fillna("").str.contains(q, case=False, na=False) |
            sc["description"].fillna("").str.contains(q, case=False, na=False) |
            sc["politician_name"].fillna("").str.contains(q, case=False, na=False)
        )
        sc = sc[mask]
    if category:
        sc = sc[sc["category"] == category]
    if parti:
        sc = sc[sc["party_short"] == parti]
    if statut:
        sc = sc[sc["status"] == statut]
    if annee_min > 0:
        sc = sc[pd.to_numeric(sc["annee_faits"], errors="coerce").fillna(0) >= annee_min]
    if annee_max < 9999:
        sc = sc[pd.to_numeric(sc["annee_faits"], errors="coerce").fillna(9999) <= annee_max]

    total = len(sc)
    cols  = ["title", "category", "status", "politician_name", "party_short",
             "annee_faits", "institution", "sentence", "appeal", "description"]
    cols  = [c for c in cols if c in sc.columns]
    page  = sc[cols].iloc[offset: offset + limit].fillna("").to_dict(orient="records")

    return {"total": total, "limit": limit, "offset": offset, "data": page}


@app.get("/api/search/votes")
def search_votes(
    q:       str = "",
    result:  str = "",
    annee:   int = 0,
    limit:   int = 20,
    offset:  int = 0,
):
    vt = pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)

    if q:
        vt = vt[vt["title"].fillna("").str.contains(q, case=False, na=False)]
    if result:
        vt = vt[vt["result"] == result]
    if annee > 0:
        vt = vt[pd.to_numeric(vt["annee_vote"], errors="coerce").fillna(0) == annee]

    total = len(vt)
    cols  = ["title", "result", "annee_vote", "legislature",
             "votesFor", "votesAgainst", "votesAbstain", "totalVotes", "sourceUrl"]
    cols  = [c for c in cols if c in vt.columns]
    page  = vt[cols].iloc[offset: offset + limit].fillna("").to_dict(orient="records")

    return {"total": total, "limit": limit, "offset": offset, "data": page}


@app.get("/api/metrics")
def api_metrics():
    missing_pct = (df.isnull().sum().sum() / (len(df) * len(df.columns))) * 100
    return {
        "total_records": int(len(df)),
        "total_columns": int(len(df.columns)),
        "duplicates": int(df.duplicated().sum()),
        "missing_percent": round(missing_pct, 2),
    }


@app.get("/api/themes")
def api_themes():
    keywords = {
        "politique":      ["parti", "groupe", "fonction", "mandat"],
        "judiciaire":     ["affaire", "judiciaire", "proces", "condamnation"],
        "factcheck":      ["fact", "check", "verite", "faux"],
        "transparence":   ["transparence", "declaration", "patrimoine"],
    }
    result = {}
    for theme, ks in keywords.items():
        for col in df.columns:
            if any(k in col.lower() for k in ks):
                result[theme] = {"column": col, "unique": int(df[col].nunique()),
                                  "missing": int(df[col].isnull().sum())}
                break
    return result


# ============================================================
# Helpers dashboard
# ============================================================

DASHBOARD_DIR = ROOT_DIR / "output/dashboard"


def load_dashboard(name: str) -> dict:
    path = DASHBOARD_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{name}.json introuvable")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clean_parti_keys(d: dict) -> dict:
    """Convertit les clés de type "{'shortName': 'RN', ...}" en 'RN'."""
    result = {}
    for k, v in d.items():
        try:
            parsed = ast.literal_eval(k)
            label = parsed.get("shortName") or parsed.get("name", k)
        except Exception:
            label = k
        result[label] = v
    return result


# ============================================================
# Routes dashboard
# ============================================================

@app.get("/api/dashboard/scandales")
def dashboard_scandales():
    sc = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
    par_annee = (
        sc["annee_faits"].dropna()
        .pipe(lambda s: pd.to_numeric(s, errors="coerce").dropna())
        .astype(int).astype(str)
        .value_counts().sort_index().to_dict()
    )
    return {
        "total":         len(sc),
        "par_annee":     par_annee,
        "par_categorie": sc["category"].value_counts().to_dict(),
        "par_parti":     sc["party_short"].value_counts().head(15).to_dict(),
        "par_statut":    sc["status"].value_counts().to_dict(),
    }


@app.get("/api/dashboard/votes")
def dashboard_votes():
    vt = pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)
    resultats = vt["result"].value_counts().to_dict()
    par_annee = (
        vt["annee_vote"].dropna()
        .pipe(lambda s: pd.to_numeric(s, errors="coerce").dropna())
        .astype(int).astype(str)
        .value_counts().sort_index().to_dict()
    )
    return {
        "total":     len(vt),
        "resultats": resultats,
        "par_annee": par_annee,
        "moyenne_pour":    round(float(pd.to_numeric(vt["votesFor"], errors="coerce").mean() or 0), 1),
        "moyenne_contre":  round(float(pd.to_numeric(vt["votesAgainst"], errors="coerce").mean() or 0), 1),
        "moyenne_abstain": round(float(pd.to_numeric(vt["votesAbstain"], errors="coerce").mean() or 0), 1),
    }


@app.get("/api/dashboard/partis")
def dashboard_partis():
    el_path = ANALYTICS_DIR / "elus_features.csv"
    if el_path.exists():
        el = pd.read_csv(el_path, low_memory=False)
        par_pos = el["position_politique"].value_counts().to_dict() if "position_politique" in el.columns else {}
        return {"total": int(el["party_short"].nunique()), "par_position": par_pos}
    d = load_dashboard("partis")
    return {"total": d.get("total_partis", 0), "par_position": d.get("par_position", {})}


@app.get("/api/dashboard/elus")
def dashboard_elus():
    el_path = ANALYTICS_DIR / "elus_features.csv"
    if el_path.exists():
        el = pd.read_csv(el_path, low_memory=False)
        par_inst = el["institution"].value_counts().head(10).to_dict() if "institution" in el.columns else {}
        return {
            "total":           len(el),
            "par_parti":       el["party_short"].value_counts().head(15).to_dict(),
            "par_institution": par_inst,
        }
    d = load_dashboard("elus")
    return {
        "total":           d.get("total_elus", 0),
        "par_parti":       clean_parti_keys(d.get("par_parti", {})),
        "par_institution": d.get("par_institution", {}),
    }


@app.get("/api/dashboard/mining")
def dashboard_mining():
    g = load_dashboard("mining_global")
    j = load_dashboard("mining_judiciaire")
    p = load_dashboard("mining_politique")
    return {
        "scandales_par_annee":     g.get("scandales_par_annee", {}),
        "scandales_par_categorie": g.get("scandales_par_categorie", {}),
        "scandales_par_parti":     clean_parti_keys(g.get("scandales_par_parti", {})),
        "statuts":                 j.get("statuts", {}),
        "statut_par_categorie":    j.get("statut_par_categorie", {}),
        "partis":                  clean_parti_keys(p.get("partis", {})),
        "parti_par_categorie":     {
            clean_parti_keys({k: 1}).popitem()[0] if isinstance(k, str) and k.startswith("{") else k: v
            for k, v in p.get("parti_par_categorie", {}).items()
        },
    }


# ============================================================
# Routes ML — Prédictions
# ============================================================

class VoteRequest(BaseModel):
    title: str
    annee: int = 2025
    legislature: int = 17


class CategoryRequest(BaseModel):
    party: str = "RN"
    annee: int = 2024
    institution: str = "Assemblée nationale"
    description: str = ""


class PoliticianRequest(BaseModel):
    category: str = "CORRUPTION"
    party: str = "RN"
    status: str = "ENQUETE_PRELIMINAIRE"
    top_n: int = 5




@app.post("/api/predict/category")
def predict_category(req: CategoryRequest):
    model, le = get_model("model_category")
    x = adapt_vector(
        build_scandale_vector(party=req.party, institution=req.institution,
                               annee=req.annee, description=req.description),
        model
    )
    proba = model.predict_proba(x)[0]
    pred  = le.inverse_transform([model.predict(x)[0]])[0]
    top5  = sorted(zip(le.classes_.tolist(), proba.tolist()), key=lambda t: -t[1])[:5]

    return {
        "prediction": pred,
        "top5": [{"category": c, "probability": round(p, 4)} for c, p in top5],
    }


@app.post("/api/predict/politician")
def predict_politician(req: PoliticianRequest):
    model, le = get_model("model_politician")
    x = adapt_vector(
        build_scandale_vector(category=req.category, party=req.party, status=req.status),
        model
    )
    proba   = model.predict_proba(x)[0]
    top_idx = np.argsort(proba)[-req.top_n:][::-1]

    return {
        "top": [
            {"name": le.classes_[i], "probability": round(float(proba[i]), 4)}
            for i in top_idx
        ]
    }


# ============================================================
# Proxy Poligraph API
# ============================================================

POLIGRAPH_BASE = "https://poligraph.fr/api"
PROXY_HEADERS  = {"User-Agent": "PoliGraphApp/1.0"}


def _pg(path: str, params: dict = None):
    """Appel générique vers l'API Poligraph avec gestion d'erreur."""
    r = http_requests.get(f"{POLIGRAPH_BASE}/{path}", params=params,
                          headers=PROXY_HEADERS, timeout=15)
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Ressource introuvable")
    r.raise_for_status()
    return r.json()


@app.get("/api/proxy/politiques")
def proxy_politiques(q: str = "", limit: int = 20, page: int = 1):
    params = {"limit": limit, "page": page}
    if q:
        params["search"] = q   # l'API Poligraph utilise "search=" et non "q="
    return _pg("politiques", params)


@app.get("/api/proxy/politiques/{slug}")
def proxy_politiques_detail(slug: str):
    return _pg(f"politiques/{slug}")


@app.get("/api/proxy/politiques/{slug}/affaires")
def proxy_politiques_affaires(slug: str):
    return _pg(f"politiques/{slug}/affaires")


@app.get("/api/proxy/politiques/{slug}/votes")
def proxy_politiques_votes(slug: str, limit: int = 20, page: int = 1):
    return _pg(f"politiques/{slug}/votes", {"limit": limit, "page": page})


@app.get("/api/proxy/politiques/{slug}/relations")
def proxy_politiques_relations(slug: str):
    return _pg(f"politiques/{slug}/relations")


@app.get("/api/proxy/partis")
def proxy_partis(limit: int = 100, page: int = 1):
    return _pg("partis", {"limit": limit, "page": page})


@app.get("/api/proxy/partis/{slug}")
def proxy_partis_detail(slug: str):
    return _pg(f"partis/{slug}")


# ============================================================
# Journal — articles RSS en temps réel
# ============================================================

SOURCE_LABELS = {
    "lemonde":           "Le Monde",
    "lefigaro":          "Le Figaro",
    "liberation":        "Libération",
    "franceinfo":        "France Info",
    "lepoint":           "Le Point",
    "reddit/r/france":   "Reddit · r/france",
    "reddit/r/politique":"Reddit · r/politique",
}

RSS_FEEDS = [
    ("lemonde",    "https://www.lemonde.fr/politique/rss_full.xml"),
    ("lefigaro",   "https://www.lefigaro.fr/rss/figaro_politique.xml"),
    ("liberation", "https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml"),
    ("franceinfo", "https://www.francetvinfo.fr/politique.rss"),
    ("lepoint",    "https://www.lepoint.fr/politique/rss.xml"),
]

REDDIT_FEEDS = [
    ("reddit/r/france",    "https://www.reddit.com/r/france/hot/.rss?limit=25"),
    ("reddit/r/politique", "https://www.reddit.com/r/politique/hot/.rss?limit=25"),
]

_RSS_UA = "PoliGraph/1.0 (https://github.com/poligraph; data engineering portfolio)"

# Cache RSS — évite de re-scraper à chaque requête
_rss_cache: dict = {"articles": [], "fetched_at": 0.0}
_RSS_TTL = 300  # 5 minutes


def _fetch_feed(url: str):
    import feedparser, requests as _r
    try:
        resp = _r.get(url, headers={"User-Agent": _RSS_UA}, timeout=15)
        resp.raise_for_status()
        return feedparser.parse(resp.content)
    except Exception:
        return feedparser.parse(url)


def _strip_html(text: str) -> str:
    """Strip HTML tags and decode entities from a string."""
    if not text:
        return ""
    class _MLStripper(HTMLParser):
        def __init__(self):
            super().__init__()
            self.fed = []
        def handle_data(self, d):
            self.fed.append(d)
        def get_data(self):
            return " ".join(self.fed)
    s = _MLStripper()
    s.feed(text)
    clean = s.get_data()
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def _enrich_with_sentiment(articles: list[dict]) -> list[dict]:
    """Score les articles sans sentiment via sentiment_utils (VADER ou transformers)."""
    to_score = [i for i, a in enumerate(articles) if a.get("sentiment") is None]
    if not to_score:
        return articles
    try:
        sys.path.insert(0, str(ROOT_DIR / "pipeline"))
        from sentiment_utils import score_texts_with_labels
        texts = [articles[i]["title"] + " " + articles[i].get("summary", "") for i in to_score]
        scored = score_texts_with_labels(texts)
        for idx, result in zip(to_score, scored):
            articles[idx]["sentiment"]       = round(result["score"], 4)
            articles[idx]["sentiment_label"] = result["label"]
            articles[idx]["enriched"]        = True
    except Exception as exc:
        logger.debug(f"Enrichissement sentiment RSS : {exc}")
    return articles


def _scrape_rss_cached() -> list[dict]:
    import hashlib, time
    now = time.time()
    if now - _rss_cache["fetched_at"] < _RSS_TTL and _rss_cache["articles"]:
        return _rss_cache["articles"]

    try:
        from datetime import datetime, timezone
    except ImportError:
        return []

    articles = []
    all_feeds = RSS_FEEDS + REDDIT_FEEDS
    for source, url in all_feeds:
        try:
            feed = _fetch_feed(url)
            for entry in feed.entries[:20]:
                link = entry.get("link") or entry.get("id") or ""
                articles.append({
                    "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                    "title":           _strip_html(entry.get("title", "")),
                    "summary":         _strip_html(entry.get("summary", "") or "")[:300],
                    "source":          source,
                    "source_label":    SOURCE_LABELS.get(source, source),
                    "url":             link,
                    "published_at":    entry.get("published", datetime.now(timezone.utc).isoformat()),
                    "sentiment":       None,
                    "sentiment_label": None,
                    "entities":        [],
                    "keywords":        [],
                    "enriched":        False,
                })
        except Exception as exc:
            logger.debug(f"RSS {source} : {exc}")

    # Enrichissement sentiment (VADER fallback si transformers indisponible)
    articles = _enrich_with_sentiment(articles)

    _rss_cache["articles"]   = articles
    _rss_cache["fetched_at"] = now
    logger.info(f"[RSS] {len(articles)} articles scrapés + sentiment enrichi (fallback Kafka)")
    return articles


@app.get("/api/journal")
def journal(n: int = 100, source: str = "", sentiment: str = ""):
    articles = []
    kafka_up = False
    enriched = False

    # 1. Priorité : features enrichies par Spark (sentiment + NER)
    if _feature_consumer and _feature_consumer.is_running:
        kafka_up = True
        enriched = True
        for a in _feature_consumer.latest(n * 2):
            articles.append({
                "id":              a.get("id", ""),
                "title":           a.get("title_clean", a.get("title", "")),
                "summary":         (a.get("body_clean", "") or "")[:300],
                "source":          a.get("source", ""),
                "source_label":    SOURCE_LABELS.get(a.get("source", ""), a.get("source", "")),
                "url":             a.get("url", ""),
                "published_at":    a.get("published_at", ""),
                "sentiment":       a.get("sentiment"),
                "sentiment_label": a.get("sentiment_label"),
                "entities":        a.get("entities") or [],
                "keywords":        a.get("keywords") or [],
                "enriched":        True,
            })

    # 2. Fallback : articles bruts du scraper (Spark pas encore actif)
    if not articles and _raw_consumer and _raw_consumer.is_running:
        kafka_up = True
        for a in _raw_consumer.latest(n * 2):
            articles.append({
                "id":              a.get("id", ""),
                "title":           _strip_html(a.get("title", "")),
                "summary":         _strip_html(a.get("description", "") or "")[:300],
                "source":          a.get("source", ""),
                "source_label":    SOURCE_LABELS.get(a.get("source", ""), a.get("source", "")),
                "url":             a.get("url", ""),
                "published_at":    a.get("published_at", ""),
                "sentiment":       None,
                "sentiment_label": None,
                "entities":        [],
                "keywords":        [],
                "enriched":        False,
            })

    # 3. Fallback RSS direct — Kafka non disponible (dev / sans Docker)
    if not articles:
        articles = _scrape_rss_cached()

    if source:
        articles = [a for a in articles if a["source"] == source]
    # Sentiment filter only applies when articles are enriched by Spark
    sentiment_filter_applied = False
    if sentiment and enriched:
        articles = [a for a in articles if a.get("sentiment_label") == sentiment]
        sentiment_filter_applied = True

    articles = articles[-n:]
    articles.reverse()

    return {
        "articles":               articles,
        "total":                  len(articles),
        "kafka_available":        kafka_up,
        "enriched":               enriched,
        "sentiment_filter_active": sentiment_filter_applied,
    }


# ============================================================
# Streaming temps réel — articles traités par Spark + CamemBERT
# ============================================================

@app.get("/api/stream/latest")
def stream_latest(n: int = 50):
    """Derniers articles traités par Spark Structured Streaming (polling)."""
    if _feature_consumer is None or not _feature_consumer.is_running:
        return {"articles": [], "kafka_available": False}
    return {"articles": _feature_consumer.latest(n), "kafka_available": True}


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket — pousse les nouveaux articles toutes les 2s vers React."""
    await websocket.accept()
    try:
        while True:
            articles = _feature_consumer.latest(20) if _feature_consumer else []
            await websocket.send_json({"articles": articles})
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass


# ============================================================
# Prédictions enrichies au sentiment
# ============================================================

class PredictScandaleRequest(BaseModel):
    party:       str = "RN"
    annee:       int = 2024
    institution: str = "Assemblée nationale"
    description: str = ""
    category:    Optional[str] = None
    status:      Optional[str] = None
    top_n:       int = 5
    use_live_sentiment: bool = True

class PredictVoteRequest(BaseModel):
    title:       str
    annee:       int = 2025
    legislature: int = 17
    use_live_sentiment: bool = True


def _resolve_sentiment(entities: list[str], description: str = "",
                        use_live: bool = True) -> float:
    """
    Priorité : sentiment live Kafka → CamemBERT sur description → 0.0
    """
    try:
        from pipeline.sentiment_utils import get_live_sentiment, score_single
        if use_live and _feature_consumer and _feature_consumer.is_running:
            articles = _feature_consumer.latest(200)
            import pandas as pd
            snapshot = str(ROOT_DIR / "output" / "stream_snapshot.parquet")
            live = get_live_sentiment(entities, snapshot_path=snapshot)
            if live != 0.0:
                return live
        if description:
            return score_single(description)
    except Exception as exc:
        logger.debug(f"_resolve_sentiment : {exc}")
    return 0.0


def _confidence_level(proba_dict: dict) -> str:
    """Compare max(proba) à la distribution uniforme pour qualifier la confiance."""
    n = len(proba_dict)
    if n == 0:
        return "faible"
    uniform = 1.0 / n
    mx = max(proba_dict.values())
    if mx >= 3 * uniform:
        return "haute"
    if mx >= 1.5 * uniform:
        return "moyenne"
    return "faible"


def _kafka_related_articles(entities: list[str], n: int = 5) -> list[dict]:
    """Retourne les articles Kafka récents mentionnant au moins une entité."""
    if not _feature_consumer or not _feature_consumer.is_running:
        return []
    try:
        results = []
        for art in reversed(_feature_consumer.latest(300)):
            text = (art.get("title_clean", "") + " " + art.get("body_clean", "")).lower()
            if any(e and e.lower() in text for e in entities):
                results.append({
                    "title":           (art.get("title_clean") or art.get("title", ""))[:120],
                    "source":          art.get("source", ""),
                    "sentiment":       art.get("sentiment"),
                    "sentiment_label": art.get("sentiment_label"),
                    "url":             art.get("url", ""),
                    "published_at":    art.get("published_at", ""),
                })
                if len(results) >= n:
                    break
        return results
    except Exception:
        return []


@app.post("/api/predict/scandale")
def predict_scandale(req: PredictScandaleRequest):
    """
    Prédit la catégorie du scandale et l'élu le plus probable.
    Enrichit la prédiction avec le sentiment médiatique live (Kafka) ou CamemBERT.
    """
    try:
        from pipeline.predict import predict_category, predict_politician
    except ImportError as exc:
        raise HTTPException(503, f"Pipeline ML non disponible : {exc}")

    entities  = [req.party] + ([req.category] if req.category else [])
    if req.description:
        import re
        desc_words = re.findall(r"\b[A-ZÀ-Ÿ][a-zà-ÿ]+\b", req.description)
        entities += desc_words[:5]
    entities = list(dict.fromkeys(e for e in entities if e))

    sentiment = _resolve_sentiment(entities, req.description, req.use_live_sentiment)

    try:
        cat_label, cat_proba, evidence = predict_category(
            party=req.party, annee=req.annee,
            institution=req.institution, description=req.description,
            sentiment=sentiment,
        )
    except Exception as exc:
        raise HTTPException(500, f"Erreur predict_category : {exc}")

    confidence = _confidence_level(cat_proba)

    politicians = []
    try:
        if confidence != "faible":
            politicians = predict_politician(
                category=cat_label, party=req.party,
                status=req.status or "ENQUETE_PRELIMINAIRE",
                top_n=req.top_n, sentiment=sentiment,
            )
    except Exception:
        pass

    kafka_sources = _kafka_related_articles(entities)

    sentiment_source = (
        "live_kafka" if (_feature_consumer and _feature_consumer.is_running) else
        "camembert"  if req.description else
        "none"
    )

    return {
        "category":         cat_label,
        "proba":            {k: round(v, 4) for k, v in cat_proba.items()},
        "confidence":       confidence,
        "politicians":      [{"name": n, "proba": round(p, 4)} for n, p in politicians],
        "sentiment_used":   round(sentiment, 4),
        "sentiment_source": sentiment_source,
        "evidence": {
            "matched_tokens":    evidence.get("matched", []),
            "ignored_tokens":    evidence.get("ignored", []),
            "tfidf_vocab_size":  evidence.get("tfidf_vocab_size", 0),
            "kafka_articles":    kafka_sources,
        },
    }


@app.post("/api/predict/vote")
def predict_vote_endpoint(req: PredictVoteRequest):
    """Prédit l'adoption d'un vote, enrichi au sentiment du titre."""
    try:
        from pipeline.predict import predict_vote
    except ImportError as exc:
        raise HTTPException(503, f"Pipeline ML non disponible : {exc}")

    sentiment = _resolve_sentiment([req.title[:50]], req.title, req.use_live_sentiment)

    try:
        label, proba = predict_vote(
            title=req.title, annee=req.annee,
            legislature=req.legislature, sentiment=sentiment,
        )
    except Exception as exc:
        raise HTTPException(500, f"Erreur predict_vote : {exc}")

    return {
        "prediction": label,
        "result":     label,
        "proba_adopted":  round(float(proba[1]), 4),
        "proba_rejected": round(float(proba[0]), 4),
        "sentiment_used": round(sentiment, 4),
        "sentiment_source": (
            "live_kafka" if (_feature_consumer and _feature_consumer.is_running) else
            "camembert"  if req.title else
            "none"
        ),
    }


# ============================================================
# Agent Chatbot — PoliBot (ReAct : Think → Act → Observe)
# Moteur : Groq (gratuit, groq.com) — format OpenAI-compatible
# ============================================================

_groq_client = None

def _get_groq():
    global _groq_client
    if _groq_client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(
                503,
                "GROQ_API_KEY non configurée. Créez une clé gratuite sur https://console.groq.com"
            )
        try:
            from groq import Groq
            _groq_client = Groq(api_key=api_key)
        except ImportError:
            raise HTTPException(503, "Package 'groq' non installé. Faire : pip install groq")
    return _groq_client


# Format Groq/OpenAI : {"type":"function","function":{name,description,parameters}}
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_scandales",
            "description": (
                "Recherche des scandales politiques dans la base de données PoliGraph. "
                "Utilise cet outil pour trouver des affaires par texte libre, catégorie, parti, statut ou période."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "q":        {"type": "string",  "description": "Texte libre (titre, description, nom du politicien)"},
                    "category": {"type": "string",  "description": "Catégorie ex: CORRUPTION, FRAUDE_FISCALE, FINANCEMENT_ILLEGAL"},
                    "parti":    {"type": "string",  "description": "Parti politique ex: RN, LFI, PS, LREM, LR"},
                    "statut":   {"type": "string",  "description": "Statut judiciaire ex: CONDAMNE, ACQUITTE, ENQUETE_PRELIMINAIRE"},
                    "annee_min":{"type": "integer", "description": "Année minimale des faits"},
                    "annee_max":{"type": "integer", "description": "Année maximale des faits"},
                    "limit":    {"type": "integer", "description": "Nombre de résultats (défaut 10, max 30)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_votes",
            "description": (
                "Recherche des votes parlementaires dans la base de données. "
                "Utilise pour trouver des lois, résultats de votes, taux d'adoption."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "q":      {"type": "string",  "description": "Texte de recherche sur le titre du vote/loi"},
                    "result": {"type": "string",  "description": "Résultat: ADOPTED ou REJECTED"},
                    "annee":  {"type": "integer", "description": "Année du vote"},
                    "limit":  {"type": "integer", "description": "Nombre de résultats (défaut 10)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_statistics",
            "description": "Obtenir des statistiques agrégées sur les scandales, votes, partis ou élus.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["scandales", "votes", "partis", "elus"],
                        "description": "Type de statistiques à récupérer",
                    }
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_articles",
            "description": (
                "Récupérer les articles de presse récents sur la politique française. "
                "Sources : Le Monde, Le Figaro, Libération, France Info, Le Point, Reddit."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "q":     {"type": "string",  "description": "Mots-clés pour filtrer par titre ou résumé"},
                    "limit": {"type": "integer", "description": "Nombre d'articles (défaut 8, max 20)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_politician_profile",
            "description": "Obtenir le profil détaillé d'un élu français (parti, institution, position politique, âge).",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":  {"type": "string", "description": "Nom du politicien (prénom et/ou nom)"},
                    "parti": {"type": "string", "description": "Parti pour affiner si plusieurs homonymes"},
                },
                "required": ["name"],
            },
        },
    },
]


def _tool_search_scandales(q="", category="", parti="", statut="",
                            annee_min=0, annee_max=9999, limit=10):
    try:
        sc = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
        if q:
            mask = (
                sc["title"].fillna("").str.contains(q, case=False, na=False) |
                sc["description"].fillna("").str.contains(q, case=False, na=False) |
                sc["politician_name"].fillna("").str.contains(q, case=False, na=False)
            )
            sc = sc[mask]
        if category:
            sc = sc[sc["category"] == category]
        if parti:
            sc = sc[sc["party_short"] == parti]
        if statut:
            sc = sc[sc["status"] == statut]
        if annee_min > 0:
            sc = sc[pd.to_numeric(sc["annee_faits"], errors="coerce").fillna(0) >= annee_min]
        if annee_max < 9999:
            sc = sc[pd.to_numeric(sc["annee_faits"], errors="coerce").fillna(9999) <= annee_max]
        cols = ["title", "category", "status", "politician_name", "party_short",
                "annee_faits", "institution", "sentence", "description"]
        cols = [c for c in cols if c in sc.columns]
        limit = min(int(limit), 30)
        results = sc[cols].head(limit).fillna("").to_dict(orient="records")
        return {"total_trouvé": len(sc), "résultats": results}
    except Exception as e:
        return {"erreur": str(e), "résultats": []}


def _tool_search_votes(q="", result="", annee=0, limit=10):
    try:
        vt = pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)
        if q:
            vt = vt[vt["title"].fillna("").str.contains(q, case=False, na=False)]
        if result:
            vt = vt[vt["result"] == result]
        if annee > 0:
            vt = vt[pd.to_numeric(vt["annee_vote"], errors="coerce").fillna(0) == annee]
        cols = ["title", "result", "annee_vote", "legislature",
                "votesFor", "votesAgainst", "votesAbstain", "totalVotes"]
        cols = [c for c in cols if c in vt.columns]
        results = vt[cols].head(int(limit)).fillna("").to_dict(orient="records")
        return {"total_trouvé": len(vt), "résultats": results}
    except Exception as e:
        return {"erreur": str(e), "résultats": []}


def _tool_get_statistics(type: str):
    try:
        if type == "scandales":
            sc = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
            return {
                "total": len(sc),
                "par_catégorie": sc["category"].value_counts().head(10).to_dict(),
                "par_parti":     sc["party_short"].value_counts().head(10).to_dict(),
                "par_statut":    sc["status"].value_counts().to_dict(),
            }
        if type == "votes":
            vt = pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)
            return {
                "total":       len(vt),
                "par_résultat": vt["result"].value_counts().to_dict(),
                "par_année":   (
                    vt["annee_vote"].dropna()
                    .pipe(lambda s: pd.to_numeric(s, errors="coerce").dropna())
                    .astype(int).value_counts().sort_index().to_dict()
                ),
            }
        if type == "partis":
            el = pd.read_csv(ANALYTICS_DIR / "elus_features.csv", low_memory=False)
            sc = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
            return {
                "partis_élus":      el["party_short"].value_counts().head(15).to_dict(),
                "partis_scandales": sc["party_short"].value_counts().head(15).to_dict(),
            }
        if type == "elus":
            el = pd.read_csv(ANALYTICS_DIR / "elus_features.csv", low_memory=False)
            return {
                "total":           len(el),
                "par_institution": el["institution"].value_counts().head(10).to_dict(),
                "par_parti":       el["party_short"].value_counts().head(15).to_dict(),
            }
        return {"erreur": f"Type inconnu : {type}"}
    except Exception as e:
        return {"erreur": str(e)}


def _tool_get_recent_articles(q="", limit=8):
    try:
        articles = _scrape_rss_cached()
        if q:
            ql = q.lower()
            articles = [a for a in articles
                        if ql in a.get("title", "").lower() or ql in a.get("summary", "").lower()]
        limit = min(int(limit), 20)
        return {
            "total_trouvé": len(articles),
            "articles": [
                {
                    "titre":      a.get("title", ""),
                    "résumé":     a.get("summary", ""),
                    "source":     a.get("source_label", a.get("source", "")),
                    "url":        a.get("url", ""),
                    "publié_le":  a.get("published_at", ""),
                    "sentiment":  a.get("sentiment_label"),
                }
                for a in articles[:limit]
            ],
        }
    except Exception as e:
        return {"erreur": str(e), "articles": []}


def _tool_get_politician_profile(name: str, parti: str = ""):
    try:
        el_path = ANALYTICS_DIR / "elus_features.csv"
        if not el_path.exists():
            return {"erreur": "Base élus non disponible"}
        el = pd.read_csv(el_path, low_memory=False)
        mask = el["fullName"].fillna("").str.contains(name, case=False, na=False)
        if parti:
            mask &= el["party_short"].fillna("").str.contains(parti, case=False, na=False)
        results = el[mask].head(5)
        if results.empty:
            return {"message": f"Aucun élu trouvé pour '{name}'", "résultats": []}
        cols = [c for c in ["fullName", "party_short", "position_politique",
                             "institution", "isCurrent", "age_approx", "civility"]
                if c in results.columns]
        return {"résultats": results[cols].fillna("").to_dict(orient="records")}
    except Exception as e:
        return {"erreur": str(e)}


def _execute_agent_tool(tool_name: str, tool_input: dict) -> dict:
    dispatch = {
        "search_scandales":      _tool_search_scandales,
        "search_votes":          _tool_search_votes,
        "get_statistics":        _tool_get_statistics,
        "get_recent_articles":   _tool_get_recent_articles,
        "get_politician_profile": _tool_get_politician_profile,
    }
    fn = dispatch.get(tool_name)
    if fn is None:
        return {"erreur": f"Outil inconnu : {tool_name}"}
    try:
        return fn(**tool_input)
    except TypeError as e:
        return {"erreur": f"Paramètres invalides pour {tool_name} : {e}"}


_AGENT_SYSTEM = (
    "Tu es PoliBot, un assistant spécialisé dans l'analyse de la politique française. "
    "Tu as accès à une base de données complète sur les scandales politiques français, "
    "les votes parlementaires, les profils des élus, et les articles de presse récents "
    "(Le Monde, Le Figaro, Libération, France Info, Le Point). "
    "Utilise systématiquement les outils disponibles pour répondre avec précision. "
    "Quand tu spécules, indique-le clairement. "
    "Réponds toujours en français. Sois factuel, analytique et nuancé."
)

_GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


class ChatRequest(BaseModel):
    message: str
    history: list = []


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    """
    Agent ReAct PoliBot : Groq (Llama) + outils PoliGraph.
    Boucle Think → Act (outil DB/presse) → Observe (résultat) → réponse finale.
    """
    client = _get_groq()

    # Format Groq/OpenAI : système en premier, puis historique, puis message user
    messages = [{"role": "system", "content": _AGENT_SYSTEM}]
    messages += [m for m in req.history if m.get("role") in ("user", "assistant", "tool")]
    messages.append({"role": "user", "content": req.message})

    steps = []

    for _ in range(10):  # max 10 itérations ReAct
        response = client.chat.completions.create(
            model=_GROQ_MODEL,
            messages=messages,
            tools=AGENT_TOOLS,
            tool_choice="auto",
            max_tokens=4096,
            temperature=0.3,
        )

        choice  = response.choices[0]
        message = choice.message

        if choice.finish_reason == "tool_calls" and message.tool_calls:
            # Ajouter le message assistant (avec tool_calls) à l'historique
            messages.append({
                "role":       "assistant",
                "content":    message.content or "",
                "tool_calls": [
                    {
                        "id":       tc.id,
                        "type":     "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in message.tool_calls
                ],
            })

            # Exécuter chaque outil et ajouter le résultat
            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                result = _execute_agent_tool(tc.function.name, args)
                steps.append({
                    "outil":      tc.function.name,
                    "paramètres": args,
                    "résultat":   result,
                })
                messages.append({
                    "role":         "tool",
                    "tool_call_id": tc.id,
                    "content":      json.dumps(result, ensure_ascii=False, default=str),
                })

        else:
            # Réponse finale — stop_reason = "stop" ou "length"
            return {"response": message.content or "", "steps": steps}

    return {"response": "Limite d'itérations atteinte.", "steps": steps}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
