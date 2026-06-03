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

# Cache DataFrames analytics (évite de relire les CSV à chaque appel outil)
_df_scandales: pd.DataFrame | None = None
_df_votes:     pd.DataFrame | None = None
_df_elus:      pd.DataFrame | None = None


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
    global df, _df_scandales, _df_votes, _df_elus
    sc_path = ANALYTICS_DIR / "scandales_features.csv"
    vt_path = ANALYTICS_DIR / "votes_features.csv"
    el_path = ANALYTICS_DIR / "elus_features.csv"

    # Scandales (sert aussi comme df principal)
    if sc_path.exists():
        _df_scandales = pd.read_csv(sc_path, low_memory=False)
        df = _df_scandales
        logger.info(f"[API] scandales chargés : {len(_df_scandales)} lignes")
    else:
        try:
            df = pd.read_parquet(CLEANED_ANALYTICS_PARQUET)
            _df_scandales = df
            logger.info(f"[API] Données chargées depuis parquet : {len(df)} lignes")
        except Exception as e:
            logger.warning(f"[API] Parquet introuvable : {e}")
            csv_path = ROOT_DIR / "data/cleaned_analytics.csv"
            if csv_path.exists():
                df = pd.read_csv(csv_path, low_memory=False)
                _df_scandales = df
            else:
                df = pd.DataFrame()
                _df_scandales = df
                logger.warning("[API] Aucune donnée trouvée — DataFrame vide")

    # Votes & élus — chargés une seule fois en mémoire
    if vt_path.exists():
        _df_votes = pd.read_csv(vt_path, low_memory=False)
        logger.info(f"[API] votes chargés : {len(_df_votes)} lignes")
    else:
        _df_votes = pd.DataFrame()

    if el_path.exists():
        _df_elus = pd.read_csv(el_path, low_memory=False)
        logger.info(f"[API] élus chargés : {len(_df_elus)} lignes")
    else:
        _df_elus = pd.DataFrame()


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


@app.get("/api/metrics/sources")
def metrics_sources():
    """Métriques de réussite du scraping par source + état Kafka."""
    sources_out = {}
    for key, s in _scrape_metrics["sources"].items():
        total = s["ok"] + s["errors"]
        sources_out[key] = {
            "label":       SOURCE_LABELS.get(key, key),
            "ok":          s["ok"],
            "errors":      s["errors"],
            "success_rate": round(s["ok"] / total * 100, 1) if total > 0 else None,
            "last_count":  s["last_count"],
            "last_at":     s["last_at"],
            "status":      "ok" if s["errors"] == 0 or s["ok"] >= s["errors"] else "degraded",
        }
    kafka_active = bool(_feature_consumer and _feature_consumer.is_running)
    return {
        "scraping": {
            "total_runs":      _scrape_metrics["total_runs"],
            "last_run_at":     _scrape_metrics["last_run_at"],
            "total_articles":  _scrape_metrics["total_articles"],
            "sources":         sources_out,
        },
        "kafka": {
            "active":          kafka_active,
            "bootstrap":       os.getenv("KAFKA_BOOTSTRAP_SERVERS", "non configuré"),
        },
        "dataframes": {
            "scandales": int(len(_df_scandales)) if _df_scandales is not None else 0,
            "votes":     int(len(_df_votes))     if _df_votes     is not None else 0,
            "elus":      int(len(_df_elus))      if _df_elus      is not None else 0,
        },
    }


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
    # Presse
    "lemonde":              "Le Monde",
    "lefigaro":             "Le Figaro",
    "liberation":           "Libération",
    "franceinfo":           "France Info",
    "lepoint":              "Le Point",
    # Google News
    "googlenews/politique": "Google News · Politique",
    "googlenews/parlement": "Google News · Parlement",
    # Réseaux sociaux — API ouvertes
    "reddit/r/france":      "Reddit · r/france",
    "reddit/r/politique":   "Reddit · r/politique",
    "bluesky/politique":    "Bluesky · Politique",
    "bluesky/france":       "Bluesky · France",
    "mastodon/politique":   "Mastodon · #politique",
    "mastodon/parlement":   "Mastodon · #parlement",
    # X (Nitter RSS — aucun token requis)
    "x/politique":          "X · Politique",
    # Threads (RSSHub public)
    "threads/politique":    "Threads · Politique",
    # Facebook (facebook-scraper, pages publiques)
    "facebook/politique":   "Facebook · Politique",
}

RSS_FEEDS = [
    ("lemonde",    "https://www.lemonde.fr/politique/rss_full.xml"),
    ("lefigaro",   "https://www.lefigaro.fr/rss/figaro_politique.xml"),
    ("liberation", "https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml"),
    ("franceinfo", "https://www.francetvinfo.fr/politique.rss"),
    ("lepoint",    "https://www.lepoint.fr/politique/rss.xml"),
]

# Google News — agrège les articles les plus partagés sur les réseaux
GOOGLE_NEWS_QUERIES = [
    ("googlenews/politique", "politique+france"),
    ("googlenews/parlement", "assemblée+nationale+sénat"),
]

REDDIT_SUBS = [
    ("reddit/r/france",    "france"),
    ("reddit/r/politique", "politique"),
]

BLUESKY_QUERIES = [
    ("bluesky/politique", "politique france"),
    ("bluesky/france",    "assemblée nationale"),
]

