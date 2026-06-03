"""
pipeline/enrich_sentiment.py — Calcul offline des sentiments historiques.

À lancer UNE SEULE FOIS (avant vectorize.py) :
    python pipeline/enrich_sentiment.py

Produit :
    output/analytics/scandales_sentiment.csv  (id, sentiment_score)
    output/analytics/votes_sentiment.csv      (id, sentiment_score)

Durée estimée : ~2-3 min CPU pour 258 scandales + votes.
Relancer si cleaned_analytics.csv change.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np
import pandas as pd

from sentiment_utils import score_texts

ROOT      = Path(__file__).resolve().parent.parent
ANALYTICS = ROOT / "output" / "analytics"
BATCH     = 32


def enrich(csv_name: str, id_col: str, text_col: str, out_name: str):
    src = ANALYTICS / csv_name
    if not src.exists():
        print(f"  [skip] {src} introuvable — lance d'abord : python pipeline.py --step pre")
        return

    df    = pd.read_csv(src, low_memory=False)
    texts = df[text_col].fillna("").astype(str).tolist()
    n     = len(texts)
    print(f"\n[{out_name}] {n} textes à scorer (col='{text_col}')…")

    scores: list[float] = []
    for i in range(0, n, BATCH):
        batch = texts[i : i + BATCH]
        scores.extend(score_texts(batch))
        done = min(i + BATCH, n)
        print(f"  {done}/{n}", end="\r", flush=True)

    print(f"  {n}/{n} ✓")

    out_df = pd.DataFrame({id_col: df[id_col].tolist(), "sentiment_score": scores})
    out_path = ANALYTICS / out_name
    out_df.to_csv(out_path, index=False)

    arr = np.array(scores)
    pos = (arr > 0.05).mean()
    neg = (arr < -0.05).mean()
    print(f"  → sauvegardé : {out_path}")
    print(f"     moyenne={arr.mean():.3f}  std={arr.std():.3f}"
          f"  POSITIF={pos:.1%}  NÉGATIF={neg:.1%}  NEUTRE={(1-pos-neg):.1%}")


def main():
    print("=" * 55)
    print("  Enrichissement sentiment historique (CamemBERT)")
    print("=" * 55)

    enrich("scandales_features.csv", "id", "description", "scandales_sentiment.csv")
    enrich("votes_features.csv",     "id", "title",       "votes_sentiment.csv")

    print("\n✓ Terminé.")
    print("  Prochaine étape : python pipeline.py --step vec")


if __name__ == "__main__":
    main()
