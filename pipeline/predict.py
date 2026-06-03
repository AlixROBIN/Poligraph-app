"""
predict.py
Interface unifiée de prédiction pour les 3 modèles.
Usage :
  python predict.py --mode vote       --title "projet de loi sur la retraite"
  python predict.py --mode category   --party RN --annee 2024
  python predict.py --mode politician --category CORRUPTION --party LFI

  # Avec sentiment live (nécessite output/stream_snapshot.parquet) :
  python predict.py --mode category --party RN --live-sentiment
  # Ou sentiment fixe :
  python predict.py --mode vote --title "..." --sentiment -0.4
"""

import argparse
import json
import pickle
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction import FeatureHasher
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import OneHotEncoder

sys.path.insert(0, str(Path(__file__).parent))
from sentiment_utils import get_live_sentiment, score_single

warnings.filterwarnings("ignore")

ROOT_DIR      = Path(__file__).resolve().parent.parent
MODELS_DIR    = ROOT_DIR / "output/models"
VECTORS_DIR   = ROOT_DIR / "output/vectors"
ANALYTICS_DIR = ROOT_DIR / "output/analytics"


# ============================================================
# Loaders
# ============================================================

def load_model(name):
    path = MODELS_DIR / f"{name}.pkl"
    if not path.exists():
        raise FileNotFoundError(f"Modèle introuvable : {path}. Lance d'abord le pipeline.")
    with open(path, "rb") as f:
        obj = pickle.load(f)
    if isinstance(obj, dict):
        return obj["model"], obj["label_encoder"]
    return obj, None


# ============================================================
# Construction du vecteur scandale
# ============================================================

def build_scandale_vector(category=None, party=None, status=None,
                           institution=None, annee=None, description="",
                           sentiment: float | None = None):
    """
    Reconstruit un vecteur scandale en suivant la même logique que vectorize.py.
    Les paramètres inconnus restent à zéro.

    sentiment : score [-1, 1] à injecter.
      - Si fourni explicitement, utilisé tel quel.
      - Si None et description non vide, scoré par CamemBERT.
      - Si None et pas de description, reste à 0.0.
    """
    df_ref = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)

    with open(VECTORS_DIR / "scandales_vectors_features.json", encoding="utf-8") as f:
        feat_names = json.load(f)["features"]

    feat_idx = {name: i for i, name in enumerate(feat_names)}
    x = np.zeros((1, len(feat_names)))

    # --- OHE ---
    for value, prefix in [(party, "party_short"), (category, "category"),
                           (status, "status")]:
        if value:
            key = f"{prefix}_{value}"
            if key in feat_idx:
                x[0, feat_idx[key]] = 1.0

    # --- Hash institution (128 features) ---
    if institution:
        hasher = FeatureHasher(n_features=128, input_type="string")
        x_hash = hasher.transform([[institution]]).toarray()[0]
        hash_start = next((i for i, n in enumerate(feat_names) if n.startswith("hash_")), None)
        if hash_start is not None:
            x[0, hash_start:hash_start + 128] = x_hash

    # --- Numérique : annee_faits (standardisé) ---
    if annee:
        col = pd.to_numeric(df_ref["annee_faits"], errors="coerce").dropna()
        if len(col) > 0 and col.std() > 0 and "annee_faits" in feat_idx:
            x[0, feat_idx["annee_faits"]] = (annee - col.mean()) / col.std()

    # --- TF-IDF description ---
    if description:
        tfidf = TfidfVectorizer(max_features=150, min_df=2,
                                strip_accents="unicode", sublinear_tf=True)
        tfidf.fit(df_ref["description"].fillna("").astype(str))
        x_tfidf = tfidf.transform([description]).toarray()[0]
        for j, token in enumerate(tfidf.get_feature_names_out()):
            fname = f"tfidf_{token}"
            if fname in feat_idx:
                x[0, feat_idx[fname]] = x_tfidf[j]

    # --- Sentiment ---
    if "sentiment_score" in feat_idx:
        if sentiment is not None:
            sent_val = float(np.clip(sentiment, -1.0, 1.0))
        elif description:
            sent_val = score_single(description)
        else:
            sent_val = 0.0
        x[0, feat_idx["sentiment_score"]] = sent_val

    return x