# Mastodon — instances françaises, API publique sans authentification
MASTODON_TAGS = [
    ("mastodon/politique", "piaille.fr", "politique"),
    ("mastodon/parlement", "piaille.fr", "parlement"),
]

# Nitter — frontend Twitter open source, accès RSS sans token
NITTER_INSTANCES = [
    "nitter.poast.org",
    "nitter.privacydev.net",
    "nitter.cz",
    "nitter.d420.de",
]
NITTER_ACCOUNTS = [
    "gouvernementFR",
    "AssembleeNat",
    "senat",
    "Elysee_FR",
    "jlmelenchon",
    "MLP_officiel",
    "fxbellamy",
    "olivierfaure",
]

THREADS_HANDLES = [
    "gouvernement.fr",
    "elysee",
    "assemblee_nationale",
]

FACEBOOK_PAGES = [
    "rassemblementnational",
    "LaFranceInsoumise",
]

_RSS_UA = "PoliGraph/1.0 (github.com/AlixROBIN/Poligraph-app; contact: alixanniv@gmail.com)"

# Mots-clés de politique française — filtre les contenus hors-sujet des réseaux sociaux
_FR_POLITICS_KW = frozenset({
    "france", "français", "française", "francais", "francaise",
    "macron", "premier", "ministre", "gouvernement",
    "assemblée", "assemblee", "sénat", "senat", "parlement",
    "député", "depute", "sénateur", "senateur",
    "élection", "election", "vote", "loi", "décret", "decret",
    "rn", "lfi", "ps", "lr",
    "mélenchon", "melenchon", "le pen", "bardella", "attal", "weil", "bayrou",
    "rassemblement", "insoumise", "socialiste", "republicains", "renaissance",
    "président", "president", "élysée", "elysee", "matignon",
    "immigration", "retraite", "budget", "grève", "greve", "manifestation",
    "fiscal", "impôt", "impot", "chomage", "chômage",
    "dissolution", "censure", "cohabitation", "legislatif", "legislatives",
    "zemmour", "faure", "jadot", "glucksmann", "hayer", "retailleau",
})


def _is_french_politics(title: str, summary: str = "") -> bool:
    """Filtre rapide : renvoie True si le contenu traite de politique française."""
    text = (title + " " + summary).lower()
    words = set(re.findall(r'\b\w+\b', text))
    return bool(words & _FR_POLITICS_KW)


# Cache RSS — évite de re-scraper à chaque requête
_rss_cache: dict = {"articles": [], "fetched_at": 0.0}
_RSS_TTL = 300  # 5 minutes

# Métriques de scraping par source
_scrape_metrics: dict = {
    "total_runs":     0,
    "last_run_at":    None,
    "total_articles": 0,
    "sources":        {},  # source_key → {ok, errors, last_count, last_at}
}


def _metric_ok(source: str, count: int):
    import time
    s = _scrape_metrics["sources"].setdefault(source, {"ok": 0, "errors": 0, "last_count": 0, "last_at": None})
    s["ok"]         += 1
    s["last_count"]  = count
    s["last_at"]     = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _metric_err(source: str):
    _scrape_metrics["sources"].setdefault(source, {"ok": 0, "errors": 0, "last_count": 0, "last_at": None})["errors"] += 1


def _fetch_feed(url: str):
    import feedparser, requests as _r
    try:
        resp = _r.get(url, headers={"User-Agent": _RSS_UA}, timeout=15)
        resp.raise_for_status()
        return feedparser.parse(resp.content)
    except Exception:
        return feedparser.parse(url)


def _strip_html(text: str) -> str:
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
    return re.sub(r"\s+", " ", s.get_data()).strip()


_REDDIT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _fetch_reddit(source_key: str, subreddit: str) -> list[dict]:
    """Reddit via JSON API avec UA navigateur (évite le blocage bot)."""
    import hashlib, requests as _r
    from datetime import datetime, timezone
    try:
        url  = f"https://www.reddit.com/r/{subreddit}/hot.json?limit=25"
        resp = _r.get(url, headers={"User-Agent": _REDDIT_UA}, timeout=15)
        if resp.status_code == 429:
            logger.info(f"[Reddit] {source_key}: rate-limited, passage ignoré")
            _metric_err(source_key)
            return []
        resp.raise_for_status()
        children = resp.json()["data"]["children"]
        articles = []
        for child in children:
            p = child["data"]
            if p.get("stickied") or not p.get("title"):
                continue
            link  = f"https://reddit.com{p['permalink']}"
            title = _strip_html(p["title"])
            body  = _strip_html(p.get("selftext", "") or p.get("url", ""))[:800]
            if not _is_french_politics(title, body):
                continue
            articles.append({
                "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                "title":           title,
                "summary":         body,
                "source":          source_key,
                "source_label":    SOURCE_LABELS.get(source_key, source_key),
                "url":             link,
                "published_at":    datetime.fromtimestamp(
                                       p["created_utc"], tz=timezone.utc
                                   ).isoformat(),
                "sentiment":       None,
                "sentiment_label": None,
                "entities":        [],
                "keywords":        [],
                "enriched":        False,
                "score":           p.get("score", 0),
                "comments":        p.get("num_comments", 0),
            })
        _metric_ok(source_key, len(articles))
        logger.info(f"[Reddit] {source_key}: {len(articles)} posts")
        return articles
    except Exception as exc:
        _metric_err(source_key)
        logger.warning(f"[Reddit] {source_key} : {exc}")
        return []


