"""
pipeline/sentiment_utils.py — Utilitaire partagé : scoring sentiment + lookup live.

Stratégie :
  1. Tente le modèle transformers multilingue (meilleur pour le français)
  2. Fallback VADER si torch/transformers indisponibles (rapide, sans GPU)
  3. Retourne 0.0 si les deux échouent

Utilisé par :
  - enrich_sentiment.py  (scoring offline batch)
  - vectorize.py         (chargement des scores pré-calculés)
  - predict.py           (injection sentiment live à la prédiction)
  - api.py               (scoring RSS en temps réel)
"""

import logging
import os
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

SENTIMENT_MODEL = os.getenv(
    "SENTIMENT_MODEL",
    "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
)
_SNAPSHOT_DEFAULT = Path(__file__).resolve().parent.parent / "output" / "stream_snapshot.parquet"

_POS_LABELS = {"positive", "pos", "label_2", "5_stars", "4_stars", "positive sentiment"}
_NEG_LABELS = {"negative", "neg", "label_0", "1_star",  "2_stars", "negative sentiment"}


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


def _vader_scores(texts: list[str]) -> list[float]:
    """Fallback VADER — fonctionne sans torch, supporte partiellement le français."""
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        if not hasattr(_vader_scores, "_analyzer"):
            _vader_scores._analyzer = SentimentIntensityAnalyzer()
        return [float(_vader_scores._analyzer.polarity_scores(t)["compound"]) for t in texts]
    except Exception as exc:
        log.warning(f"VADER indisponible ({exc}) → sentiment=0.0")
        return [0.0] * len(texts)


def _transformers_available() -> bool:
    """Vérifie que transformers + torch sont utilisables sans crasher."""
    try:
        import torch          # noqa: F401
        import transformers   # noqa: F401
        return True
    except ImportError:
        return False


def score_texts(texts: list[str]) -> list[float]:
    """
    Analyse de sentiment sur une liste de textes.
    Retourne des scores signés ∈ [-1, 1].
    Essaie transformers d'abord, puis VADER, puis 0.0.
    """
    if not texts:
        return []

    if _transformers_available():
        try:
            from transformers import pipeline as hf_pipeline
            if not hasattr(score_texts, "_clf"):
                log.info(f"Chargement modèle sentiment ({SENTIMENT_MODEL})…")
                score_texts._clf = hf_pipeline(
                    "text-classification",
                    model=SENTIMENT_MODEL,
                    tokenizer=SENTIMENT_MODEL,
                    batch_size=16,
                    truncation=True,
                    max_length=512,
                    device=-1,
                )
            results = score_texts._clf([t[:1000] for t in texts])
            return [_signed_score(r["label"], r["score"]) for r in results]
        except Exception as exc:
            log.warning(f"Modèle transformers échoué ({exc}) → fallback VADER")
            if hasattr(score_texts, "_clf"):
                del score_texts._clf

    log.info("Utilisation de VADER comme moteur de sentiment")
    return _vader_scores(texts)


def score_texts_with_labels(texts: list[str]) -> list[dict]:
    """
    Retourne une liste de dicts {"score": float, "label": str} pour chaque texte.
    Utile pour enrichir les articles RSS directement.
    """
    scores = score_texts(texts)
    results = []
    for s in scores:
        if s > 0.05:
            label = "POSITIVE"
        elif s < -0.05:
            label = "NEGATIVE"
        else:
            label = "NEUTRAL"
        results.append({"score": s, "label": label})
    return results


def score_single(text: str) -> float:
    results = score_texts([text])
    return results[0] if results else 0.0


def get_live_sentiment(entities: list[str], snapshot_path: str | None = None) -> float:
    """
    Retourne le sentiment moyen des articles récents mentionnant l'une des entités.
    Lit depuis le snapshot Parquet écrit par streaming/consumer.py.
    Retourne 0.0 si aucun article trouvé ou snapshot absent.
    """
    parquet = Path(snapshot_path) if snapshot_path else _SNAPSHOT_DEFAULT

    if not parquet.exists():
        log.debug("Snapshot Kafka absent → sentiment live = 0.0")
        return 0.0

    try:
        import pandas as pd
        df = pd.read_parquet(parquet)
        if df.empty or "sentiment" not in df.columns:
            return 0.0

        if entities and "entities" in df.columns:
            entities_lower = {e.lower() for e in entities}

            def _mentions(ents) -> bool:
                if not isinstance(ents, list):
                    return False
                return any(str(e).lower() in entities_lower for e in ents)

            df = df[df["entities"].apply(_mentions)]

        if df.empty:
            return 0.0

        scores = pd.to_numeric(df["sentiment"], errors="coerce").dropna()
        return float(scores.mean()) if len(scores) > 0 else 0.0

    except Exception as exc:
        log.warning(f"Lecture snapshot échouée : {exc}")
        return 0.0