# ============================================================
# Prédiction vote
# ============================================================

def predict_vote(title: str, annee: int = 2025, legislature: int = 17,
                 sentiment: float | None = None):
    model, _ = load_model("model_votes")
    df_ref    = pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)

    with open(VECTORS_DIR / "votes_vectors_features.json", encoding="utf-8") as f:
        feat_names = json.load(f)["features"]
    feat_idx = {name: i for i, name in enumerate(feat_names)}

    x = np.zeros((1, len(feat_names)))

    # --- OHE legislature / annee_vote ---
    ohe = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    ohe.fit(df_ref[["legislature", "annee_vote"]].fillna("Non spécifié").astype(str))
    x_ohe = ohe.transform(pd.DataFrame({
        "legislature": [str(legislature)],
        "annee_vote":  [str(annee)],
    }))[0]
    ohe_names = ohe.get_feature_names_out(["legislature", "annee_vote"]).tolist()
    for fname, val in zip(ohe_names, x_ohe):
        if fname in feat_idx:
            x[0, feat_idx[fname]] = val

    # --- TF-IDF titre ---
    tfidf = TfidfVectorizer(max_features=200, min_df=2,
                            strip_accents="unicode", sublinear_tf=True)
    tfidf.fit(df_ref["title"].fillna("").astype(str))
    x_tfidf = tfidf.transform([title]).toarray()[0]
    for j, token in enumerate(tfidf.get_feature_names_out()):
        fname = f"tfidf_{token}"
        if fname in feat_idx:
            x[0, feat_idx[fname]] = x_tfidf[j]

    # --- Sentiment ---
    if "sentiment_score" in feat_idx:
        if sentiment is not None:
            sent_val = float(np.clip(sentiment, -1.0, 1.0))
        else:
            sent_val = score_single(title)
        x[0, feat_idx["sentiment_score"]] = sent_val
        print(f"  Sentiment titre      : {sent_val:+.3f}")

    # --- Alignement shape modèle ---
    n_model = model.n_features_in_ if hasattr(model, "n_features_in_") else x.shape[1]
    if x.shape[1] < n_model:
        x = np.hstack([x, np.zeros((1, n_model - x.shape[1]))])
    else:
        x = x[:, :n_model]

    pred  = model.predict(x)[0]
    proba = model.predict_proba(x)[0]
    label = "ADOPTED" if pred == 1 else "REJECTED"

    print(f"\n[VOTE] '{title[:80]}'")
    print(f"  Prédiction           : {label}")
    print(f"  Probabilité ADOPTED  : {proba[1]:.1%}")
    print(f"  Probabilité REJECTED : {proba[0]:.1%}")
    return label, proba


# ============================================================
# Prédiction catégorie scandale
# ============================================================

def predict_category(party: str = "RN", annee: int = 2024,
                      institution: str = "Assemblée nationale",
                      description: str = "",
                      sentiment: float | None = None):
    model, le = load_model("model_category")
    df_ref = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)

    x = build_scandale_vector(party=party, institution=institution,
                               annee=annee, description=description,
                               sentiment=sentiment)

    n_model = model.n_features_in_ if hasattr(model, "n_features_in_") else x.shape[1]
    if x.shape[1] < n_model:
        x = np.hstack([x, np.zeros((1, n_model - x.shape[1]))])
    else:
        x = x[:, :n_model]

    proba = model.predict_proba(x)[0]
    pred  = model.predict(x)[0]
    label = le.inverse_transform([pred])[0]

    # ── Evidence : tokens reconnus / ignorés ─────────────────────────────
    evidence = {"matched": [], "ignored": [], "tfidf_vocab_size": 0}
    if description:
        tfidf = TfidfVectorizer(max_features=150, min_df=2,
                                strip_accents="unicode", sublinear_tf=True)
        tfidf.fit(df_ref["description"].fillna("").astype(str))
        vocab = set(tfidf.get_feature_names_out())
        evidence["tfidf_vocab_size"] = len(vocab)
        x_tfidf = tfidf.transform([description]).toarray()[0]
        tokens_in  = [(tfidf.get_feature_names_out()[j], round(float(x_tfidf[j]), 4))
                      for j in np.argsort(x_tfidf)[::-1] if x_tfidf[j] > 0]
        # tokens de la description absents du vocabulaire
        import re
        desc_tokens = set(re.findall(r"\b[a-zA-ZÀ-ÿ]{3,}\b", description.lower()))
        tokens_out  = [t for t in desc_tokens if t not in vocab]
        evidence["matched"] = tokens_in[:8]
        evidence["ignored"] = tokens_out[:10]

    print(f"\n[CATEGORIE] Parti={party}, Année={annee}, Institution={institution}")
    print(f"  Catégorie la plus probable : {label}")
    print("  Top 5 catégories :")
    for cat, p in sorted(zip(le.classes_, proba), key=lambda t: -t[1])[:5]:
        print(f"    {cat:<35} {p:.1%}")
    return label, dict(zip(le.classes_, proba)), evidence