def _fetch_bluesky(source_key: str, query: str) -> list[dict]:
    """Posts Bluesky via API publique (sans authentification)."""
    import hashlib, requests as _r
    try:
        resp = _r.get(
            "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts",
            params={"q": query, "limit": 25, "sort": "latest"},
            headers={"User-Agent": _RSS_UA, "Accept": "application/json"},
            timeout=15,
        )
        if resp.status_code == 429:
            logger.info(f"[Bluesky] {source_key}: rate-limited")
            _metric_err(source_key)
            return []
        resp.raise_for_status()
        posts = resp.json().get("posts", [])
        articles = []
        for post in posts:
            record  = post.get("record", {})
            text    = record.get("text", "")
            if not _is_french_politics(text):
                continue
            uri     = post.get("uri", "")
            author  = post.get("author", {})
            handle  = author.get("handle", "")
            rkey    = uri.split("/")[-1] if "/" in uri else uri
            url_post = f"https://bsky.app/profile/{handle}/post/{rkey}"
            articles.append({
                "id":              hashlib.sha256(uri.encode()).hexdigest()[:16],
                "title":           text[:120],
                "summary":         text[:800],
                "source":          source_key,
                "source_label":    SOURCE_LABELS.get(source_key, source_key),
                "url":             url_post,
                "published_at":    record.get("createdAt", ""),
                "sentiment":       None,
                "sentiment_label": None,
                "entities":        [],
                "keywords":        [],
                "enriched":        False,
            })
        _metric_ok(source_key, len(articles))
        logger.info(f"[Bluesky] {source_key}: {len(articles)} posts")
        return articles
    except Exception as exc:
        _metric_err(source_key)
        logger.warning(f"[Bluesky] {source_key} : {exc}")
        return []


def _fetch_google_news(source_key: str, query: str) -> list[dict]:
    """Google News RSS — agrège les articles les plus partagés sur les réseaux sociaux."""
    import hashlib, requests as _r
    try:
        url  = f"https://news.google.com/rss/search?q={query}&hl=fr&gl=FR&ceid=FR:fr"
        feed = _fetch_feed(url)
        articles = []
        for entry in feed.entries[:20]:
            link = entry.get("link") or entry.get("id") or ""
            articles.append({
                "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                "title":           _strip_html(entry.get("title", "")),
                "summary":         _strip_html(entry.get("summary", "") or "")[:800],
                "source":          source_key,
                "source_label":    SOURCE_LABELS.get(source_key, source_key),
                "url":             link,
                "published_at":    entry.get("published", ""),
                "sentiment":       None,
                "sentiment_label": None,
                "entities":        [],
                "keywords":        [],
                "enriched":        False,
            })
        _metric_ok(source_key, len(articles))
        logger.info(f"[Google News] {source_key}: {len(articles)} articles")
        return articles
    except Exception as exc:
        _metric_err(source_key)
        logger.warning(f"[Google News] {source_key} : {exc}")
        return []


def _fetch_mastodon(source_key: str, instance: str, hashtag: str) -> list[dict]:
    """
    Mastodon public timeline par hashtag — API publique, sans authentification.
    Instances françaises actives : piaille.fr (communauté fr), mastodon.social.
    """
    import hashlib, requests as _r
    try:
        url  = f"https://{instance}/api/v1/timelines/tag/{hashtag}?limit=20"
        resp = _r.get(url, headers={"User-Agent": _RSS_UA}, timeout=15)
        resp.raise_for_status()
        posts = resp.json()
        articles = []
        for post in posts:
            content  = _strip_html(post.get("content", ""))
            url_post = post.get("url", "")
            account  = post.get("account", {})
            display  = account.get("display_name") or account.get("username", "")
            if len(content) < 20:
                continue
            if not _is_french_politics(content):
                continue
            articles.append({
                "id":              hashlib.sha256(url_post.encode()).hexdigest()[:16],
                "title":           f"{display}: {content[:100]}",
                "summary":         content[:800],
                "source":          source_key,
                "source_label":    SOURCE_LABELS.get(source_key, source_key),
                "url":             url_post,
                "published_at":    post.get("created_at", ""),
                "sentiment":       None,
                "sentiment_label": None,
                "entities":        [],
                "keywords":        [],
                "enriched":        False,
            })
        _metric_ok(source_key, len(articles))
        logger.info(f"[Mastodon] {source_key} (@{instance}): {len(articles)} posts")
        return articles
    except Exception as exc:
        _metric_err(source_key)
        logger.warning(f"[Mastodon] {source_key} : {exc}")
        return []


