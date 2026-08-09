"""
API FastAPI — données Analytics + prédictions ML
"""

import ast
import asyncio
import hashlib
import inspect
import json
import os
import pickle
import re
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from collections import deque

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.feature_extraction import FeatureHasher
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
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

    # Construction de l'index RAG en arrière-plan après chargement des données
    import threading as _threading
    _threading.Thread(target=_rag_build, daemon=True).start()


# ============================================================
# RAG — Retrieval-Augmented Generation (TF-IDF, sklearn)
# Indexe : scandales (CSV) + fact-checks (API poligraph.fr)
# ============================================================

_rag_vectorizer: "TfidfVectorizer | None" = None
_rag_matrix     = None   # scipy sparse TF-IDF matrix
_rag_docs: list = []     # [{"text": str, "source": str, "meta": dict}]


def _rag_build() -> None:
    """Construit l'index TF-IDF sur scandales CSV + fact-checks API."""
    global _rag_vectorizer, _rag_matrix, _rag_docs
    docs: list = []

    # ── Source 1 : scandales (déjà chargés en mémoire) ────────────────────
    sc = _df_scandales
    if sc is not None and not sc.empty:
        for _, row in sc.iterrows():
            text = " ".join(filter(None, [
                str(row.get("title", "")),
                str(row.get("description", "")),
                str(row.get("politician_name", "")),
                str(row.get("category", "")),
                str(row.get("party_short", "")),
            ]))
            docs.append({
                "text":   text,
                "source": "scandale",
                "meta": {
                    "titre":       str(row.get("title", "")),
                    "politicien":  str(row.get("politician_name", "")),
                    "parti":       str(row.get("party_short", "")),
                    "catégorie":   str(row.get("category", "")),
                    "statut":      str(row.get("status", "")),
                    "année":       str(row.get("annee_faits", "")),
                },
            })

    # ── Source 2 : fact-checks (API poligraph.fr) ─────────────────────────
    try:
        all_fc: list = []
        page = 1
        while len(all_fc) < 900 and page <= 10:
            d = _pg("factchecks", {"limit": 100, "page": page}, cache=True)
            batch = d.get("data") or []
            if not batch:
                break
            all_fc.extend(batch)
            page += 1

        for fc in all_fc:
            claim = fc.get("claimText") or ""
            if not claim:
                continue
            pols = fc.get("politicians") or []
            if isinstance(pols, str):
                try:
                    pols = ast.literal_eval(pols)
                except Exception:
                    pols = []
            pol_names = " ".join(p.get("fullName", "") for p in pols if isinstance(p, dict))
            docs.append({
                "text":   f"{claim} {pol_names} {fc.get('source', '')}",
                "source": "factcheck",
                "meta": {
                    "déclaration": claim[:200],
                    "verdict":     fc.get("verdictRating"),
                    "source":      fc.get("source"),
                    "date":        (fc.get("publishedAt") or "")[:10],
                    "url":         fc.get("sourceUrl") or "",
                    "politiciens": pol_names,
                },
            })
    except Exception as exc:
        logger.warning(f"[RAG] fact-checks non indexés : {exc}")

    if not docs:
        logger.warning("[RAG] Aucun document à indexer — index vide")
        return

    _rag_docs = docs
    vect = TfidfVectorizer(ngram_range=(1, 2), max_features=50_000,
                           min_df=1, sublinear_tf=True)
    _rag_matrix     = vect.fit_transform([d["text"] for d in docs])
    _rag_vectorizer = vect
    n_sc = sum(1 for d in docs if d["source"] == "scandale")
    n_fc = sum(1 for d in docs if d["source"] == "factcheck")
    logger.info(f"[RAG] Index prêt : {len(docs)} docs ({n_sc} scandales, {n_fc} fact-checks)")


def _rag_search(query: str, source_filter: str = "all", k: int = 8) -> list:
    """Retourne les k documents les plus proches de la requête."""
    if _rag_vectorizer is None or _rag_matrix is None or not _rag_docs:
        return []
    q_vec = _rag_vectorizer.transform([query])
    sims  = cosine_similarity(q_vec, _rag_matrix).flatten()
    top   = sims.argsort()[::-1]
    results = []
    for idx in top:
        if len(results) >= k:
            break
        if float(sims[idx]) < 0.04:
            break
        doc = _rag_docs[idx]
        if source_filter != "all" and doc["source"] != source_filter:
            continue
        results.append({"score": round(float(sims[idx]), 3), "type": doc["source"], **doc["meta"]})
    return results


# ============================================================
# Gardes-fous — rate limiting + détection injection de prompt
# ============================================================

_INJECTION_RE = re.compile(
    r"ignore\s+(previous|all|your|the|above|ces|les|toutes?)\s+(instructions?|directives?|r[eè]gles?)|"
    r"\bsystem\s*:\s*(?!Tu\s+es\s+PoliBot)|"
    r"\bact\s+as\s+(?!an?\s+analyst)|"
    r"\bjailbreak\b|"
    r"\bDAN\b|"
    r"forget\s+(all|your|previous|tout|tes|vos)|"
    r"<\s*/?system\s*>|"
    r"\[/?INST\]|"
    r"###\s*System|"
    r"you\s+are\s+now\s+(?!PoliBot)|"
    r"tu\s+es\s+maintenant\s+(un?|une?)\s+(?!PoliBot)|"
    r"pretend\s+(you\s+are|to\s+be)|"
    r"fais\s+semblant\s+d.être",
    flags=re.IGNORECASE,
)

_rate_buckets: dict = {}   # ip → deque[float] (timestamps)
_RATE_WINDOW  = 60         # secondes
_RATE_LIMIT   = 20         # requêtes max par fenêtre


def _guard_input(text: str, client_ip: str = "") -> None:
    """Bloque les inputs invalides, les injections et le rate-abuse."""
    if len(text) > 600:
        raise HTTPException(400, "Message trop long (max 600 caractères).")
    if _INJECTION_RE.search(text):
        raise HTTPException(400, "Message refusé.")
    if client_ip:
        now    = time.time()
        bucket = _rate_buckets.setdefault(client_ip, deque())
        while bucket and now - bucket[0] > _RATE_WINDOW:
            bucket.popleft()
        if len(bucket) >= _RATE_LIMIT:
            raise HTTPException(429, "Trop de requêtes — réessayez dans 60 secondes.")
        bucket.append(now)


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