# ============================================================
# Prédiction élu
# ============================================================

def predict_politician(category: str = "CORRUPTION",
                        party: str = "RN",
                        status: str = "ENQUETE_PRELIMINAIRE",
                        top_n: int = 5,
                        sentiment: float | None = None):
    model, le = load_model("model_politician")

    x = build_scandale_vector(category=category, party=party,
                               status=status, sentiment=sentiment)

    n_model = model.n_features_in_ if hasattr(model, "n_features_in_") else x.shape[1]
    if x.shape[1] < n_model:
        x = np.hstack([x, np.zeros((1, n_model - x.shape[1]))])
    else:
        x = x[:, :n_model]

    proba   = model.predict_proba(x)[0]
    top_idx = np.argsort(proba)[-top_n:][::-1]

    print(f"\n[ÉLU] Catégorie={category}, Parti={party}, Statut={status}")
    print(f"  Top {top_n} élus les plus probables :")
    for idx in top_idx:
        print(f"    {le.classes_[idx]:<40} {proba[idx]:.1%}")
    return [(le.classes_[i], float(proba[i])) for i in top_idx]


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Prédictions politiques enrichies au sentiment")
    parser.add_argument("--mode",        choices=["vote", "category", "politician"], required=True)
    parser.add_argument("--title",       default="projet de loi budgétaire")
    parser.add_argument("--party",       default="RN")
    parser.add_argument("--annee",       type=int, default=2024)
    parser.add_argument("--legislature", type=int, default=17)
    parser.add_argument("--category",    default="CORRUPTION")
    parser.add_argument("--status",      default="ENQUETE_PRELIMINAIRE")
    parser.add_argument("--institution", default="Assemblée nationale")
    parser.add_argument("--description", default="")
    parser.add_argument("--top_n",       type=int, default=5)
    parser.add_argument("--sentiment",   type=float, default=None,
                        help="Score sentiment fixe [-1, 1]. Si omis, calculé automatiquement.")
    parser.add_argument("--live-sentiment", action="store_true",
                        help="Récupère le sentiment live depuis le snapshot Kafka.")
    args = parser.parse_args()

    # Résolution du sentiment
    sentiment = args.sentiment
    if sentiment is None and args.live_sentiment:
        entities = [e for e in [args.party, args.category] if e]
        sentiment = get_live_sentiment(entities)
        print(f"  Sentiment live ({entities}) : {sentiment:+.3f}")

    if args.mode == "vote":
        predict_vote(title=args.title, annee=args.annee,
                     legislature=args.legislature, sentiment=sentiment)
    elif args.mode == "category":
        predict_category(party=args.party, annee=args.annee,
                          institution=args.institution, description=args.description,
                          sentiment=sentiment)
    elif args.mode == "politician":
        predict_politician(category=args.category, party=args.party,
                            status=args.status, top_n=args.top_n,
                            sentiment=sentiment)


if __name__ == "__main__":
    main()