def _fetch_x(source_key: str) -> list[dict]:
    """
    X (Twitter) — essaie Nitter RSS en priorité (aucun token), puis API officielle
    si X_BEARER_TOKEN est défini. Cible les comptes officiels de représentants politiques.
    """
    token = os.getenv("X_BEARER_TOKEN")
    if token:
        import hashlib, requests as _r
        try:
            resp = _r.get(
                "https://api.twitter.com/2/tweets/search/recent",
                params={
                    "query":        "politique france lang:fr -is:retweet",
                    "max_results":  20,
                    "tweet.fields": "created_at,text",
                },
                headers={"Authorization": f"Bearer {token}", "User-Agent": _RSS_UA},
                timeout=15,
            )
            resp.raise_for_status()
            tweets = resp.json().get("data", [])
            articles = []
            for tw in tweets:
                text = tw.get("text", "")
                tid  = tw.get("id", "")
                if not _is_french_politics(text):
                    continue
                articles.append({
                    "id":              hashlib.sha256(tid.encode()).hexdigest()[:16],
                    "title":           text[:120],
                    "summary":         text[:800],
                    "source":          source_key,
                    "source_label":    SOURCE_LABELS.get(source_key, source_key),
                    "url":             f"https://x.com/i/web/status/{tid}",
                    "published_at":    tw.get("created_at", ""),
                    "sentiment":       None, "sentiment_label": None,
                    "entities":        [], "keywords":         [], "enriched": False,
                })
            _metric_ok(source_key, len(articles))
            logger.info(f"[X/API] {source_key}: {len(articles)} tweets")
            return articles
        except Exception as exc:
            logger.warning(f"[X/API] : {exc} → fallback Nitter")

    # Nitter RSS — comptes officiels de représentants politiques (aucun token requis)
    import hashlib
    articles = []
    for account in NITTER_ACCOUNTS:
        fetched = False
        for instance in NITTER_INSTANCES:
            try:
                feed = _fetch_feed(f"https://{instance}/{account}/rss")
                if not feed.entries:
                    continue
                for entry in feed.entries[:4]:
                    link    = entry.get("link", "") or entry.get("id", "")
                    title   = _strip_html(entry.get("title", ""))
                    summary = _strip_html(entry.get("summary", "") or "")
                    if not _is_french_politics(title, summary):
                        continue
                    articles.append({
                        "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                        "title":           title[:120],
                        "summary":         summary[:800],
                        "source":          source_key,
                        "source_label":    SOURCE_LABELS.get(source_key, source_key),
                        "url":             link,
                        "published_at":    entry.get("published", ""),
                        "sentiment":       None, "sentiment_label": None,
                        "entities":        [], "keywords":         [], "enriched": False,
                    })
                fetched = True
                break
            except Exception:
                continue
        if not fetched:
            logger.debug(f"[X/Nitter] Aucune instance disponible pour @{account}")

    _metric_ok(source_key, len(articles)) if articles else _metric_err(source_key)
    logger.info(f"[X/Nitter] {source_key}: {len(articles)} tweets")
    return articles


def _fetch_threads(source_key: str, handles: list[str]) -> list[dict]:
    """
    Threads — via RSSHub public (rsshub.app).
    Cible les comptes officiels de représentants et institutions politiques.
    """
    import hashlib
    articles = []
    for handle in handles:
        try:
            feed = _fetch_feed(f"https://rsshub.app/threads/user/{handle}")
            for entry in feed.entries[:8]:
                link    = entry.get("link", "") or entry.get("id", "")
                title   = _strip_html(entry.get("title", ""))
                summary = _strip_html(entry.get("summary", "") or "")
                if not _is_french_politics(title, summary):
                    continue
                articles.append({
                    "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                    "title":           title[:120],
                    "summary":         summary[:800],
                    "source":          source_key,
                    "source_label":    SOURCE_LABELS.get(source_key, source_key),
                    "url":             link,
                    "published_at":    entry.get("published", ""),
                    "sentiment":       None, "sentiment_label": None,
                    "entities":        [], "keywords":         [], "enriched": False,
                })
        except Exception as exc:
            logger.debug(f"[Threads] {handle}: {exc}")
    _metric_ok(source_key, len(articles)) if articles else _metric_err(source_key)
    logger.info(f"[Threads] {source_key}: {len(articles)} posts")
    return articles