@app.get("/api/chat/debug")
def chat_debug():
    """Diagnostic du chatbot — vérifie les variables d'env et l'accès aux APIs."""
    backend = os.getenv("LLM_BACKEND", "ollama").lower()
    groq_key = os.getenv("GROQ_API_KEY", "")
    hf_key   = os.getenv("HF_API_KEY", "")
    ant_key  = os.getenv("ANTHROPIC_API_KEY", "")

    result = {
        "backend":       backend,
        "groq_key_set":  bool(groq_key),
        "groq_key_hint": groq_key[:8] + "…" if groq_key else "MANQUANTE",
        "hf_key_set":    bool(hf_key),
        "hf_key_hint":   hf_key[:8] + "…" if hf_key else "MANQUANTE",
        "anthropic_key_set": bool(ant_key),
        "groq_model":    os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "hf_qa_model":   os.getenv("HF_QA_MODEL", "cmarkea/distilcamembert-base-qa"),
        "hf_embed_model":os.getenv("HF_EMBED_MODEL", "ibm-granite/granite-embedding-311m-multilingual-r2"),
        "rag_ready":     _rag_vectorizer is not None,
        "rag_docs":      len(_rag_docs),
    }

    # Test rapide Groq (1 token)
    if backend == "groq" and groq_key:
        try:
            client = _get_groq()
            r = client.chat.completions.create(
                model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                messages=[{"role": "user", "content": "Réponds juste 'ok'"}],
                max_tokens=5, temperature=0.0,
            )
            result["groq_test"] = "OK — " + (r.choices[0].message.content or "").strip()
        except Exception as e:
            result["groq_test"] = f"ERREUR : {str(e)[:200]}"
    else:
        result["groq_test"] = "non testé (backend != groq ou clé manquante)"

    return result


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
    sc = _df_scandales if _df_scandales is not None else pd.DataFrame()
    vt = _df_votes     if _df_votes     is not None else pd.DataFrame()
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
    sc = (_df_scandales if _df_scandales is not None else pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False))

    if q:
        mask = (
            sc["title"].fillna("").str.contains(q, case=False, na=False, regex=False) |
            sc["description"].fillna("").str.contains(q, case=False, na=False, regex=False) |
            sc["politician_name"].fillna("").str.contains(q, case=False, na=False, regex=False)
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
    theme:   str = "",
    limit:   int = 20,
    offset:  int = 0,
):
    vt = (_df_votes if _df_votes is not None else pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False))

    if q:
        vt = vt[vt["title"].fillna("").str.contains(q, case=False, na=False, regex=False)]
    if theme:
        vt["_theme"] = vt["title"].apply(_vote_theme)
        vt = vt[vt["_theme"] == theme]
    if result:
        vt = vt[vt["result"] == result]
    if annee > 0:
        vt = vt[pd.to_numeric(vt["annee_vote"], errors="coerce").fillna(0) == annee]

    # Priorité aux lignes avec externalId (données de groupe disponibles)
    if "externalId" in vt.columns:
        has_ext = vt["externalId"].notna() & (vt["externalId"].astype(str).str.strip() != "")
        vt = pd.concat([vt[has_ext], vt[~has_ext]]).reset_index(drop=True)

    total = len(vt)
    cols  = ["externalId", "title", "result", "annee_vote", "legislature",
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
    sc = _df_scandales if _df_scandales is not None else pd.DataFrame()
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


import unicodedata as _ud

def _strip_accents(s: str) -> str:
    return "".join(c for c in _ud.normalize("NFD", s) if _ud.category(c) != "Mn")

# Keywords en minuscules sans accents pour matcher les titres double-encodés de l'API
_VOTE_THEMES = {
    "Agriculture":         ["agriculture", "agricol", "alimentation", "peche", "souverainete agricole"],
    "Social & Santé":      ["social", "sante", "maladie", "travail", "emploi", "chomage", "retraite", "famille"],
    "Économie & Budget":   ["budget", "financ", "fiscal", "impot", "taxe", "plf", "plfss", "economi", "recette", "depense"],
    "Sécurité & Justice":  ["justice", "securite", "police", "penal", "crime", "gendarmerie", "fraude", "judiciaire"],
    "Environnement":       ["environnement", "ecologi", "climat", "biodiversite", "energie", "nucleaire", "transition"],
    "Europe & Intl.":      ["europe", "europeen", "traite", "international", "convention", "accord"],
    "Éducation & Culture": ["education", "ecole", "universite", "enseignement", "culture", "formation"],
    "Défense":             ["defense", "armee", "militaire", "renseignement"],
    "Institutions":        ["constitution", "organique", "referendum", "election", "parlement", "assemblee"],
}

def _vote_theme(title: str) -> str:
    if not isinstance(title, str):
        return "Autres"
    tl = _strip_accents(title.lower())
    for theme, kws in _VOTE_THEMES.items():
        if any(k in tl for k in kws):
            return theme
    return "Autres"


_THEME_LIST = list(_VOTE_THEMES.keys()) + ["Autres"]

def _vote_theme_llm(title: str) -> str:
    """Classification sémantique via Ollama ; fallback keyword si Ollama indispo ou inutile."""
    kw = _vote_theme(title)
    if kw != "Autres":
        return kw  # keywords suffisent → pas d'appel LLM
    if not title or len(title) < 8:
        return "Autres"
    themes_str = " | ".join(_THEME_LIST)
    prompt = (
        f"Classe ce titre de vote parlementaire français dans UN SEUL thème parmi : {themes_str}\n"
        f"Titre : « {title[:200]} »\n"
        f"Réponds uniquement par le nom exact du thème, rien d'autre."
    )
    result = _ollama_simple(prompt, max_tokens=15, cache_key="theme:" + title[:80])
    for t in _THEME_LIST:
        if t.lower() in result.lower():
            return t
    return "Autres"


def _ollama_sentiment(text: str) -> tuple[float, str]:
    """Sentiment d'un texte politique via Ollama. Retourne (score ∈ [-1,1], label)."""
    prompt = (
        f"Analyse le sentiment de cet article de presse politique français.\n"
        f"Texte : « {text[:500]} »\n"
        f'Réponds uniquement en JSON : {{"score": float entre -1.0 et 1.0, "label": "POSITIVE" ou "NEGATIVE" ou "NEUTRAL"}}'
    )
    result = _ollama_simple(prompt, max_tokens=60, cache_key="sent:" + text[:80])
    if result:
        m = re.search(r'\{[^}]+\}', result)
        if m:
            try:
                d = json.loads(m.group())
                score = float(d.get("score", 0.0))
                label = str(d.get("label", "NEUTRAL")).upper()
                if label not in ("POSITIVE", "NEGATIVE", "NEUTRAL"):
                    label = "NEUTRAL"
                return round(max(-1.0, min(1.0, score)), 4), label
            except Exception:
                pass
    return 0.0, "UNKNOWN"


@app.get("/api/dashboard/votes")
def dashboard_votes():
    vt = (_df_votes if _df_votes is not None else pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)).copy()
    for col in ["votesFor", "votesAgainst", "votesAbstain", "totalVotes"]:
        if col in vt.columns:
            vt[col] = pd.to_numeric(vt[col], errors="coerce").fillna(0)

    resultats = vt["result"].value_counts().to_dict()
    par_annee = (
        vt["annee_vote"].dropna()
        .pipe(lambda s: pd.to_numeric(s, errors="coerce").dropna())
        .astype(int).astype(str)
        .value_counts().sort_index().to_dict()
    )

    # Thèmes
    vt["_theme"] = vt["title"].apply(_vote_theme)
    par_theme = {}
    for theme, grp in vt.groupby("_theme"):
        n = len(grp)
        adopted = int((grp["result"] == "ADOPTED").sum())
        par_theme[theme] = {
            "total":    n,
            "adopted":  adopted,
            "rejected": int((grp["result"] == "REJECTED").sum()),
            "taux":     round(adopted / n * 100, 1) if n > 0 else 0,
        }

    # Marges
    if "marge" in vt.columns:
        marge_abs = vt["marge"].abs()
    else:
        marge_abs = (vt["votesFor"] - vt["votesAgainst"]).abs()

    serres_df     = vt[marge_abs <= 20]
    equilibres_df = vt[(marge_abs > 20) & (marge_abs < 100)]
    decisifs_df   = vt[marge_abs >= 100]

    return {
        "total":     len(vt),
        "resultats": resultats,
        "par_annee": par_annee,
        "par_theme": par_theme,
        "votes_serres":      int((marge_abs <= 20).sum()),
        "votes_equilibres":  int(((marge_abs > 20) & (marge_abs < 100)).sum()),
        "votes_decisifs":    int((marge_abs >= 100).sum()),
        "themes_serres":     serres_df["_theme"].value_counts().head(5).to_dict(),
        "themes_equilibres": equilibres_df["_theme"].value_counts().head(5).to_dict(),
        "themes_decisifs":   decisifs_df["_theme"].value_counts().head(5).to_dict(),
        "moyenne_pour":    round(float(vt["votesFor"].mean()    or 0), 1),
        "moyenne_contre":  round(float(vt["votesAgainst"].mean() or 0), 1),
        "moyenne_abstain": round(float(vt["votesAbstain"].mean() or 0), 1),
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

# Cache TTL pour les appels proxy (évite les doubles aller-retours réseau)
_pg_cache: dict = {}   # key → {"data": ..., "at": float}
_PG_TTL = 600          # 10 minutes

def _pg(path: str, params: dict = None, cache: bool = True):
    """Appel générique vers l'API Poligraph avec cache TTL optionnel."""
    cache_key = (path, tuple(sorted((params or {}).items())))
    if cache:
        entry = _pg_cache.get(cache_key)
        if entry and time.time() - entry["at"] < _PG_TTL:
            return entry["data"]

    r = http_requests.get(f"{POLIGRAPH_BASE}/{path}", params=params,
                          headers=PROXY_HEADERS, timeout=15)
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Ressource introuvable")
    r.raise_for_status()
    data = r.json()
    if cache:
        _pg_cache[cache_key] = {"data": data, "at": time.time()}
    return data


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


@app.get("/api/proxy/partis/{slug}/membres")
def proxy_partis_membres(slug: str, limit: int = 50, page: int = 1):
    """
    Membres d'un parti — depuis nos données locales (elus_features.csv).
    Le slug peut être le shortName (ex: 'RN') ou le nom complet slug (ex: 'rassemblement-national').
    """
    el = _df_elus
    if el is None or el.empty:
        return {"data": [], "pagination": {"total": 0, "page": 1, "totalPages": 1}}

    # Normalise le slug : shortName (RN) ou slug-name (rassemblement-national → RN via mapping)
    slug_upper = slug.upper()
    # Essai 1 : match direct sur party_short
    subset = el[el["party_short"].str.upper() == slug_upper]
    # Essai 2 : match sur party_name slug-ified
    if subset.empty and "party_name" in el.columns:
        subset = el[el["party_name"].fillna("").str.lower().str.replace(r"[^a-z0-9]+", "-", regex=True) == slug.lower()]

    subset = subset.dropna(subset=["slug"])
    total  = len(subset)
    offset = (page - 1) * limit
    page_df = subset.iloc[offset: offset + limit]

    records = page_df[["slug", "fullName", "firstName", "lastName", "photoUrl", "party_short", "party_name"]].fillna("").to_dict("records")
    data = [
        {
            "slug":      r["slug"],
            "fullName":  r["fullName"],
            "firstName": r["firstName"],
            "lastName":  r["lastName"],
            "photoUrl":  r["photoUrl"] or None,
            "party":     {"shortName": r["party_short"], "name": r["party_name"]},
        }
        for r in records
    ]

    return {
        "data": data,
        "pagination": {
            "total":      total,
            "page":       page,
            "limit":      limit,
            "totalPages": max(1, -(-total // limit)),
        },
    }


# ── Fact-checks ───────────────────────────────────────────────────────────────

@app.get("/api/proxy/factchecks")
def proxy_factchecks(q: str = "", verdictRating: str = "", source: str = "",
                     limit: int = 20, page: int = 1):
    """Fact-checks depuis poligraph.fr (817 vérifications). Cache 10 min."""
    params: dict = {"limit": limit, "page": page}
    if q:             params["search"] = q
    if verdictRating: params["verdictRating"] = verdictRating
    if source:        params["source"] = source
    return _pg("factchecks", params)


@app.get("/api/proxy/politiques/{slug}/factchecks")
def proxy_politiques_factchecks(slug: str, limit: int = 20, page: int = 1):
    """Fact-checks d'un politicien donné."""
    return _pg(f"politiques/{slug}/factchecks", {"limit": limit, "page": page})


def _all_factchecks_cached() -> list:
    """Récupère (et met en cache 30 min) tous les fact-checks paginés."""
    cache_key = ("all_fc_raw", "v1")
    entry = _pg_cache.get(cache_key)
    if entry and time.time() - entry["at"] < 1800:
        return entry["data"]
    all_fc: list = []
    page = 1
    while len(all_fc) < 1200 and page <= 12:
        try:
            d = _pg("factchecks", {"limit": 100, "page": page}, cache=True)
            batch = d.get("data") or []
            if not batch:
                break
            all_fc.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        except Exception:
            break
    _pg_cache[cache_key] = {"data": all_fc, "at": time.time()}
    return all_fc


@app.get("/api/search/factchecks")
def search_factchecks_local(q: str = "", verdictRating: str = "", source: str = "", limit: int = 50, claimant: str = ""):
    """
    Recherche locale multi-champs sur tous les fact-checks cachés.
    - claimant=<nom> : filtre strict sur le champ claimant (pour les déclarations d'un politicien)
    - q=<texte>      : recherche tokenisée dans claimText, claimant, politiciens, titre
    """
    import unicodedata, re as _re

    def _norm(s: str) -> str:
        return ''.join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                       if unicodedata.category(c) != "Mn")

    results = _all_factchecks_cached()

    if verdictRating:
        results = [fc for fc in results if fc.get("verdictRating") == verdictRating]
    if source:
        results = [fc for fc in results if fc.get("source", "") == source]

    # Filtre strict sur le claimant (déclarations faites PAR ce politicien)
    if claimant:
        cn = _norm(claimant)
        def _claimant_match(fc):
            c = _norm(fc.get("claimant") or "")
            return bool(c) and (cn in c or c in cn)
        results = [fc for fc in results if _claimant_match(fc)]
        results = sorted(results, key=lambda fc: fc.get("publishedAt") or "", reverse=True)[:limit]
        return {"data": results, "total": len(results), "searched_corpus": len(_all_factchecks_cached())}

    if q:
        tokens = [t for t in _re.split(r'\s+', _norm(q).strip()) if len(t) > 1]

        def _score(fc):
            parts = [
                fc.get("claimText") or "",
                fc.get("claimant") or "",
                fc.get("articleTitle") or "",
                fc.get("source") or "",
            ]
            for p in (fc.get("politicians") or []):
                parts.append(p.get("fullName") or "")
            text = _norm(" ".join(parts))
            return sum(2 if tok in text else 0 for tok in tokens)

        scored = [(fc, _score(fc)) for fc in results]
        scored = [x for x in scored if x[1] > 0]
        scored.sort(key=lambda x: -x[1])
        results = [fc for fc, _ in scored[:limit]]
    else:
        results = sorted(results, key=lambda fc: fc.get("publishedAt") or "", reverse=True)[:limit]

    return {"data": results, "total": len(results), "searched_corpus": len(_all_factchecks_cached())}


@app.get("/api/proxy/politiques/{slug}/bio")
def get_politician_bio(slug: str):
    """Génère une biographie courte via Ollama à partir des mandats et scandales de l'élu."""
    cache_key = f"bio:{slug}"
    if cache_key in _ollama_txt_cache:
        return {"bio": _ollama_txt_cache[cache_key], "source": "cache"}

    try:
        profile_data = _pg(f"politiques/{slug}", {})
    except Exception:
        raise HTTPException(404, "Élu introuvable")

    name    = profile_data.get("fullName") or slug
    mandats = profile_data.get("mandates") or []
    party   = (profile_data.get("party") or {}).get("shortName", "")

    mandats_str = "; ".join(
        f"{m.get('title', '')} ({m.get('institution', '')})"
        for m in mandats[:6]
    ) or "Aucun mandat connu"

    try:
        aff_data = _pg(f"politiques/{slug}/affairs", {"limit": 3})
        affairs  = [a.get("title", "") for a in (aff_data.get("affairs") or [])[:3] if a.get("title")]
        aff_str  = "; ".join(affairs) if affairs else ""
    except Exception:
        aff_str = ""

    prompt = (
        f"Écris une biographie factuelle et neutre (3-4 phrases) en français pour {name}"
        f"{', membre du ' + party if party else ''}.\n"
        f"Mandats : {mandats_str}.\n"
        f"{'Affaires judiciaires connues : ' + aff_str + '.' if aff_str else ''}\n"
        f"Ton encyclopédique. Ne pas inventer de faits absents des informations fournies."
    )
    bio = _ollama_simple(
        prompt,
        system="Tu es un rédacteur encyclopédique neutre spécialisé en politique française.",
        max_tokens=280,
        cache_key=cache_key,
    )
    if not bio:
        return {"bio": None, "source": "unavailable"}
    return {"bio": bio, "source": "ollama"}


@app.get("/api/dashboard/factchecks")
def dashboard_factchecks():
    """
    Agrège tous les fact-checks (817) depuis poligraph.fr.
    Cache 30 minutes — calcule classements politiciens, partis, verdicts, sources.
    """
    cache_key = ("dashboard_fc", "v3")
    entry = _pg_cache.get(cache_key)
    if entry and time.time() - entry["at"] < 1800:
        return entry["data"]

    # Récupère toutes les pages
    all_fc = []
    page = 1
    while True:
        try:
            d = _pg("factchecks", {"limit": 100, "page": page}, cache=False)
            batch = d.get("data") or []
            if not batch:
                break
            all_fc.extend(batch)
            if len(all_fc) >= (d.get("pagination") or {}).get("total", 0):
                break
            page += 1
            if page > 15:
                break
        except Exception:
            break

    # Groupes de verdicts
    TRUE_GROUP  = {"TRUE", "MOSTLY_TRUE"}
    MID_GROUP   = {"HALF_TRUE", "MISLEADING"}
    FALSE_GROUP = {"FALSE", "MOSTLY_FALSE"}
    UNK_GROUP   = {"UNVERIFIABLE"}

    def score(fc_list):
        total = len(fc_list)
        if total == 0:
            return None
        t = sum(1 for f in fc_list if f.get("verdictRating") in TRUE_GROUP)
        m = sum(1 for f in fc_list if f.get("verdictRating") in MID_GROUP)
        fa = sum(1 for f in fc_list if f.get("verdictRating") in FALSE_GROUP)
        u = sum(1 for f in fc_list if f.get("verdictRating") in UNK_GROUP)
        # Laplace-smoothed net score — prevents small-sample inflation and
        # guarantees a single ordering so no entity appears in both "reliable" and "unreliable".
        adj_v = (t  + 1) / (total + 2)
        adj_f = (fa + 1) / (total + 2)
        return {
            "total":    total,
            "vrai":     t,  "pct_vrai":  round(t  / total * 100),
            "trompeur": m,  "pct_trompeur": round(m / total * 100),
            "faux":     fa, "pct_faux":  round(fa / total * 100),
            "invefi":   u,  "pct_invefi": round(u / total * 100),
            "net_score": round((adj_v - adj_f) * 100, 1),
        }

    # ── Agrégation par politicien ─────────────────────────────────────────
    # own_fc  = déclarations FAITES PAR le politicien → fiabilité personnelle
    # about_fc = déclarations À SON SUJET faites par d'autres → réputation/exposition
    by_pol: dict = {}
    for fc in all_fc:
        claimant = (fc.get("claimant") or "").strip().lower()
        pols = fc.get("politicians") or []
        if isinstance(pols, str):
            try: pols = ast.literal_eval(pols)
            except Exception: pols = []
        # Identifie le slug du locuteur parmi les politiciens listés
        claimant_slug = None
        for p in pols:
            if p.get("fullName", "").strip().lower() == claimant:
                claimant_slug = p.get("slug")
                break
        for p in pols:
            slug = p.get("slug") or ""
            if not slug:
                continue
            if slug not in by_pol:
                by_pol[slug] = {
                    "name":     p.get("fullName", slug),
                    "party":    (p.get("currentParty") or {}).get("shortName", ""),
                    "own_fc":   [],   # claims BY this politician
                    "about_fc": [],   # claims ABOUT this politician
                }
            if slug == claimant_slug:
                by_pol[slug]["own_fc"].append(fc)
            else:
                by_pol[slug]["about_fc"].append(fc)

    pol_honesty = [
        {
            "slug":          s,
            "name":          d["name"],
            "party":         d["party"],
            "nb_déclarations": len(d["own_fc"]),
            "nb_mentions":   len(d["about_fc"]),
            **score(d["own_fc"]),
        }
        for s, d in by_pol.items() if len(d["own_fc"]) >= 3
    ]
    _pol_ordered   = sorted(pol_honesty, key=lambda x: -x["net_score"])
    most_reliable  = _pol_ordered[:10]
    least_reliable = list(reversed(_pol_ordered[-10:]))

    # Les plus mentionnés dans des fact-checks (toutes déclarations confondues)
    most_mentioned = sorted(
        [{"slug": s, "name": d["name"], "party": d["party"],
          "total_mentions": len(d["own_fc"]) + len(d["about_fc"]),
          "nb_déclarations": len(d["own_fc"]), "nb_mentions": len(d["about_fc"])}
         for s, d in by_pol.items()],
        key=lambda x: -x["total_mentions"]
    )[:10]

    # ── Agrégation par parti ──────────────────────────────────────────────
    # Même distinction : own = locuteur du parti, about = mentionné
    by_party: dict = {}
    for fc in all_fc:
        claimant = (fc.get("claimant") or "").strip().lower()
        pols = fc.get("politicians") or []
        if isinstance(pols, str):
            try: pols = ast.literal_eval(pols)
            except Exception: pols = []
        claimant_slug = None
        for p in pols:
            if p.get("fullName", "").strip().lower() == claimant:
                claimant_slug = p.get("slug")
                break
        for p in pols:
            party = (p.get("currentParty") or {}).get("shortName") or ""
            if not party:
                continue
            if party not in by_party:
                by_party[party] = {
                    "name":     (p.get("currentParty") or {}).get("name", party),
                    "color":    (p.get("currentParty") or {}).get("color", "#999"),
                    "own_fc":   [],
                    "about_fc": [],
                }
            if p.get("slug") == claimant_slug:
                by_party[party]["own_fc"].append(fc)
            else:
                by_party[party]["about_fc"].append(fc)

    party_scores = [
        {"short": s, "name": d["name"], "color": d["color"],
         "nb_déclarations": len(d["own_fc"]), "nb_mentions": len(d["about_fc"]),
         **score(d["own_fc"])}
        for s, d in by_party.items() if len(d["own_fc"]) >= 3
    ]
    _party_ordered   = sorted(party_scores, key=lambda x: -x["net_score"])
    most_reliable_p  = _party_ordered[:8]
    least_reliable_p = list(reversed(_party_ordered[-8:]))

    # ── Verdicts globaux ──────────────────────────────────────────────────
    overall = score(all_fc)

    # ── Par source ────────────────────────────────────────────────────────
    from collections import Counter
    src_counts = Counter(fc.get("source", "?") for fc in all_fc)

    result = {
        "total":             len(all_fc),
        "verdicts_globaux":  overall,
        "sources":           [{"name": s, "count": c} for s, c in src_counts.most_common(10)],
        "most_reliable":     most_reliable,
        "least_reliable":    least_reliable,
        "most_reliable_p":   most_reliable_p,
        "least_reliable_p":  least_reliable_p,
        "most_mentioned":    most_mentioned,
    }
    _pg_cache[cache_key] = {"data": result, "at": time.time()}
    return result


@app.get("/api/proxy/scrutins/{scrutin_ref}/groupes")
def proxy_scrutin_groupes(scrutin_ref: str):
    """
    Répartition des votes par groupe parlementaire pour un scrutin.
    Scrappe la page HTML de l'Assemblée nationale (seule source disponible).
    scrutin_ref : externalId complet (ex: VTANR5L17V7162) ou URL source.
    """
    # Extraire legislature et numéro depuis externalId (ex: VTANR5L17V7162)
    m = re.match(r"VTANR5L(\d+)V(\d+)", scrutin_ref)
    if not m:
        return {"groupes": []}
    legislature, numero = m.group(1), m.group(2)

    url = f"https://www.assemblee-nationale.fr/dyn/{legislature}/scrutins/{numero}"
    cache_key = ("an_groupes", scrutin_ref)
    entry = _pg_cache.get(cache_key)
    if entry and time.time() - entry["at"] < _PG_TTL:
        return entry["data"]

    try:
        r = http_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
        r.raise_for_status()
        html = r.content.decode("iso-8859-1")
    except Exception:
        return {"groupes": []}

    groupes = []
    for block in re.split(r'data-organe-id="PO\d+"', html)[1:]:
        name_m   = re.search(r'title="Acc[^"]+(?:groupe|group)\s+([^"]{5,80})"', block, re.IGNORECASE)
        pour_m   = re.search(r"Pour\s*:\s*(\d+)",         block)
        contre_m = re.search(r"Contre\s*:\s*(\d+)",       block)
        abs_m    = re.search(r"Abstention\s*:\s*(\d+)",   block)
        nv_m     = re.search(r"Non\s*votant\s*:\s*(\d+)", block)
        color_m  = re.search(r"color:\s*(#[0-9a-fA-F]{6})", block)
        if not (pour_m or contre_m):
            continue
        import html as _html
        name = _html.unescape(name_m.group(1).strip()) if name_m else "?"
        pour = int(pour_m.group(1)) if pour_m else 0
        contre = int(contre_m.group(1)) if contre_m else 0
        abstention = int(abs_m.group(1)) if abs_m else 0
        nonVotant  = int(nv_m.group(1))  if nv_m  else 0
        total = pour + contre + abstention + nonVotant
        groupes.append({
            "name":        name,
            "shortName":   name[:6],
            "pour":        pour,
            "contre":      contre,
            "abstention":  abstention,
            "nonVotant":   nonVotant,
            "total":       total,
            "taux_pour":   round(pour / total * 100, 1) if total > 0 else 0,
            "color":       color_m.group(1) if color_m else "#999",
        })

    data = {"groupes": groupes}
    _pg_cache[cache_key] = {"data": data, "at": time.time()}
    return data


# ── Matrice parti × thème ──────────────────────────────────────────────────────
# Un représentant par parti → votes récents → classification thématique → matrice
_PARTY_REPS = {
    # RN — 3 élus pour couvrir Environnement + Éducation
    "marine-le-pen":        ("RN",    "Rassemblement National",  "#0D378A"),
    "jean-philippe-tanguy": ("RN",    "Rassemblement National",  "#0D378A"),
    # LFI
    "manuel-bompard":       ("LFI",   "La France insoumise",     "#C5294B"),
    "mathilde-panot":       ("LFI",   "La France insoumise",     "#C5294B"),
    # RE — 3 élus pour couvrir Environnement + Éducation
    "gabriel-attal":        ("RE",    "Renaissance",             "#EF7B21"),
    "jean-rene-cazeneuve":  ("RE",    "Renaissance",             "#EF7B21"),
    "benjamin-haddad":      ("RE",    "Renaissance",             "#EF7B21"),
    # MoDem — marc-fesneau très actif (Agri/Env/Edu)
    "jean-paul-mattei":     ("MoDem", "Mouvement démocrate",     "#0066CC"),
    "marc-fesneau":         ("MoDem", "Mouvement démocrate",     "#0066CC"),
    # EELV
    "cyrielle-chatelain":   ("EELV",  "Les Écologistes",         "#2DA84A"),
    "sandra-regol":         ("EELV",  "Les Écologistes",         "#2DA84A"),
    # PS (+ Dominique Potier actif Environnement, Guillaume Garot Éducation)
    "olivier-faure":        ("PS",    "Parti socialiste",        "#E75480"),
    "boris-vallaud":        ("PS",    "Parti socialiste",        "#E75480"),
    "dominique-potier":     ("PS",    "Parti socialiste",        "#E75480"),
    "guillaume-garot":      ("PS",    "Parti socialiste",        "#E75480"),
    # HOR (+ Agnès Firmin Le Bodo active Santé/Éducation, Marc Ferracci Environnement)
    "laurent-marcangeli":   ("HOR",   "Horizons",                "#00B5D8"),
    "frederic-valletoux":   ("HOR",   "Horizons",                "#00B5D8"),
    "marc-ferracci":        ("HOR",   "Horizons",                "#00B5D8"),
    "agnes-firmin-le-bodo": ("HOR",   "Horizons",                "#00B5D8"),
    # LR
    "annie-genevard":       ("LR",    "Les Républicains",        "#003189"),
    "eric-ciotti":          ("LR",    "Les Républicains",        "#003189"),
}

@app.get("/api/proxy/party-matrix")
def proxy_party_matrix(limit: int = 300):
    """
    Matrice parti × thème législatif.
    Pour chaque parti, agrège les votes (pour/contre/abstention) par thème
    à partir des positions individuelles d'un élu représentatif.
    """
    pages = max(1, min(limit // 100, 10))  # 1 page per 100 votes, cap 10 pages

    def fetch_votes_for(slug: str):
        all_votes = []
        try:
            for page in range(1, pages + 1):
                d = _pg(f"politiques/{slug}/votes", {"limit": 100, "page": page})
                batch = d.get("votes") or []
                all_votes.extend(batch)
                if len(batch) < 100:
                    break
        except Exception:
            pass
        return {"votes": all_votes}

    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {slug: pool.submit(fetch_votes_for, slug) for slug in _PARTY_REPS}
        results = {slug: fut.result() for slug, fut in futures.items()}

    # Agrégation par parti (plusieurs représentants → mêmes compteurs)
    party_themes: dict = {}  # short → {theme → {pour, contre, abstention}}
    party_meta:   dict = {}  # short → (name, color)

    for slug, data in results.items():
        short, name, color = _PARTY_REPS[slug]
        party_meta[short] = (name, color)
        if short not in party_themes:
            party_themes[short] = {}

        for v in (data.get("votes") or []):
            sc    = v.get("scrutin") or {}
            theme = _vote_theme_llm(sc.get("title") or "")
            pos   = (v.get("position") or "").upper()
            if theme not in party_themes[short]:
                party_themes[short][theme] = {"pour": 0, "contre": 0, "abstention": 0}
            if pos == "POUR":
                party_themes[short][theme]["pour"] += 1
            elif pos == "CONTRE":
                party_themes[short][theme]["contre"] += 1
            elif pos in ("ABSTENTION", "ABSTAIN"):
                party_themes[short][theme]["abstention"] += 1

    matrix: dict = {}
    for short, themes_agg in party_themes.items():
        name, color = party_meta[short]
        for counts in themes_agg.values():
            tot = counts["pour"] + counts["contre"] + counts["abstention"]
            counts["total"]   = tot
            counts["pctPour"] = round(counts["pour"] / tot * 100, 1) if tot > 0 else None
        matrix[short] = {"name": name, "color": color, "themes": themes_agg}

    return matrix


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


_RSS_UA = "PoliGraph/1.0 (github.com/AlixROBIN/Poligraph-app; contact: alixanniv@gmail.com)"


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




def _fetch_google_news(source_key: str, query: str) -> list[dict]:
    url = f"https://news.google.com/rss/search?q={query}&hl=fr&gl=FR&ceid=FR:fr"
    try:
        feed = _fetch_feed(url)
        batch = []
        for entry in feed.entries[:15]:
            link = entry.get("link") or entry.get("id") or ""
            batch.append({
                "id":              hashlib.sha256(link.encode()).hexdigest()[:16],
                "title":           _strip_html(entry.get("title", "")),
                "summary":         _strip_html(entry.get("summary", "") or "")[:600],
                "source":          source_key,
                "source_label":    SOURCE_LABELS.get(source_key, source_key),
                "url":             link,
                "published_at":    entry.get("published", ""),
                "sentiment":       None, "sentiment_label": None,
                "entities":        [], "keywords":          [], "enriched": False,
            })
        _metric_ok(source_key, len(batch))
        return batch
    except Exception as exc:
        _metric_err(source_key)
        logger.debug(f"[Google News] {source_key} : {exc}")
        return []


def _enrich_with_sentiment(articles: list[dict]) -> list[dict]:
    """Score les articles sans sentiment : VADER/transformers d'abord, Ollama en fallback."""
    to_score = [i for i, a in enumerate(articles) if a.get("sentiment") is None]
    if not to_score:
        return articles
    # Tentative 1 : sentiment_utils (VADER / CamemBERT)
    scored_indices = set()
    try:
        sys.path.insert(0, str(ROOT_DIR / "pipeline"))
        from sentiment_utils import score_texts_with_labels  # type: ignore[import]
        texts = [articles[i]["title"] + " " + articles[i].get("summary", "") for i in to_score]
        scored = score_texts_with_labels(texts)
        for idx, result in zip(to_score, scored):
            articles[idx]["sentiment"]       = round(result["score"], 4)
            articles[idx]["sentiment_label"] = result["label"]
            articles[idx]["enriched"]        = True
            scored_indices.add(idx)
    except Exception as exc:
        logger.debug(f"Enrichissement sentiment RSS (VADER) : {exc}")
    # Tentative 2 : Ollama pour les articles non scorés
    remaining = [i for i in to_score if i not in scored_indices]
    for idx in remaining:
        a = articles[idx]
        text = a.get("title", "") + " " + a.get("summary", "")
        score, label = _ollama_sentiment(text.strip())
        if label != "UNKNOWN":
            articles[idx]["sentiment"]       = score
            articles[idx]["sentiment_label"] = label
            articles[idx]["enriched"]        = True
    return articles


def _scrape_rss_cached() -> list[dict]:
    from datetime import datetime, timezone
    now = time.time()
    if now - _rss_cache["fetched_at"] < _RSS_TTL and _rss_cache["articles"]:
        return _rss_cache["articles"]

    # ── Tâches à paralléliser ──────────────────────────────────
    def fetch_rss(source, url):
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
                    "sentiment":       None, "sentiment_label": None,
                    "entities":        [], "keywords":          [], "enriched": False,
                })
            _metric_ok(source, len(batch))
            return batch
        except Exception as exc:
            _metric_err(source)
            logger.debug(f"RSS {source} : {exc}")
            return []

    tasks = []
    tasks += [(fetch_rss,          (src, url)) for src, url in RSS_FEEDS]
    tasks += [(_fetch_google_news, (sk, q))    for sk, q   in GOOGLE_NEWS_QUERIES]

    articles = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(fn, *args) for fn, args in tasks]
        for fut in as_completed(futures):
            try:
                articles.extend(fut.result() or [])
            except Exception:
                pass

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
    except (WebSocketDisconnect, Exception):
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
# Backends : Groq / Ollama / Claude selon LLM_BACKEND
#
# Variables d'environnement :
#   LLM_BACKEND      = "ollama" (défaut) | "groq" | "claude"
#   GROQ_API_KEY     = clé Groq           (si backend=groq)
#   GROQ_MODEL       = llama-3.1-8b-instant (défaut)
#   OLLAMA_URL       = http://localhost:11434 (défaut)
#   OLLAMA_MODEL     = llama3.1:8b          (défaut)
#   ANTHROPIC_API_KEY= clé Claude           (si backend=claude)
#   CLAUDE_MODEL     = claude-opus-4-8      (défaut)
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


_anthropic_client = None

def _get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                503,
                "ANTHROPIC_API_KEY non configurée. Créez une clé sur https://console.anthropic.com"
            )
        try:
            import anthropic as _ant
            _anthropic_client = _ant.Anthropic(api_key=api_key)
        except ImportError:
            raise HTTPException(503, "Package 'anthropic' non installé. Faire : pip install anthropic")
    return _anthropic_client


