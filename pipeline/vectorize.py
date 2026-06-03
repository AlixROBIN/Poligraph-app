"""
vectorize.py
Produit 3 matrices distinctes selon l'usage :
- X_scandales  → ML catégorie / parti / identification élu
- X_votes      → ML résultat vote
- X_elus       → clustering / similarité élus

Le score de sentiment CamemBERT (pré-calculé via enrich_sentiment.py)
est ajouté comme feature numérique dans scandales et votes.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction import FeatureHasher
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ANALYTICS_DIR = Path("output/analytics")
OUTPUT_DIR    = Path("output/vectors")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# Helpers
# ============================================================

def save_matrix(X, name, feature_names=None):
    np.save(OUTPUT_DIR / f"{name}.npy", X)
    if feature_names:
        with open(OUTPUT_DIR / f"{name}_features.json", "w", encoding="utf-8") as f:
            json.dump({"features": feature_names}, f, ensure_ascii=False, indent=2)
    print(f"  {name}.npy → {X.shape}")


def ohe_block(df, cols):
    """OneHotEncoder sur colonnes à faible cardinalité."""
    if not cols:
        return np.empty((len(df), 0)), []
    df_sub = df[cols].fillna("Non spécifié").astype(str)
    enc = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    X = enc.fit_transform(df_sub)
    names = enc.get_feature_names_out(cols).tolist()
    return X, names


def hash_block(df, cols, n=256):
    """FeatureHasher sur colonnes à haute cardinalité."""
    if not cols:
        return np.empty((len(df), 0)), []
    hasher = FeatureHasher(n_features=n, input_type="string")
    X = np.zeros((len(df), n))
    for col in cols:
        vals = df[col].fillna("Non spécifié").astype(str).tolist()
        X += hasher.transform([[v] for v in vals]).toarray()
    return X, [f"hash_{i}" for i in range(n)]


def num_block(df, cols):
    """StandardScaler sur colonnes numériques."""
    valid = [c for c in cols if c in df.columns]
    if not valid:
        return np.empty((len(df), 0)), []
    df_num = df[valid].apply(pd.to_numeric, errors="coerce").fillna(0)
    # On exclut les colonnes avec trop de valeurs manquantes originales
    ok_cols = [c for c in valid if df[c].apply(pd.to_numeric, errors="coerce").isna().mean() < 0.5]
    if not ok_cols:
        return np.empty((len(df), 0)), []
    df_num = df[ok_cols].apply(pd.to_numeric, errors="coerce").fillna(0)
    scaler = StandardScaler()
    X = scaler.fit_transform(df_num)
    return X, ok_cols


def tfidf_block(df, col, max_features=200):
    """TF-IDF sur texte libre (description, title…)."""
    texts = df[col].fillna("").astype(str).tolist()
    vec = TfidfVectorizer(max_features=max_features, min_df=2,
                          strip_accents="unicode", sublinear_tf=True)
    X = vec.fit_transform(texts).toarray()
    names = [f"tfidf_{t}" for t in vec.get_feature_names_out()]
    return X, names


def sentiment_block(df: pd.DataFrame, id_col: str, sentiment_csv: str) -> tuple:
    """
    Charge les scores CamemBERT pré-calculés (enrich_sentiment.py).
    Retourne un vecteur 1-colonne ∈ [-1, 1] par ligne.
    Si le CSV est absent, retourne des zéros et avertit.
    """
    path = ANALYTICS_DIR / sentiment_csv
    if path.exists():
        sent = pd.read_csv(path)
        merged = df[[id_col]].merge(sent[[id_col, "sentiment_score"]], on=id_col, how="left")
        missing = merged["sentiment_score"].isna().sum()
        if missing:
            print(f"    ⚠ {missing} scores sentiment manquants → 0.0")
        scores = merged["sentiment_score"].fillna(0.0).values.reshape(-1, 1)
    else:
        print(f"    ⚠ {sentiment_csv} absent → sentiment=0.0"
              f"  (lance : python pipeline/enrich_sentiment.py)")
        scores = np.zeros((len(df), 1))
    return scores, ["sentiment_score"]


# ============================================================
# 1. Vecteurs scandales
# ============================================================

def vectorize_scandales():
    print("\n--- Vectorisation scandales ---")
    df = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)

    # Faible cardinalité — "category" exclu : c'est la cible de M1 (data leakage)
    low_cols = [c for c in ["status", "party_short",
                             "position_politique", "appeal"] if c in df.columns]
    X_low, names_low = ohe_block(df, low_cols)

    # Haute cardinalité
    high_cols = [c for c in ["institution", "departmentCode",
                              "constituency", "politician_slug"] if c in df.columns]
    X_high, names_high = hash_block(df, high_cols, n=128)

    # Numériques
    num_cols = ["annee_faits", "annee_verdict", "duree_procedure", "age_approx"]
    X_num, names_num = num_block(df, num_cols)

    # TF-IDF description
    X_tfidf, names_tfidf = tfidf_block(df, "description", max_features=150) \
        if "description" in df.columns else (np.empty((len(df), 0)), [])

    # Sentiment CamemBERT (pré-calculé)
    X_sent, names_sent = sentiment_block(df, "id", "scandales_sentiment.csv")

    X = np.hstack([X_low, X_high, X_num, X_tfidf, X_sent])
    all_names = names_low + names_high + names_num + names_tfidf + names_sent

    save_matrix(X, "scandales_vectors", all_names)

    # Sauvegarde labels pour ML
    labels = {
        "category":        df["category"].tolist(),
        "party_short":     df["party_short"].tolist() if "party_short" in df.columns else [],
        "politician_name": df["politician_name"].tolist() if "politician_name" in df.columns else [],
        "politician_id":   df["politician_id"].tolist()   if "politician_id"   in df.columns else [],
    }
    with open(OUTPUT_DIR / "scandales_labels.json", "w", encoding="utf-8") as f:
        json.dump(labels, f, ensure_ascii=False, indent=2)

    return X, df


# ============================================================
# 2. Vecteurs votes
# ============================================================

def vectorize_votes():
    print("\n--- Vectorisation votes ---")
    df = pd.read_csv(ANALYTICS_DIR / "votes_features.csv", low_memory=False)

    # Faible cardinalité
    low_cols = [c for c in ["legislature", "annee_vote"] if c in df.columns]
    X_low, names_low = ohe_block(df, low_cols)

    # Les colonnes de vote (votesFor, votesAgainst, marge, taux_*) sont exclues
    # intentionnellement : elles encodent directement le résultat (data leakage).
    # Le modèle doit prédire à partir du titre et du contexte législatif uniquement.

    # TF-IDF titre du vote (contient info thématique)
    X_tfidf, names_tfidf = tfidf_block(df, "title", max_features=200) \
        if "title" in df.columns else (np.empty((len(df), 0)), [])

    # Sentiment CamemBERT sur le titre (pré-calculé)
    X_sent, names_sent = sentiment_block(df, "id", "votes_sentiment.csv")

    X = np.hstack([X_low, X_tfidf, X_sent])
    all_names = names_low + names_tfidf + names_sent

    save_matrix(X, "votes_vectors", all_names)

    # Labels
    labels = {
        "result":     df["result"].tolist(),
        "result_bin": df["result_bin"].tolist(),
    }
    with open(OUTPUT_DIR / "votes_labels.json", "w", encoding="utf-8") as f:
        json.dump(labels, f, ensure_ascii=False, indent=2)

    return X, df


# ============================================================
# 3. Vecteurs élus
# ============================================================

def vectorize_elus():
    print("\n--- Vectorisation élus ---")
    df = pd.read_csv(ANALYTICS_DIR / "elus_features.csv", low_memory=False)

    # Faible cardinalité
    low_cols = [c for c in ["party_short", "position_politique",
                             "civility", "isCurrent"] if c in df.columns]
    X_low, names_low = ohe_block(df, low_cols)

    # Haute cardinalité
    high_cols = [c for c in ["institution", "departmentCode",
                              "constituency", "birthPlace"] if c in df.columns]
    X_high, names_high = hash_block(df, high_cols, n=128)

    # Numériques
    num_cols = ["annee_naissance", "age_approx"]
    X_num, names_num = num_block(df, num_cols)

    X = np.hstack([X_low, X_high, X_num])
    all_names = names_low + names_high + names_num

    save_matrix(X, "elus_vectors", all_names)

    # Index id ↔ nom pour retrouver l'élu après prédiction
    index = {
        "ids":   df["id"].tolist()       if "id"       in df.columns else [],
        "names": df["fullName"].tolist()  if "fullName" in df.columns else [],
        "slugs": df["slug"].tolist()      if "slug"     in df.columns else [],
    }
    with open(OUTPUT_DIR / "elus_index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    return X, df


# ============================================================
# MAIN
# ============================================================

def main():
    vectorize_scandales()
    vectorize_votes()
    vectorize_elus()
    print("\nVectorisation terminée → output/vectors/")


if __name__ == "__main__":
    main()