def _fetch_facebook(source_key: str, pages: list[str]) -> list[dict]:
    """
    Facebook — pages publiques de partis politiques via facebook-scraper.
    Nécessite : pip install facebook-scraper  (optionnel, désactivé si absent).
    """
    try:
        from facebook_scraper import get_posts
    except ImportError:
        return []
    import hashlib
    articles = []
    for page in pages:
        try:
            for post in get_posts(page, pages=1, timeout=15):
                text = post.get("text", "") or post.get("post_text", "") or ""
                if not text or not _is_french_politics(text):
                    continue
                link = post.get("post_url", "") or ""
                articles.append({
                    "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                    "title":           text[:120],
                    "summary":         text[:800],
                    "source":          source_key,
                    "source_label":    SOURCE_LABELS.get(source_key, source_key),
                    "url":             link,
                    "published_at":    str(post.get("time", "")),
                    "sentiment":       None, "sentiment_label": None,
                    "entities":        [], "keywords":         [], "enriched": False,
                })
        except Exception as exc:
            logger.debug(f"[Facebook] {page}: {exc}")
    _metric_ok(source_key, len(articles)) if articles else _metric_err(source_key)
    logger.info(f"[Facebook] {source_key}: {len(articles)} posts")
    return articles


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
    from datetime import datetime, timezone
    now = time.time()
    if now - _rss_cache["fetched_at"] < _RSS_TTL and _rss_cache["articles"]:
        return _rss_cache["articles"]

    articles = []

    # ── 1. Presse RSS ──────────────────────────────────────────
    for source, url in RSS_FEEDS:
        try:
            feed = _fetch_feed(url)
            batch = []
            for entry in feed.entries[:20]:
                link = entry.get("link") or entry.get("id") or ""
                batch.append({
                    "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                    "title":           _strip_html(entry.get("title", "")),
                    "summary":         _strip_html(entry.get("summary", "") or "")[:800],
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
            articles.extend(batch)
            _metric_ok(source, len(batch))
        except Exception as exc:
            _metric_err(source)
            logger.debug(f"RSS {source} : {exc}")

    # ── 2. Google News RSS ─────────────────────────────────────
    for source_key, query in GOOGLE_NEWS_QUERIES:
        articles.extend(_fetch_google_news(source_key, query))

    # ── 3. Reddit JSON API ─────────────────────────────────────
    for source_key, subreddit in REDDIT_SUBS:
        articles.extend(_fetch_reddit(source_key, subreddit))

    # ── 4. Bluesky ─────────────────────────────────────────────
    for source_key, query in BLUESKY_QUERIES:
        articles.extend(_fetch_bluesky(source_key, query))

    # ── 5. Mastodon (API publique, comptes politiques) ────────
    for source_key, instance, tag in MASTODON_TAGS:
        articles.extend(_fetch_mastodon(source_key, instance, tag))

    # ── 6. X (Nitter RSS ou API officielle) ───────────────────
    articles.extend(_fetch_x("x/politique"))

    # ── 7. Threads (RSSHub, comptes officiels) ────────────────
    articles.extend(_fetch_threads("threads/politique", THREADS_HANDLES))

    # ── 8. Facebook (pages publiques partis) ──────────────────
    articles.extend(_fetch_facebook("facebook/politique", FACEBOOK_PAGES))

    # ── Déduplication par URL ──────────────────────────────────
    seen = set()
    unique = []
    for a in articles:
        if a["id"] not in seen:
            seen.add(a["id"])
            unique.append(a)
    articles = unique

    # ── Sentiment ──────────────────────────────────────────────
    articles = _enrich_with_sentiment(articles)

    _scrape_metrics["total_runs"]     += 1
    _scrape_metrics["last_run_at"]     = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _scrape_metrics["total_articles"] += len(articles)

    _rss_cache["articles"]   = articles
    _rss_cache["fetched_at"] = now
    logger.info(f"[Scrape] {len(articles)} articles (presse+reddit+bluesky) enrichis")
    return articles


@app.post("/api/journal/refresh")
def journal_refresh():
    """Vide le cache RSS pour forcer un nouveau scraping au prochain appel."""
    _rss_cache["fetched_at"] = 0.0
    _rss_cache["articles"]   = []
    return {"ok": True, "message": "Cache RSS vidé — les prochains articles seront rechargés."}


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

    # Filtre sentiment : fonctionne dès que les articles ont un label (Kafka ou VADER/RSS)
    sentiment_filter_applied = False
    has_sentiment = any(a.get("sentiment_label") for a in articles)
    if sentiment and has_sentiment:
        articles = [a for a in articles if a.get("sentiment_label") == sentiment]
        sentiment_filter_applied = True

    articles = articles[-n:]
    articles.reverse()

    return {
        "articles":                articles,
        "total":                   len(articles),
        "kafka_available":         kafka_up,
        "enriched":                enriched or has_sentiment,
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
# Backends : Groq (cloud) ou Ollama (local) selon LLM_BACKEND
#
# Variables d'environnement :
#   LLM_BACKEND   = "groq" (défaut) | "ollama"
#   GROQ_API_KEY  = clé Groq        (si backend=groq)
#   GROQ_MODEL    = llama-3.1-8b-instant (défaut — 5× plus de quota que 70b)
#   OLLAMA_URL    = http://localhost:11434 (défaut)
#   OLLAMA_MODEL  = llama3.1:8b     (défaut — supporte le tool calling)
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
    {
        "type": "function",
        "function": {
            "name": "analyze_political_figure",
            "description": (
                "Analyse croisée complète d'un personnage politique : "
                "articles de presse récents (avec sentiment et mots-clés) + affaires dans la base de données + profil élu. "
                "C'est l'outil principal pour répondre à des questions sur une personnalité politique spécifique, "
                "analyser sa situation médiatique, spéculer sur son avenir politique ou comparer presse et réalité judiciaire."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name":  {"type": "string", "description": "Nom complet ou partiel du politicien (ex: 'Marine Le Pen', 'Macron', 'Mélenchon')"},
                    "parti": {"type": "string", "description": "Parti politique pour affiner (optionnel, ex: RN, LFI, LREM)"},
                },
                "required": ["name"],
            },
        },
    },
]


def _tool_search_scandales(q="", category="", parti="", statut="",
                            annee_min=0, annee_max=9999, limit=10):
    try:
        sc = _df_scandales if _df_scandales is not None else pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
        sc = sc.copy()
        if q:
            mask = (
                sc["title"].fillna("").str.contains(q, case=False, na=False) |
                sc["description"].fillna("").str.contains(q, case=False, na=False) |
                sc["politician_name"].fillna("").str.contains(q, case=False, na=False)
            )
            sc = sc[mask]
        if category:
            sc = sc[sc["category"].fillna("").str.contains(category, case=False, na=False)]
        if parti:
            sc = sc[sc["party_short"].fillna("").str.contains(parti, case=False, na=False)]
        if statut:
            sc = sc[sc["status"].fillna("").str.contains(statut, case=False, na=False)]
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
        vt = _df_votes if _df_votes is not None else pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)
        vt = vt.copy()
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
        sc = _df_scandales if _df_scandales is not None else pd.DataFrame()
        vt = _df_votes     if _df_votes     is not None else pd.DataFrame()
        el = _df_elus      if _df_elus      is not None else pd.DataFrame()

        if type == "scandales":
            return {
                "total": len(sc),
                "par_catégorie": sc["category"].value_counts().head(10).to_dict() if "category" in sc.columns else {},
                "par_parti":     sc["party_short"].value_counts().head(10).to_dict() if "party_short" in sc.columns else {},
                "par_statut":    sc["status"].value_counts().to_dict() if "status" in sc.columns else {},
            }
        if type == "votes":
            return {
                "total":        len(vt),
                "par_résultat": vt["result"].value_counts().to_dict() if "result" in vt.columns else {},
                "par_année":    (
                    vt["annee_vote"].dropna()
                    .pipe(lambda s: pd.to_numeric(s, errors="coerce").dropna())
                    .astype(int).value_counts().sort_index().to_dict()
                ) if "annee_vote" in vt.columns else {},
            }
        if type == "partis":
            return {
                "partis_élus":      el["party_short"].value_counts().head(15).to_dict() if "party_short" in el.columns else {},
                "partis_scandales": sc["party_short"].value_counts().head(15).to_dict() if "party_short" in sc.columns else {},
            }
        if type == "elus":
            return {
                "total":           len(el),
                "par_institution": el["institution"].value_counts().head(10).to_dict() if "institution" in el.columns else {},
                "par_parti":       el["party_short"].value_counts().head(15).to_dict() if "party_short" in el.columns else {},
            }
        return {"erreur": f"Type inconnu : {type}"}
    except Exception as e:
        return {"erreur": str(e)}