# Format Groq/OpenAI : {"type":"function","function":{name,description,parameters}}
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_scandales",
            "description": "Cherche des scandales politiques (258 affaires). parti= = code exact. Jamais parti= et q= ensemble.",
            "parameters": {
                "type": "object",
                "properties": {
                    "q":        {"type": "string", "description": "Texte libre (titre/description/politicien)"},
                    "category": {
                        "type": "string",
                        "enum": ["DETOURNEMENT_FONDS_PUBLICS", "DIFFAMATION", "INCITATION_HAINE",
                                 "VIOLENCE", "PRISE_ILLEGALE_INTERETS", "EMPLOI_FICTIF",
                                 "HARCELEMENT_MORAL", "INJURE", "FINANCEMENT_ILLEGAL_CAMPAGNE",
                                 "FAVORITISME", "ABUS_CONFIANCE", "AGRESSION_SEXUELLE",
                                 "CORRUPTION", "ABUS_BIENS_SOCIAUX", "FRAUDE_FISCALE", "AUTRE"],
                    },
                    "parti": {
                        "type": "string",
                        "enum": ["RN", "LR", "LFI", "RE", "PS", "EELV", "HOR", "MoDem", "NFP", "FN", "NI", "REC"],
                    },
                    "statut": {
                        "type": "string",
                        "enum": ["CONDAMNATION_DEFINITIVE", "ENQUETE_PRELIMINAIRE",
                                 "CLASSEMENT_SANS_SUITE", "APPEL_EN_COURS", "RELAXE",
                                 "CONDAMNATION_PREMIERE_INSTANCE", "INSTRUCTION",
                                 "RENVOI_TRIBUNAL", "NON_LIEU", "MISE_EN_EXAMEN", "PROCES_EN_COURS"],
                    },
                    "annee_min": {"type": "string", "description": "Année min (ex: '2015')"},
                    "annee_max": {"type": "string", "description": "Année max (ex: '2024')"},
                    "limit":     {"type": "string", "description": "Plafonné à 8 côté serveur, inutile de demander plus"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_votes",
            "description": "Cherche parmi 9871 votes parlementaires (2017-2026). q= = mots-clés du titre.",
            "parameters": {
                "type": "object",
                "properties": {
                    "q":      {"type": "string",  "description": "Mots-clés dans le titre du vote/loi"},
                    "result": {"type": "string",  "enum": ["ADOPTED", "REJECTED"]},
                    "annee":  {"type": "string", "description": "Année du vote (ex: '2022')"},
                    "limit":  {"type": "string", "description": "défaut 10, max 30"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_statistics",
            "description": "Comptages agrégés (catégorie/parti/statut). Avec parti= : répartition pour CE parti. Préférer à search_scandales pour comparer des partis.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type":      {"type": "string", "enum": ["scandales", "votes", "partis", "elus"]},
                    "parti":     {"type": "string", "description": "Filtrer scandales par parti (ex: RN)"},
                    "annee_min": {"type": "string", "description": "Filtrer scandales : année min des faits (ex: '2020')"},
                    "annee_max": {"type": "string", "description": "Filtrer scandales : année max des faits"},
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_articles",
            "description": "Articles de presse récents (Le Monde, Le Figaro, Libération, France Info, Le Point, Google News).",
            "parameters": {
                "type": "object",
                "properties": {
                    "q":     {"type": "string",  "description": "Mots-clés dans le titre ou résumé"},
                    "limit": {"type": "string", "description": "défaut 8, max 20"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_politician_profile",
            "description": "Profil détaillé d'un élu français (parti, institution, position, âge).",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":  {"type": "string", "description": "Nom du politicien"},
                    "parti": {"type": "string", "description": "Pour affiner si homonymes"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_political_figure",
            "description": "Analyse croisée d'un politicien : presse récente (sentiment, mots-clés) + affaires DB + profil élu. Outil principal pour toute question sur une personnalité politique donnée.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":  {"type": "string", "description": "Nom du politicien (ex: 'Marine Le Pen')"},
                    "parti": {"type": "string", "description": "Optionnel, pour affiner"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "semantic_search",
            "description": "Recherche sémantique (258 scandales + 817 fact-checks), par similarité — à utiliser si search_scandales/search_factchecks ne donnent rien.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query":  {"type": "string", "description": "Requête en langage naturel"},
                    "source": {"type": "string", "enum": ["all", "scandale", "factcheck"]},
                    "limit":  {"type": "string", "description": "défaut 8, max 15"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_factchecks",
            "description": "Fact-checks de politiciens français (AFP Factuel, TF1 Info, Franceinfo, Le Monde…), avec verdict (TRUE/FALSE/MISLEADING).",
            "parameters": {
                "type": "object",
                "properties": {
                    "q":       {"type": "string", "description": "Mots-clés (déclaration ou politicien)"},
                    "verdict": {
                        "type": "string",
                        "enum": ["TRUE", "MOSTLY_TRUE", "HALF_TRUE", "MISLEADING",
                                 "FALSE", "MOSTLY_FALSE", "UNVERIFIABLE"],
                    },
                    "source":  {"type": "string", "description": "Ex: 'AFP Factuel', 'Le Monde'"},
                    "limit":   {"type": "string", "description": "défaut 10, max 30"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_factcheck",
            "description": "Extrait (CamemBERT QA) la phrase exacte du corpus qui répond à une question précise sur un fait vérifié — pour un 'pourquoi'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question":   {"type": "string",  "description": "Ex: 'Pourquoi cette déclaration est-elle fausse ?'"},
                    "politician": {"type": "string",  "description": "Optionnel, pour filtrer"},
                    "limit":      {"type": "string", "description": "défaut 5, max 10"},
                },
                "required": ["question"],
            },
        },
    },
]


def _tool_search_scandales(q="", category="", parti="", statut="",
                            annee_min=0, annee_max=9999, limit=10):
    try:
        annee_min = int(annee_min) if annee_min else 0
        annee_max = int(annee_max) if annee_max else 9999
        limit = min(int(limit) if limit else 8, 8)
        sc = _df_scandales if _df_scandales is not None else pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)
        sc = sc.copy()
        if q:
            mask = (
                sc["title"].fillna("").str.contains(q, case=False, na=False, regex=False) |
                sc["description"].fillna("").str.contains(q, case=False, na=False, regex=False) |
                sc["politician_name"].fillna("").str.contains(q, case=False, na=False, regex=False)
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
        results = sc[cols].head(limit).fillna("").to_dict(orient="records")
        # "description" fait ~960 caractères en moyenne (jusqu'à 1567) — non tronquée,
        # elle fait à elle seule exploser le budget TPM Groq dès 2-3 résultats.
        for r in results:
            if "description" in r:
                r["description"] = str(r["description"])[:130]
        return {"total_trouvé": len(sc), "résultats": results}
    except Exception as e:
        return {"erreur": str(e), "résultats": []}


def _tool_search_votes(q="", result="", annee=0, limit=10):
    try:
        annee = int(annee) if annee else 0
        limit = min(int(limit) if limit else 10, 30)
        vt = _df_votes if _df_votes is not None else pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)
        vt = vt.copy()
        if q:
            vt = vt[vt["title"].fillna("").str.contains(q, case=False, na=False, regex=False)]
        if result:
            vt = vt[vt["result"] == result]
        if annee > 0:
            vt = vt[pd.to_numeric(vt["annee_vote"], errors="coerce").fillna(0) == annee]
        cols = ["title", "result", "annee_vote", "legislature",
                "votesFor", "votesAgainst", "votesAbstain", "totalVotes"]
        cols = [c for c in cols if c in vt.columns]
        results = vt[cols].head(limit).fillna("").to_dict(orient="records")
        return {"total_trouvé": len(vt), "résultats": results}
    except Exception as e:
        return {"erreur": str(e), "résultats": []}


def _tool_get_statistics(type: str, parti: str = "", annee_min="", annee_max=""):
    try:
        sc = _df_scandales if _df_scandales is not None else pd.DataFrame()
        vt = _df_votes     if _df_votes     is not None else pd.DataFrame()
        el = _df_elus      if _df_elus      is not None else pd.DataFrame()

        if type == "scandales":
            sc_f = sc[sc["party_short"] == parti.upper()] if parti and "party_short" in sc.columns else sc
            if annee_min and "annee_faits" in sc_f.columns:
                sc_f = sc_f[pd.to_numeric(sc_f["annee_faits"], errors="coerce").fillna(0) >= int(annee_min)]
            if annee_max and "annee_faits" in sc_f.columns:
                sc_f = sc_f[pd.to_numeric(sc_f["annee_faits"], errors="coerce").fillna(9999) <= int(annee_max)]
            return {
                "total":         len(sc_f),
                "filtre_parti":  parti.upper() if parti else "tous",
                "par_catégorie": sc_f["category"].value_counts().head(10).to_dict() if "category" in sc_f.columns else {},
                "par_parti":     sc_f["party_short"].value_counts().head(10).to_dict() if not parti and "party_short" in sc_f.columns else {},
                "par_statut":    sc_f["status"].value_counts().to_dict() if "status" in sc_f.columns else {},
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


def _tool_semantic_search(query: str = "", source: str = "all", limit: int = 8) -> dict:
    """Recherche sémantique TF-IDF dans la base locale (scandales + fact-checks)."""
    if not query:
        return {"erreur": "Paramètre 'query' manquant.", "résultats": []}
    if _rag_vectorizer is None:
        return {"info": "Index RAG en cours de construction, réessayez dans quelques secondes.", "résultats": []}
    results = _rag_search(query, source_filter=source, k=min(int(limit), 15))
    return {"total_trouvé": len(results), "résultats": results}


def _tool_search_factchecks(q: str = "", verdict: str = "", source: str = "", limit: int = 10) -> dict:
    """
    Cherche dans le corpus complet de fact-checks (recherche locale tokenisée).
    Normalise les accents — trouve 'Barnier retraites' même sans accent.
    """
    import unicodedata, re as _re, ast as _ast

    def _norm(s):
        return ''.join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                       if unicodedata.category(c) != "Mn")
    try:
        items = _all_factchecks_cached()
        if verdict: items = [fc for fc in items if fc.get("verdictRating") == verdict]
        if source:  items = [fc for fc in items if (fc.get("source") or "") == source]

        if q:
            tokens = [t for t in _re.split(r'\s+', _norm(q).strip()) if len(t) > 1]

            def _score(fc):
                parts = [fc.get("claimText") or "", fc.get("claimant") or ""]
                for p in (fc.get("politicians") or []):
                    parts.append(p.get("fullName") or "")
                text = _norm(" ".join(parts))
                return sum(2 if tok in text else 0 for tok in tokens)

            scored = sorted([(fc, _score(fc)) for fc in items], key=lambda x: -x[1])
            items  = [fc for fc, s in scored if s > 0][:min(int(limit), 30)]
        else:
            items = sorted(items, key=lambda fc: fc.get("publishedAt") or "", reverse=True)[:int(limit)]

        results = []
        for fc in items:
            pols = fc.get("politicians") or []
            if isinstance(pols, str):
                try: pols = _ast.literal_eval(pols)
                except Exception: pols = []
            results.append({
                "déclaration": (fc.get("claimText") or "")[:250],
                "verdict":     fc.get("verdictRating"),
                "source":      fc.get("source"),
                "date":        (fc.get("publishedAt") or "")[:10],
                "url":         fc.get("sourceUrl") or "",
                "politiciens": [p.get("fullName") for p in pols if isinstance(p, dict) and p.get("fullName")],
            })
        return {"total": len(results), "résultats": results}
    except Exception as e:
        return {"erreur": str(e), "résultats": []}


def _tool_explain_factcheck(question: str, politician: str = "", limit: int = 5) -> dict:
    """
    Répond à une question précise sur des fact-checks via CamemBERT QA.
    1. Cherche les FC pertinents (question + politicien)
    2. Construit un contexte texte
    3. Le modèle extractif trouve la phrase exacte qui répond
    """
    import unicodedata, re as _re, ast as _ast

    def _norm(s):
        return ''.join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                       if unicodedata.category(c) != "Mn")

    q_combined = f"{politician} {question}".strip()
    tokens = [t for t in _re.split(r'\s+', _norm(q_combined)) if len(t) > 1]

    all_fc = _all_factchecks_cached()

    def _score(fc):
        parts = [fc.get("claimText") or "", fc.get("claimant") or ""]
        for p in (fc.get("politicians") or []):
            parts.append(p.get("fullName") or "")
        text = _norm(" ".join(parts))
        return sum(2 if tok in text else 0 for tok in tokens)

    scored = sorted([(fc, _score(fc)) for fc in all_fc], key=lambda x: -x[1])
    # Prend plus de candidats pour re-ranker ensuite avec Granite
    candidates = [fc for fc, s in scored if s > 0][:min(int(limit) * 3, 30)]

    if not candidates:
        return {
            "réponse_extraite": None,
            "confiance": 0.0,
            "fact_checks": [],
            "message": "Aucun fact-check trouvé pour cette question.",
        }

    # ── Re-ranking sémantique avec Granite (si HF disponible) ────────────────
    # Granite comprend le SENS → reclasse les candidats TF-IDF par vraie proximité
    texts_to_embed = [question] + [(fc.get("claimText") or "")[:300] for fc in candidates]
    embs = _hf_embed(texts_to_embed)
    if embs and len(embs) == len(texts_to_embed):
        q_emb    = np.array(embs[0]).reshape(1, -1)
        doc_embs = np.array(embs[1:])
        sims     = cosine_similarity(q_emb, doc_embs).flatten()
        reranked = sorted(zip(candidates, sims.tolist()), key=lambda x: -x[1])
        top_fcs  = [fc for fc, _ in reranked[:min(int(limit), 10)]]
        logger.debug(f"[Embed] Re-ranking Granite : {len(candidates)} → {len(top_fcs)} candidats")
    else:
        top_fcs = candidates[:min(int(limit), 10)]

    # Contexte pour le modèle QA — concaténation des déclarations + verdicts
    parts = []
    for fc in top_fcs:
        v    = fc.get("verdictRating", "?")
        src  = fc.get("source", "?")
        date = (fc.get("publishedAt") or "")[:10]
        txt  = (fc.get("claimText") or "")[:300]
        parts.append(f"[{v}] {src} ({date}) : {txt}")
    context = " | ".join(parts)[:3000]

    qa = _hf_qa_extract(question, context)

    fc_list = []
    for fc in top_fcs:
        pols = fc.get("politicians") or []
        if isinstance(pols, str):
            try: pols = _ast.literal_eval(pols)
            except Exception: pols = []
        fc_list.append({
            "déclaration": (fc.get("claimText") or "")[:250],
            "verdict":     fc.get("verdictRating"),
            "source":      fc.get("source"),
            "date":        (fc.get("publishedAt") or "")[:10],
            "url":         fc.get("sourceUrl") or "",
            "politiciens": [p.get("fullName") for p in pols if isinstance(p, dict)],
        })

    return {
        "réponse_extraite": qa["answer"] or None,
        "confiance":        qa["score"],
        "fact_checks":      fc_list,
    }


def _execute_agent_tool(tool_name: str, tool_input: dict) -> dict:
    dispatch = {
        "search_scandales":        _tool_search_scandales,
        "search_votes":            _tool_search_votes,
        "get_statistics":          _tool_get_statistics,
        "get_recent_articles":     _tool_get_recent_articles,
        "get_politician_profile":  _tool_get_politician_profile,
        "analyze_political_figure": _tool_analyze_political_figure,
        "search_factchecks":       _tool_search_factchecks,
        "semantic_search":         _tool_semantic_search,
        "explain_factcheck":       _tool_explain_factcheck,
    }
    fn = dispatch.get(tool_name)
    if fn is None:
        return {"erreur": f"Outil inconnu : {tool_name}"}
    # Le LLM invente parfois un paramètre absent de la signature (ex: annee_min
    # sur un outil qui ne le supporte pas) — on l'ignore plutôt que de faire
    # échouer tout l'appel, pour rester tolérant aux dérives du modèle.
    accepted = set(inspect.signature(fn).parameters)
    safe_input = {k: v for k, v in tool_input.items() if k in accepted}
    try:
        return fn(**safe_input)
    except TypeError as e:
        return {"erreur": f"Paramètres invalides pour {tool_name} : {e}"}


_AGENT_SYSTEM = """Tu es PoliBot, assistant d'analyse de la vie politique française. Tu réponds UNIQUEMENT à des questions sur : élus/politiciens français, votes Assemblée/Sénat, scandales et affaires judiciaires impliquant des politiques français, partis français, actualité politique française, fact-checks de politiciens français.

Une question sur un élu français EST dans ton périmètre même si elle touche un sujet sensible (terrorisme, racisme, corruption) — la personne citée étant politicienne suffit.
Ne refuse JAMAIS une question vague ou courte mentionnant la politique française (ex: "Actualités ?", "quoi de neuf ?") : appelle `get_recent_articles(limit=8)` d'abord, résume UNIQUEMENT les résultats réels — n'invente jamais un titre/nom/verdict.
Refuse SEULEMENT si hors sujet politique français (recettes, sport, tech...) : "Je suis limité à l'analyse politique française. Je ne peux pas répondre à cette question."

## Mémoire de conversation
Utilise l'historique (12 derniers messages) pour les questions de suivi : si "il/elle/son parti/et lui ?" sans nom explicite, résous depuis le dernier politicien/parti mentionné et réutilise-le dans tes appels d'outils. Ne redemande jamais un nom déjà donné. Nouveau sujet explicite → ignore l'ancien contexte.
Un message assistant peut contenir `[Sources déjà consultées lors de ce tour : ...]` (articles/fact-checks/scandales déjà récupérés). Pour un suivi sur CES sources ("quels journaux en parlent ?"), réponds depuis ce bloc sans le recopier littéralement. Si la source demandée n'y est pas, appelle l'outil concerné.

## Chiffres de référence
258 scandales (RN 58, LR 39, LFI 29, RE 16, PS 11) · 9871 votes (3601 adoptés, 6270 rejetés) · 35095 élus · 817 fact-checks (AFP Factuel, TF1 Info, Franceinfo, Le Monde, Libération, 20 Minutes)

## Outils
- Question sur un politicien → `analyze_political_figure(name=...)` EN PREMIER, toujours (nom résolu depuis l'historique si besoin).
- Scandales d'un parti → `search_scandales(parti="RN")` (code exact, jamais `parti`+`q` ensemble).
- Comparaison/stats entre partis (ex: "compare RN et LFI") → `get_statistics(type="scandales", parti=...)` pour CHAQUE parti, PAS `search_scandales` (bien plus léger). N'ajoute `search_scandales` que si des exemples concrets sont demandés en plus.
- Votes sur un thème → `search_votes(q=...)`.
- Fact-checks (vrai/faux) → `search_factchecks(q=... , verdict=...)`.
- Pourquoi un propos est faux/vrai → `explain_factcheck(question=..., politician=...)` (extrait la phrase exacte du corpus).
- Recherche conceptuelle sans résultats exacts → `semantic_search(query=...)`.

## Sentiment médiatique
Utilise `tonalité_médiatique` (favorable/critique/neutre) et `mots_clés_dominants` de `analyze_political_figure`. N'expose JAMAIS de score numérique brut — traduis en langage naturel ("couverture critique", "ton neutre").

## Règles de réponse
DOIS : citer des faits concrets retournés par les outils (déclaration exacte, date, source, verdict réels — jamais un exemple générique), ex: « Le chômage a baissé de 2 points en 2023 » — AFP Factuel, verdict : Trompeur ; répondre en 3-5 phrases max ; mentionner une absence d'info une seule fois.
NE DOIS PAS : répéter "informations limitées" plusieurs fois ; afficher un score numérique ; faire du remplissage ("il est important de noter que...") ; résumer sans ancrer sur un fait réel.
⛔ N'écris JAMAIS de placeholder entre crochets (ex: "[nom du politicien]", "[source]", "[verdict]") : si la donnée réelle manque, appelle un outil ou dis-le explicitement — jamais d'espace réservé non rempli.

Format libre, direct et factuel, comme un journaliste qui a accès aux données."""

_GROQ_MODEL   = os.getenv("GROQ_MODEL",   "llama-3.1-8b-instant")  # ~20k TPM vs 12k pour llama-3.3-70b
_OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
_CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-4-8")

# ── Modèles NLP HuggingFace ───────────────────────────────────────────────
_HF_API_KEY    = os.getenv("HF_API_KEY", "")
# QA extractif (CamemBERT français) — extrait la phrase qui répond à une question
_HF_QA_MODEL   = os.getenv("HF_QA_MODEL",    "cmarkea/distilcamembert-base-qa")
_HF_QA_URL     = f"https://api-inference.huggingface.co/models/{_HF_QA_MODEL}"
# Embeddings sémantiques multilingues — comprend le sens, pas seulement les mots
_HF_EMBED_MODEL = os.getenv("HF_EMBED_MODEL", "ibm-granite/granite-embedding-311m-multilingual-r2")
_HF_EMBED_URL   = f"https://api-inference.huggingface.co/models/{_HF_EMBED_MODEL}"
# Modèle génératif — formate les réponses (remplace Groq quand LLM_BACKEND=hf)
_HF_GEN_MODEL  = os.getenv("HF_GEN_MODEL", "meta-llama/Llama-3.2-3B-Instruct")
_HF_GEN_URL    = f"https://api-inference.huggingface.co/models/{_HF_GEN_MODEL}/v1/chat/completions"


def _hf_embed(texts: list) -> "list | None":
    """
    Embeddings sémantiques via Granite 311M (HF Inference API).
    Comprend le sens d'une phrase, pas seulement les mots-clés.
    Retourne une liste de vecteurs flottants, None si indisponible.
    """
    if not _HF_API_KEY or not texts:
        return None
    try:
        all_embs: list = []
        for i in range(0, len(texts), 32):
            batch = [str(t)[:512] for t in texts[i:i + 32]]
            resp  = http_requests.post(
                _HF_EMBED_URL,
                headers={"Authorization": f"Bearer {_HF_API_KEY}"},
                json={"inputs": batch},
                timeout=30,
            )
            if resp.status_code == 503:
                logger.warning("[Embed] Granite en cold start")
                return None
            if resp.status_code != 200:
                logger.warning(f"[Embed] API erreur {resp.status_code}: {resp.text[:100]}")
                return None
            data = resp.json()
            # Certains modèles retournent [n, seq_len, dim] (token-level) → mean pool
            if data and isinstance(data[0][0], list):
                data = [list(np.mean(vecs, axis=0)) for vecs in data]
            all_embs.extend(data)
        return all_embs
    except Exception as exc:
        logger.warning(f"[Embed] Échec : {exc}")
        return None


def _hf_qa_extract(question: str, context: str) -> dict:
    """
    Extraction de réponse via CamemBERT QA (HuggingFace Inference API).
    Prend une question + un contexte, retourne la phrase exacte qui répond.
    Retourne {"answer": str, "score": float} — answer="" si indisponible.
    """
    if not _HF_API_KEY or not context.strip() or not question.strip():
        return {"answer": "", "score": 0.0}
    try:
        resp = http_requests.post(
            _HF_QA_URL,
            headers={"Authorization": f"Bearer {_HF_API_KEY}"},
            json={"inputs": {"question": question[:500], "context": context[:3000]}},
            timeout=25,
        )
        if resp.status_code == 503:
            logger.warning("[QA] Modèle en cold start — réponse vide")
            return {"answer": "", "score": 0.0}
        if resp.status_code == 200:
            d = resp.json()
            return {"answer": d.get("answer", ""), "score": round(d.get("score", 0.0), 3)}
        logger.warning(f"[QA] API erreur {resp.status_code}: {resp.text[:100]}")
        return {"answer": "", "score": 0.0}
    except Exception as exc:
        logger.warning(f"[QA] Échec : {exc}")
        return {"answer": "", "score": 0.0}

def _hf_contextual_rag(question: str) -> str:
    """
    Pipeline RAG pré-LLM : Granite semantic search + CamemBERT extraction.
    Appelé sur chaque question utilisateur pour injecter du contexte réel
    dans le prompt avant d'envoyer à Groq.

    Retourne une chaîne formatée (vide si rien de pertinent trouvé).
    """
    if not question.strip() or _rag_vectorizer is None:
        return ""
    try:
        # 1. TF-IDF : candidats initiaux (large filet)
        candidates = _rag_search(question, k=20)
        if not candidates:
            return ""

        # 2. Re-ranking Granite si disponible
        texts_to_embed = [question] + [
            (c.get("content") or c.get("claimText") or c.get("description") or "")[:300]
            for c in candidates
        ]
        embs = _hf_embed(texts_to_embed)
        if embs and len(embs) == len(texts_to_embed):
            q_emb    = np.array(embs[0]).reshape(1, -1)
            doc_embs = np.array(embs[1:])
            sims     = cosine_similarity(q_emb, doc_embs).flatten()
            ranked   = sorted(zip(candidates, sims.tolist()), key=lambda x: -x[1])
            top_docs = [d for d, s in ranked[:6] if s > 0.05]
        else:
            top_docs = candidates[:6]

        if not top_docs:
            return ""

        # 3. Construire le contexte textuel
        ctx_parts = []
        for doc in top_docs:
            src  = doc.get("type", "")
            text = (doc.get("content") or doc.get("claimText") or doc.get("description") or "")[:400]
            meta = doc.get("politician_name") or doc.get("claimant") or ""
            label = f"[{src}] {meta} : {text}" if meta else f"[{src}] {text}"
            ctx_parts.append(label)
        context = " | ".join(ctx_parts)[:3500]

        # 4. CamemBERT : extraction de la phrase qui répond exactement
        qa = _hf_qa_extract(question, context)

        # 5. Formater pour injection dans le prompt
        lines = ["📚 Contexte extrait automatiquement de la base Poligraph (Granite + CamemBERT) :"]
        if qa["answer"] and qa["score"] > 0.08:
            lines.append(f"→ Réponse extraite (confiance {qa['score']:.0%}) : « {qa['answer']} »")
        lines.append("Données sources :")
        for doc in top_docs[:4]:
            src  = doc.get("type", "")
            pol  = doc.get("politician_name") or doc.get("claimant") or ""
            text = (doc.get("content") or doc.get("claimText") or doc.get("description") or "")[:180]
            title = doc.get("title") or ""
            entry = f"  • [{src}]"
            if pol:   entry += f" {pol} —"
            if title: entry += f" « {title[:80]} »"
            else:     entry += f" {text}"
            lines.append(entry)
        return "\n".join(lines)
    except Exception as exc:
        logger.warning(f"[HF-RAG] Échec pipeline contextuel : {exc}")
        return ""


# ── Cache texte Ollama (en mémoire, survit au lifetime du process) ──
_ollama_txt_cache: dict[str, str] = {}

# ── Indicateurs de performance du chatbot ──
_chat_perf: list[dict] = []

def _perf_log(backend: str, duration_ms: int, iterations: int,
              tools_called: list, error: str = "") -> None:
    import datetime as _dt
    _chat_perf.append({
        "ts":          _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "backend":     backend,
        "duration_ms": duration_ms,
        "iterations":  iterations,
        "tools_called": tools_called,
        "error":       error,
    })
    if len(_chat_perf) > 200:
        _chat_perf.pop(0)


def _ollama_simple(prompt: str, system: str = "", max_tokens: int = 300, cache_key: str = "") -> str:
    """Appel Ollama sans tool_use — retourne le texte généré, '' si indisponible."""
    key = cache_key or prompt[:120]
    if key in _ollama_txt_cache:
        return _ollama_txt_cache[key]
    try:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        url  = _OLLAMA_URL.rstrip("/") + "/v1/chat/completions"
        resp = http_requests.post(url, json={
            "model":       _OLLAMA_MODEL,
            "messages":    messages,
            "max_tokens":  max_tokens,
            "temperature": 0.25,
            "stream":      False,
        }, timeout=30)
        if resp.status_code == 200:
            text = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
            if text:
                _ollama_txt_cache[key] = text
            return text
    except Exception:
        pass
    return ""


def _to_anthropic_format(messages: list, tools: list):
    """Convert OpenAI-style messages + tools to Anthropic API format."""
    system = ""
    ant_msgs = []
    ant_tools = [
        {
            "name":         t["function"]["name"],
            "description":  t["function"].get("description", ""),
            "input_schema": t["function"]["parameters"],
        }
        for t in tools if t.get("type") == "function"
    ]

    i = 0
    while i < len(messages):
        msg  = messages[i]
        role = msg.get("role", "")

        if role == "system":
            system = msg.get("content", "")
            i += 1

        elif role == "user":
            ant_msgs.append({"role": "user", "content": msg.get("content", "")})
            i += 1

        elif role == "assistant":
            blocks = []
            if msg.get("content"):
                blocks.append({"type": "text", "text": msg["content"]})
            for tc in (msg.get("tool_calls") or []):
                try:
                    inp = json.loads(tc["function"]["arguments"])
                except Exception:
                    inp = {}
                blocks.append({
                    "type":  "tool_use",
                    "id":    tc.get("id") or f"toolu_{len(blocks)}",
                    "name":  tc["function"]["name"],
                    "input": inp,
                })
            if not blocks:
                blocks.append({"type": "text", "text": ""})
            ant_msgs.append({"role": "assistant", "content": blocks})
            i += 1

        elif role == "tool":
            # Group consecutive tool results into one user message
            tool_results = []
            while i < len(messages) and messages[i].get("role") == "tool":
                tm = messages[i]
                tool_results.append({
                    "type":        "tool_result",
                    "tool_use_id": tm.get("tool_call_id", ""),
                    "content":     tm.get("content", ""),
                })
                i += 1
            ant_msgs.append({"role": "user", "content": tool_results})

        else:
            i += 1

    return system, ant_msgs, ant_tools


def _llm_complete(messages: list, tools: list) -> dict:
    """
    Appel LLM unifié — retourne un dict normalisé :
      {"finish_reason": str, "content": str, "tool_calls": list}

    Backend sélectionné via LLM_BACKEND :
      - "ollama" (défaut) : modèle local via Ollama
      - "groq"            : cloud Groq, nécessite GROQ_API_KEY
      - "claude"          : Anthropic Claude, nécessite ANTHROPIC_API_KEY
    """
    backend = os.getenv("LLM_BACKEND", "ollama").lower()

    if backend == "ollama":
        url      = _OLLAMA_URL.rstrip("/") + "/v1/chat/completions"
        ol_body: dict = {
            "model":       _OLLAMA_MODEL,
            "messages":    messages,
            "max_tokens":  2048,
            "temperature": 0.3,
            "stream":      False,
        }
        if tools:
            ol_body["tools"]       = tools
            ol_body["tool_choice"] = "auto"
        resp = http_requests.post(url, json=ol_body, timeout=120)
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

    if backend == "claude":
        client = _get_anthropic()
        system, ant_msgs, ant_tools = _to_anthropic_format(messages, tools)
        kwargs: dict = {
            "model":      _CLAUDE_MODEL,
            "max_tokens": 4096,
            "messages":   ant_msgs,
        }
        if system:
            kwargs["system"] = system
        if ant_tools:
            kwargs["tools"]       = ant_tools
            kwargs["tool_choice"] = {"type": "auto"}
        response = client.messages.create(**kwargs)
        content    = ""
        tool_calls = []
        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append({
                    "id":       block.id,
                    "type":     "function",
                    "function": {
                        "name":      block.name,
                        "arguments": json.dumps(block.input, ensure_ascii=False),
                    },
                })
        finish = "tool_calls" if response.stop_reason == "tool_use" else "stop"
        return {"finish_reason": finish, "content": content, "tool_calls": tool_calls}

    # Groq
    client = _get_groq()
    groq_kwargs: dict = {
        "model":       _GROQ_MODEL,
        "messages":    messages,
        "max_tokens":  1024,
        "temperature": 0.0,
    }
    if tools:  # Groq refuse tools=[] avec tool_choice="auto"
        groq_kwargs["tools"]       = tools
        groq_kwargs["tool_choice"] = "auto"
    try:
        response = client.chat.completions.create(**groq_kwargs)
    except Exception as groq_exc:
        exc_str = str(groq_exc)
        # Groq génère parfois une syntaxe malformée (ex: <function=name{...} sans ">")
        # → tool_use_failed 400 : on réessaie sans outils pour obtenir une réponse directe
        if "tool_use_failed" in exc_str or "Failed to call a function" in exc_str:
            logger.warning(f"[Groq] tool_use_failed — retry sans outils : {exc_str[:120]}")
            retry_kwargs = {
                "model":       _GROQ_MODEL,
                "messages":    messages,
                "max_tokens":  1024,
                "temperature": 0.3,
            }
            try:
                response = client.chat.completions.create(**retry_kwargs)
            except Exception as retry_exc:
                raise retry_exc
        else:
            raise
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
    message: str = Field(..., max_length=600, description="Question à poser à PoliBot (max 600 caractères)")
    history: list = []


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest, request: Request):
    """Agent ReAct PoliBot — Groq / Ollama / Claude selon LLM_BACKEND."""
    _guard_input(req.message, request.client.host if request.client else "")
    import time as _time
    t0      = _time.monotonic()
    backend = os.getenv("LLM_BACKEND", "ollama").lower()

    # RAG pré-LLM : Granite semantic search + CamemBERT extraction sur la question utilisateur
    rag_ctx = _hf_contextual_rag(req.message)

    messages = [{"role": "system", "content": _AGENT_SYSTEM}]
    messages += [m for m in req.history if m.get("role") in ("user", "assistant", "tool")][-12:]
    # Injecter le contexte RAG dans le message utilisateur
    user_content = req.message
    if rag_ctx:
        user_content = f"{req.message}\n\n{rag_ctx}"
    messages.append({"role": "user", "content": user_content})
    steps        = []
    tools_called = []
    iterations   = 0

    try:
        for _ in range(6):
            iterations += 1
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
                    name = tc["function"]["name"]
                    tools_called.append(name)
                    tool_result = _execute_agent_tool(name, args)
                    steps.append({"outil": name, "paramètres": args, "résultat": tool_result})
                    messages.append({
                        "role":         "tool",
                        "tool_call_id": tc.get("id", ""),
                        "content":      json.dumps(tool_result, ensure_ascii=False, default=str),
                    })
            else:
                _perf_log(backend, int((_time.monotonic() - t0) * 1000), iterations, tools_called)
                return {"response": result["content"], "steps": steps}

        _perf_log(backend, int((_time.monotonic() - t0) * 1000), iterations, tools_called)
        return {"response": "Limite d'itérations atteinte.", "steps": steps}

    except Exception as exc:
        _perf_log(backend, int((_time.monotonic() - t0) * 1000), iterations, tools_called, str(exc))
        raise


@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest, request: Request):
    """
    Variante SSE de /api/chat — stream les étapes ReAct au client en temps réel.
    Contourne le timeout HTTP 30s de Render : la connexion streaming reste ouverte.
    Chaque étape (outil appelé) est envoyée dès qu'elle est disponible.
    """
    _guard_input(req.message, request.client.host if request.client else "")
    loop = asyncio.get_event_loop()

    # RAG pré-LLM (synchrone, avant le stream)
    rag_ctx = _hf_contextual_rag(req.message)

    async def generate():
        import time as _time
        t0      = _time.monotonic()
        backend = os.getenv("LLM_BACKEND", "ollama").lower()
        messages = [{"role": "system", "content": _AGENT_SYSTEM}]
        messages += [m for m in req.history if m.get("role") in ("user", "assistant", "tool")][-12:]
        user_content = req.message
        if rag_ctx:
            user_content = f"{req.message}\n\n{rag_ctx}"
        messages.append({"role": "user", "content": user_content})
        steps        = []
        tools_called = []
        iterations   = 0

        try:
            for _ in range(6):
                iterations += 1
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

                        name = tc["function"]["name"]
                        tools_called.append(name)
                        tool_result = _execute_agent_tool(name, args)
                        step = {"outil": name, "paramètres": args, "résultat": tool_result}
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
                    _perf_log(backend, int((_time.monotonic() - t0) * 1000), iterations, tools_called)
                    yield (
                        "data: "
                        + json.dumps(
                            {"type": "done", "response": result["content"], "steps": steps},
                            ensure_ascii=False, default=str,
                        )
                        + "\n\n"
                    )
                    return

            _perf_log(backend, int((_time.monotonic() - t0) * 1000), iterations, tools_called)
            yield (
                "data: "
                + json.dumps(
                    {"type": "done", "response": "Limite d'itérations atteinte.", "steps": steps},
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        except Exception as exc:
            _perf_log(backend, int((_time.monotonic() - t0) * 1000), iterations, tools_called, str(exc))
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


@app.get("/api/chat/metrics")
def chat_metrics():
    """Indicateurs de performance du chatbot PoliBot (200 dernières requêtes)."""
    if not _chat_perf:
        return {"total": 0, "message": "Aucune donnée — faites d'abord quelques requêtes au chatbot."}

    total     = len(_chat_perf)
    successes = [p for p in _chat_perf if not p["error"]]
    errors    = [p for p in _chat_perf if p["error"]]
    durations = [p["duration_ms"] for p in successes]
    iters     = [p["iterations"]  for p in successes]

    backends: dict = {}
    for p in _chat_perf:
        backends[p["backend"]] = backends.get(p["backend"], 0) + 1

    tool_counts: dict = {}
    for p in _chat_perf:
        for t in p["tools_called"]:
            tool_counts[t] = tool_counts.get(t, 0) + 1

    return {
        "total":           total,
        "succès":          len(successes),
        "erreurs":         len(errors),
        "taux_succès_pct": round(len(successes) / total * 100, 1),
        "durée_moy_ms":    round(sum(durations) / len(durations)) if durations else 0,
        "durée_min_ms":    min(durations) if durations else 0,
        "durée_max_ms":    max(durations) if durations else 0,
        "itérations_moy":  round(sum(iters) / len(iters), 1) if iters else 0,
        "backends":        backends,
        "outils_utilisés": dict(sorted(tool_counts.items(), key=lambda x: -x[1])),
        "dernières_10":    _chat_perf[-10:][::-1],
    }


@app.delete("/api/chat/metrics")
def chat_metrics_reset():
    """Vide le buffer de métriques."""
    _chat_perf.clear()
    return {"message": "Métriques réinitialisées."}


# ── Fact-check : résumé contextuel via LLM ───────────────────────────────────

class FactCheckSummaryRequest(BaseModel):
    claimText:     str
    verdictRating: str = ""
    claimant:      str = ""
    source:        str = ""
    publishedAt:   str = ""
    politicians:   list = []


_VERDICT_FR = {
    "TRUE":          "Vrai",
    "MOSTLY_TRUE":   "Plutôt vrai",
    "HALF_TRUE":     "Mi-vrai / Partiellement vrai",
    "MISLEADING":    "Trompeur / Hors contexte",
    "FALSE":         "Faux",
    "MOSTLY_FALSE":  "Plutôt faux",
    "UNVERIFIABLE":  "Invérifiable",
}


@app.post("/api/factcheck/summarize")
def factcheck_summarize(req: FactCheckSummaryRequest):
    """
    Génère un résumé contextuel enrichi d'un fact-check via LLM (Groq/Claude).
    Explique qui a dit quoi, dans quel contexte probable, pourquoi c'est faux/vrai,
    et ce que la réalité montre à la place.
    """
    verdict_fr = _VERDICT_FR.get(req.verdictRating, req.verdictRating or "Non classifié")
    date_str   = (req.publishedAt or "")[:10] or "date inconnue"
    claimant   = req.claimant or ""
    pols       = [str(p) for p in req.politicians] if req.politicians else []

    # Détecter si le claimant est un politicien nommé ou une source virale / anonyme
    _RUMEUR_TOKENS = {"réseau", "social", "publication", "sources", "multiple", "viral",
                      "web", "internet", "tweet", "facebook", "tiktok", "whatsapp",
                      "circule", "claim", "post", "anonyme", "inconnu", "divers"}
    claimant_lower = claimant.lower()
    is_rumeur = (
        not claimant
        or any(tok in claimant_lower for tok in _RUMEUR_TOKENS)
        or claimant.lower().startswith("des ")
        or claimant.lower().startswith("plusieurs ")
        or claimant.lower().startswith("multiple")
    )

    pols_str = ", ".join(pols) if pols else (claimant if not is_rumeur else "")

    if is_rumeur:
        # Claim = rumeur / publication virale / tiers anonyme
        sujet_str = pols_str or "des personnalités politiques"
        contexte_instruction = (
            f"1. **Contexte** : Cette affirmation circule sur les réseaux sociaux ou dans des médias non identifiés. "
            f"Explique brièvement quel type de rumeur ou de narrative c'est (désinformation, manipulation d'image, "
            f"mauvaise interprétation d'archive…), et qui est visé ({sujet_str})."
        )
    else:
        # Claim = déclaration directe d'un politicien
        contexte_instruction = (
            f"1. **Contexte** : Quand et dans quelle situation {claimant} a probablement fait cette déclaration "
            f"(ex: débat télévisé, meeting, interview, discours parlementaire…)."
        )

    claimant_label = f"Rumeur / publication anonyme (sujet : {pols_str or 'non précisé'})" if is_rumeur else claimant

    prompt = (
        f"Tu es un analyste politique français expert en fact-checking. "
        f"Analyse ce fact-check et rédige un résumé structuré.\n\n"
        f"AFFIRMATION VÉRIFIÉE : « {req.claimText[:500]} »\n"
        f"VERDICT : {verdict_fr}\n"
        f"ORIGINE : {claimant_label}\n"
        f"SOURCE DU FACT-CHECK : {req.source or 'inconnue'} ({date_str})\n\n"
        f"Réponds avec ces 4 points, chacun en 1-2 phrases :\n"
        f"{contexte_instruction}\n"
        f"2. **Pourquoi le verdict est « {verdict_fr} »** : Quelle est l'erreur factuelle, "
        f"l'exagération ou l'absence de preuves qui justifie ce verdict\n"
        f"3. **Ce que les données montrent** : Les faits réels, chiffres ou éléments concrets "
        f"qui contredisent (ou nuancent) l'affirmation\n"
        f"4. **Nuance** : S'il y a une part de vérité, un contexte particulier ou une subtilité "
        f"que le verdict ne capture pas entièrement\n\n"
        f"Sois factuel et précis. Ne fais pas de procès d'intention. Réponds uniquement en français."
    )

    try:
        result = _llm_complete(
            [{"role": "user", "content": prompt}],
            tools=[],
        )
        content = result.get("content") or ""
        if not content:
            return {"summary": "Impossible de générer un résumé pour ce fact-check.", "error": True}
        return {"summary": content, "error": False}
    except Exception as exc:
        logger.warning(f"[Summarize] Erreur LLM : {exc}")
        return {"summary": f"Erreur lors de la génération : {exc}", "error": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
