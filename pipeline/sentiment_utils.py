"""
pipeline/sentiment_utils.py — Scoring sentiment multilingue.

Stratégie (par ordre de priorité) :
  1. HuggingFace Inference API  (cloud, français natif, nécessite HF_API_KEY)
  2. Modèle transformers local   (si torch installé — lent au démarrage)
  3. VADER + corrections FR       (fallback léger, toujours disponible)

Utilisé par :
  - enrich_sentiment.py  (scoring offline batch)
  - predict.py           (injection sentiment live)
  - api.py               (scoring RSS en temps réel)
"""

import logging
import os
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

HF_API_KEY        = os.getenv("HF_API_KEY", "")
SENTIMENT_MODEL   = os.getenv(
    "SENTIMENT_MODEL",
    "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
)
_HF_URL           = f"https://api-inference.huggingface.co/models/{SENTIMENT_MODEL}"
_SNAPSHOT_DEFAULT = Path(__file__).resolve().parent.parent / "output" / "stream_snapshot.parquet"

_POS_LABELS = {"positive", "pos", "label_2", "5 stars", "4 stars", "positive sentiment"}
_NEG_LABELS = {"negative", "neg", "label_0", "1 star",  "2 stars", "negative sentiment"}

_FR_NEG = frozenset({
    "blessé","blessée","blessés","blessées","blessure","blessures",
    "mort","morte","morts","mortes","décès","décédé","décédée",
    "tué","tuée","tués","tuées","assassinat","meurtre","meurtres",
    "victime","victimes","violence","violences","agression","agressions",
    "grave","graves","dramatique","tragique","catastrophe","drame","tragédie",
    "crise","scandale","polémique","controverse","affaire",
    "condamné","condamnée","condamnation","inculpé","mis en examen",
    "arrestation","prison","incarcéré","détenu","peine","sanction","jugement","procès","tribunal",
    "fraude","corruption","détournement","malversation",
    "attaque","attentat","émeute","incendie","accident",
    "licenciement","chômage","faillite","défaite","échec",
    "enquête","plainte","signalement",
    "injustice","racisme","harcèlement","viol","abus",
})


def _signed_score(label: str, score: float) -> float:
    l = label.lower().strip()
    if l in _POS_LABELS:
        return score
    if l in _NEG_LABELS:
        return -score
    return 0.0


def _normalize_label(label: str) -> str:
    l = label.lower().strip()
    if l in _POS_LABELS:
        return "POSITIVE"
    if l in _NEG_LABELS:
        return "NEGATIVE"
    return "NEUTRAL"


def _french_correct(text: str, score: float) -> float:
    import re
    words_lower = {w.lower() for w in re.findall(r'\b\w+\b', text)}
    neg_hits = len(words_lower & _FR_NEG)
    if neg_hits == 0:
        return score
    penalty = min(0.4 + 0.15 * (neg_hits - 1), 0.8)
    return max(-1.0, min(1.0, score - penalty))


# ── 1. HuggingFace Inference API ──────────────────────────────────────────

def _hf_api_scores(texts: list) -> "list | None":
    """Appelle l'API HF Inference. Retourne None si indisponible ou sans clé."""
    if not HF_API_KEY:
        return None
    try:
        import requests as _req
        results = []
        for i in range(0, len(texts), 10):
            batch = [t[:512] for t in texts[i:i + 10]]
            resp = _req.post(
                _HF_URL,
                headers={"Authorization": f"Bearer {HF_API_KEY}"},
                json={"inputs": batch},
                timeout=20,
            )
            if resp.status_code == 503:
                log.warning("[HF] Modèle en cours de chargement (cold start) — fallback VADER")
                return None
            if resp.status_code != 200:
                log.warning(f"[HF] API erreur {resp.status_code}: {resp.text[:120]}")
                return None
            data = resp.json()
            for item in data:
                if isinstance(item, list) and item:
                    best = max(item, key=lambda x: x.get("score", 0))
                    results.append(_signed_score(best["label"], best["score"]))
                else:
                    results.append(0.0)
        log.debug(f"[HF] {len(results)} textes scorés via API Inference")
        return results
    except Exception as exc:
        log.warning(f"[HF] API échec ({exc}) — fallback")
        return None


# ── 2. Transformers local ─────────────────────────────────────────────────

def _transformers_available() -> bool:
    try:
        import torch        # noqa: F401
        import transformers # noqa: F401
        return True
    except ImportError:
        return False


def _local_transformers_scores(texts: list) -> "list | None":
    if not _transformers_available():
        return None
    try:
        from transformers import pipeline as hf_pipeline
        if not hasattr(_local_transformers_scores, "_clf"):
            log.info(f"[Local] Chargement modèle {SENTIMENT_MODEL}…")
            _local_transformers_scores._clf = hf_pipeline(
                "text-classification",
                model=SENTIMENT_MODEL,
                tokenizer=SENTIMENT_MODEL,
                batch_size=16,
                truncation=True,
                max_length=512,
                device=-1,
            )
        results = _local_transformers_scores._clf([t[:1000] for t in texts])
        return [_signed_score(r["label"], r["score"]) for r in results]
    except Exception as exc:
        log.warning(f"[Local] Modèle transformers échoué ({exc}) — fallback VADER")
        if hasattr(_local_transformers_scores, "_clf"):
            del _local_transformers_scores._clf
        return None


# ── 3. VADER (fallback toujours disponible) ───────────────────────────────

def _vader_scores(texts: list) -> list:
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        if not hasattr(_vader_scores, "_analyzer"):
            _vader_scores._analyzer = SentimentIntensityAnalyzer()
        return [
            _french_correct(t, float(_vader_scores._analyzer.polarity_scores(t)["compound"]))
            for t in texts
        ]
    except Exception as exc:
        log.warning(f"[VADER] Indisponible ({exc}) → 0.0")
        return [0.0] * len(texts)


# ── Interface publique ────────────────────────────────────────────────────

def score_texts(texts: list) -> list:
    """
    Analyse de sentiment — scores signés ∈ [-1, 1].
    Priorité : HF API > transformers local > VADER.
    """
    if not texts:
        return []

    result = _hf_api_scores(texts)
    if result is not None:
        return result

    result = _local_transformers_scores(texts)
    if result is not None:
        return result

    return _vader_scores(texts)


def score_texts_with_labels(texts: list) -> list:
    scores = score_texts(texts)
    return [
        {"score": s, "label": "POSITIVE" if s > 0.05 else "NEGATIVE" if s < -0.05 else "NEUTRAL"}
        for s in scores
    ]


def score_single(text: str) -> float:
    results = score_texts([text])
    return results[0] if results else 0.0


def get_live_sentiment(entities: list, snapshot_path: str = None) -> float:
    """Sentiment moyen depuis le snapshot Kafka. Retourne 0.0 si absent."""
    parquet = Path(snapshot_path) if snapshot_path else _SNAPSHOT_DEFAULT
    if not parquet.exists():
        return 0.0
    try:
        import pandas as pd
        df = pd.read_parquet(parquet)
        if df.empty or "sentiment" not in df.columns:
            return 0.0
        if entities and "entities" in df.columns:
            entities_lower = {e.lower() for e in entities}
            df = df[df["entities"].apply(
                lambda ents: isinstance(ents, list) and any(str(e).lower() in entities_lower for e in ents)
            )]
        if df.empty:
            return 0.0
        scores = pd.to_numeric(df["sentiment"], errors="coerce").dropna()
        return float(scores.mean()) if len(scores) > 0 else 0.0
    except Exception as exc:
        log.warning(f"[Snapshot] Lecture échouée : {exc}")
        return 0.0