def _articles_matching(articles: list[dict], q: str) -> list[dict]:
    """Recherche multi-mots tolérante : chaque mot de q doit apparaître dans titre OU résumé."""
    if not q:
        return articles
    words = [w.lower() for w in q.split() if len(w) > 2]
    if not words:
        return articles
    result = []
    for a in articles:
        text = (a.get("title", "") + " " + a.get("summary", "")).lower()
        if any(w in text for w in words):
            result.append(a)
    return result


def _tool_get_recent_articles(q="", limit=8):
    try:
        articles = _scrape_rss_cached()
        if q:
            articles = _articles_matching(articles, q)
        limit = min(int(limit), 20)
        return {
            "total_trouvé": len(articles),
            "articles": [
                {
                    "titre":      a.get("title", ""),
                    "résumé":     (a.get("summary", "") or "")[:200],
                    "source":     a.get("source_label", a.get("source", "")),
                    "url":        a.get("url", ""),
                    "publié_le":  a.get("published_at", ""),
                    "sentiment":  a.get("sentiment_label"),
                    "score":      a.get("sentiment"),
                }
                for a in articles[:min(limit, 8)]
            ],
        }
    except Exception as e:
        return {"erreur": str(e), "articles": []}


def _tool_get_politician_profile(name: str, parti: str = ""):
    try:
        el = _df_elus if (_df_elus is not None and not _df_elus.empty) else None
        if el is None:
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


def _tool_analyze_political_figure(name: str, parti: str = ""):
    """
    Analyse croisée complète : presse récente × scandales DB × profil élu.
    Retourne un rapport structuré avec sentiment médiatique, affaires connues
    et contexte politique — permet à l'agent de spéculer avec des données factuelles.
    """
    result = {"personnage_recherché": name, "presse": {}, "scandales": {}, "profil": {}}

    # ── 1. Presse récente ─────────────────────────────────────────────────
    articles = _scrape_rss_cached()
    relevant = _articles_matching(articles, name)

    if relevant:
        scores = [a["sentiment"] for a in relevant if a.get("sentiment") is not None]
        moy = round(sum(scores) / len(scores), 3) if scores else None
        label = ("POSITIVE" if moy and moy > 0.05
                 else "NEGATIVE" if moy and moy < -0.05
                 else "NEUTRAL")

        # Mots-clés fréquents dans les titres (hors stop-words basiques)
        stop = {"le","la","les","de","du","des","un","une","en","et","à","est","il","elle",
                "qui","que","pour","sur","par","au","aux","ce","se","sa","son","ses","dans"}
        word_freq: dict = {}
        for a in relevant:
            for w in re.findall(r"\b[a-zàâéèêëîïôùûüç]{4,}\b", a.get("title","").lower()):
                if w not in stop:
                    word_freq[w] = word_freq.get(w, 0) + 1
        top_kw = sorted(word_freq, key=lambda w: -word_freq[w])[:10]

        result["presse"] = {
            "nb_articles_trouvés": len(relevant),
            "sentiment_moyen":     moy,
            "tonalité_médiatique": label,
            "mots_clés_dominants": top_kw,
            "articles": [
                {
                    "titre":     a.get("title", ""),
                    "résumé":    (a.get("summary", "") or "")[:200],
                    "source":    a.get("source_label", ""),
                    "sentiment": a.get("sentiment_label"),
                    "score":     a.get("sentiment"),
                    "url":       a.get("url", ""),
                    "date":      a.get("published_at", ""),
                }
                for a in relevant[:6]
            ],
        }
    else:
        result["presse"] = {
            "nb_articles_trouvés": 0,
            "message": (
                f"Aucun article récent trouvé mentionnant '{name}'. "
                "Les flux RSS couvrent Le Monde, Le Figaro, Libération, France Info, Le Point. "
                "La personne peut être mentionnée sous un prénom/surnom différent."
            ),
        }

    # ── 2. Scandales dans la DB ───────────────────────────────────────────
    try:
        sc = _df_scandales if (_df_scandales is not None and not _df_scandales.empty) else pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
        # Cherche par nom complet ou parties du nom
        name_parts = [p for p in name.split() if len(p) > 2]
        mask = sc["politician_name"].fillna("").str.contains(name, case=False, na=False)
        for part in name_parts:
            mask |= sc["politician_name"].fillna("").str.contains(part, case=False, na=False)
        if parti:
            mask &= sc["party_short"].fillna("").str.contains(parti, case=False, na=False)
        found = sc[mask]
        cols = ["title", "category", "status", "annee_faits", "party_short", "sentence"]
        cols = [c for c in cols if c in found.columns]
        result["scandales"] = {
            "total_affaires": len(found),
            "catégories": found["category"].value_counts().to_dict() if not found.empty else {},
            "statuts":    found["status"].value_counts().to_dict()   if not found.empty else {},
            "affaires":   found[cols].head(5).fillna("").to_dict(orient="records"),
        }
    except Exception as e:
        result["scandales"] = {"erreur": str(e)}

    # ── 3. Profil élu ─────────────────────────────────────────────────────
    result["profil"] = _tool_get_politician_profile(name, parti)

    # ── 4. Synthèse pour l'agent ──────────────────────────────────────────
    nb_art = result["presse"].get("nb_articles_trouvés", 0)
    nb_sc  = result["scandales"].get("total_affaires", 0)
    result["synthèse_agent"] = (
        f"{'%d article(s) de presse récent(s)' % nb_art if nb_art else 'Aucun article récent'} "
        f"— {'%d affaire(s) dans la base' % nb_sc if nb_sc else 'aucune affaire dans la base'}. "
        f"Tonalité médiatique : {result['presse'].get('tonalité_médiatique', 'N/A')}. "
        "Croise ces données pour formuler une analyse argumentée."
    )
    return result


def _execute_agent_tool(tool_name: str, tool_input: dict) -> dict:
    dispatch = {
        "search_scandales":        _tool_search_scandales,
        "search_votes":            _tool_search_votes,
        "get_statistics":          _tool_get_statistics,
        "get_recent_articles":     _tool_get_recent_articles,
        "get_politician_profile":  _tool_get_politician_profile,
        "analyze_political_figure": _tool_analyze_political_figure,
    }
    fn = dispatch.get(tool_name)
    if fn is None:
        return {"erreur": f"Outil inconnu : {tool_name}"}
    try:
        return fn(**tool_input)
    except TypeError as e:
        return {"erreur": f"Paramètres invalides pour {tool_name} : {e}"}


_AGENT_SYSTEM = """Tu es PoliBot, un agent d'analyse politique française doté de plusieurs sources de données.

## Tes sources de données
- **Base de données** : scandales politiques, votes parlementaires, profils d'élus français
- **Presse vérifiée** : Le Monde, Le Figaro, Libération, France Info, Le Point, Google News
- **Réseaux sociaux** : comptes officiels de représentants politiques (X, Reddit, Mastodon, Bluesky)

## Règle fondamentale : toujours croiser les sources
Pour toute question sur un personnage politique ou une situation :
1. Utilise **analyze_political_figure** EN PREMIER — il croise automatiquement presse + DB + profil
2. Complète si besoin avec **search_scandales** ou **search_votes**
3. Formule une analyse argumentée en combinant les deux

## Utilisation correcte de search_scandales
- COMMENCE par `get_statistics("scandales")` pour voir les partis, catégories et statuts disponibles dans la base
- Le filtre `q` cherche dans le texte (titre, description, nom du politicien)
- Le filtre `parti` cherche par code parti (RN, LFI, PS, LR, LREM…) — NE PAS combiner `q` et `parti` avec la même valeur
- Le filtre `statut` accepte des valeurs partielles (ex: "CONDAMN" trouve "CONDAMNÉ", "CONDAMNATION"…)
- Le filtre `category` accepte des valeurs partielles (ex: "CORRUPT" trouve "CORRUPTION"…)
- Pour les scandales d'un parti : `parti="RN"` SANS `q` → résultats corrects
- Les filtres sont insensibles à la casse et aux accents

## Comment analyser
- Si la presse parle d'un sujet ET que la DB contient des données connexes → croise-les explicitement
- Cite les sources (nom du journal, date si disponible)
- Tu peux **spéculer** si les données le permettent, avec des formules claires :
  "D'après les données…", "Mon analyse :", "Il est probable que…"
- Ne dis JAMAIS "je n'ai pas d'information" sans avoir utilisé analyze_political_figure

## Format de réponse
- Toujours en français
- Structure : [données factuelles] → [croisement presse × DB] → [analyse argumentée]
- Mentionne le sentiment médiatique quand disponible (positif/négatif/neutre)"""

_GROQ_MODEL   = os.getenv("GROQ_MODEL",   "llama-3.1-8b-instant")   # 500k TPD vs 100k pour 70b
_OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")


def _llm_complete(messages: list, tools: list) -> dict:
    """
    Appel LLM unifié — retourne un dict normalisé :
      {"finish_reason": str, "content": str, "tool_calls": list}

    Backend sélectionné via LLM_BACKEND :
      - "groq"   (défaut) : cloud Groq, nécessite GROQ_API_KEY
      - "ollama" : modèle local via Ollama (llama3.1:8b recommandé)
        → installer : https://ollama.com  puis : ollama pull llama3.1:8b
    """
    backend = os.getenv("LLM_BACKEND", "groq").lower()

    if backend == "ollama":
        url  = _OLLAMA_URL.rstrip("/") + "/v1/chat/completions"
        resp = http_requests.post(url, json={
            "model":       _OLLAMA_MODEL,
            "messages":    messages,
            "tools":       tools,
            "tool_choice": "auto",
            "max_tokens":  2048,
            "temperature": 0.3,
            "stream":      False,
        }, timeout=120)
        if resp.status_code != 200:
            raise HTTPException(502, f"Ollama {resp.status_code}: {resp.text[:200]}")
        data   = resp.json()
        choice = data["choices"][0]
        msg    = choice["message"]
        return {
            "finish_reason": choice.get("finish_reason", "stop"),
            "content":       msg.get("content") or "",
            "tool_calls":    msg.get("tool_calls") or [],
        }

    # Groq (défaut)
    client   = _get_groq()
    response = client.chat.completions.create(
        model=_GROQ_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        max_tokens=2048,
        temperature=0.3,
    )
    choice = response.choices[0]
    msg    = choice.message
    return {
        "finish_reason": choice.finish_reason,
        "content":       msg.content or "",
        "tool_calls": [
            {
                "id":       tc.id,
                "type":     "function",
                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
            }
            for tc in (msg.tool_calls or [])
        ],
    }


class ChatRequest(BaseModel):
    message: str
    history: list = []


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    """Agent ReAct PoliBot — Groq ou Ollama selon LLM_BACKEND."""
    messages = [{"role": "system", "content": _AGENT_SYSTEM}]
    messages += [m for m in req.history if m.get("role") in ("user", "assistant", "tool")]
    messages.append({"role": "user", "content": req.message})
    steps = []

    for _ in range(6):
        result = _llm_complete(messages, AGENT_TOOLS)

        if result["finish_reason"] == "tool_calls" and result["tool_calls"]:
            messages.append({
                "role":       "assistant",
                "content":    result["content"],
                "tool_calls": result["tool_calls"],
            })
            for tc in result["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except (json.JSONDecodeError, KeyError):
                    args = {}
                tool_result = _execute_agent_tool(tc["function"]["name"], args)
                steps.append({"outil": tc["function"]["name"], "paramètres": args, "résultat": tool_result})
                messages.append({
                    "role":         "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content":      json.dumps(tool_result, ensure_ascii=False, default=str),
                })
        else:
            return {"response": result["content"], "steps": steps}

    return {"response": "Limite d'itérations atteinte.", "steps": steps}


@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """
    Variante SSE de /api/chat — stream les étapes ReAct au client en temps réel.
    Contourne le timeout HTTP 30s de Render : la connexion streaming reste ouverte.
    Chaque étape (outil appelé) est envoyée dès qu'elle est disponible.
    """
    loop = asyncio.get_event_loop()

    async def generate():
        messages = [{"role": "system", "content": _AGENT_SYSTEM}]
        messages += [m for m in req.history if m.get("role") in ("user", "assistant", "tool")]
        messages.append({"role": "user", "content": req.message})
        steps = []

        try:
            for _ in range(6):
                captured = {"msgs": list(messages)}
                result = await loop.run_in_executor(
                    None,
                    lambda: _llm_complete(captured["msgs"], AGENT_TOOLS),
                )

                if result["finish_reason"] == "tool_calls" and result["tool_calls"]:
                    messages.append({
                        "role":       "assistant",
                        "content":    result["content"],
                        "tool_calls": result["tool_calls"],
                    })

                    for tc in result["tool_calls"]:
                        try:
                            args = json.loads(tc["function"]["arguments"])
                        except (json.JSONDecodeError, KeyError):
                            args = {}

                        tool_result = _execute_agent_tool(tc["function"]["name"], args)
                        step = {"outil": tc["function"]["name"], "paramètres": args, "résultat": tool_result}
                        steps.append(step)

                        yield (
                            "data: "
                            + json.dumps({"type": "step", "step": step}, ensure_ascii=False, default=str)
                            + "\n\n"
                        )

                        messages.append({
                            "role":         "tool",
                            "tool_call_id": tc.get("id", ""),
                            "content":      json.dumps(tool_result, ensure_ascii=False, default=str),
                        })

                else:
                    yield (
                        "data: "
                        + json.dumps(
                            {"type": "done", "response": result["content"], "steps": steps},
                            ensure_ascii=False, default=str,
                        )
                        + "\n\n"
                    )
                    return

            yield (
                "data: "
                + json.dumps(
                    {"type": "done", "response": "Limite d'itérations atteinte.", "steps": steps},
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        except Exception as exc:
            yield "data: " + json.dumps({"type": "error", "message": str(exc)}) + "\n\n"

    from fastapi.responses import StreamingResponse as _SR
    return _SR(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
