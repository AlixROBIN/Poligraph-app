"""
train_votes.py
Prédit le résultat d'un vote (ADOPTED / REJECTED)
à partir du titre du vote, de l'année, de la législature
et des distributions historiques.
"""

import json
import pickle
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import cross_val_score, train_test_split

warnings.filterwarnings("ignore")

ROOT_DIR    = Path(__file__).resolve().parent.parent
VECTORS_DIR = ROOT_DIR / "output/vectors"
MODELS_DIR  = ROOT_DIR / "output/models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


def load_data():
    X = np.load(VECTORS_DIR / "votes_vectors.npy")
    with open(VECTORS_DIR / "votes_labels.json", encoding="utf-8") as f:
        labels = json.load(f)
    y = np.array(labels["result_bin"])
    return X, y, labels["result"]


def save_model(model, name):
    with open(MODELS_DIR / f"{name}.pkl", "wb") as f:
        pickle.dump(model, f)
    print(f"  Modèle sauvegardé → output/models/{name}.pkl")


def main():
    print("Chargement des vecteurs votes …")
    X, y, results = load_data()
    print(f"  X shape : {X.shape}")
    print(f"  ADOPTED: {y.sum()} / REJECTED: {(y==0).sum()}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    models = {
        "GradientBoosting": GradientBoostingClassifier(
            n_estimators=300, max_depth=4, learning_rate=0.05, random_state=42
        ),
        "RandomForest": RandomForestClassifier(
            n_estimators=300, max_depth=8, class_weight="balanced", random_state=42
        ),
        "LogisticReg": LogisticRegression(
            max_iter=1000, class_weight="balanced", random_state=42
        ),
    }

    best_auc, best_model, best_name = -1, None, ""

    for mname, m in models.items():
        cv_scores = cross_val_score(m, X_train, y_train, cv=5, scoring="roc_auc")
        print(f"\n{mname}")
        print(f"  CV AUC : {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

        m.fit(X_train, y_train)
        y_pred  = m.predict(X_test)
        y_proba = m.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, y_proba)
        print(f"  Test AUC : {auc:.3f}")
        print(classification_report(y_test, y_pred,
                                     target_names=["REJECTED", "ADOPTED"],
                                     zero_division=0))

        if auc > best_auc:
            best_auc   = auc
            best_model = m
            best_name  = mname

    print(f"\nMeilleur modèle : {best_name} (AUC={best_auc:.3f})")

    # Feature importance (si dispo)
    if hasattr(best_model, "feature_importances_"):
        try:
            with open(VECTORS_DIR / "votes_vectors_features.json", encoding="utf-8") as f:
                feat_names = json.load(f)["features"]
            importances = best_model.feature_importances_
            top_idx = np.argsort(importances)[-15:][::-1]
            print("\nTop 15 features :")
            for i in top_idx:
                if i < len(feat_names):
                    print(f"  {feat_names[i]:<50} {importances[i]:.4f}")
        except Exception:
            pass

    save_model(best_model, "model_votes")

    # Sauvegarde méta
    meta = {
        "best_model": best_name,
        "test_auc":   round(best_auc, 4),
        "n_train":    int(len(X_train)),
        "n_test":     int(len(X_test)),
        "classes":    ["REJECTED", "ADOPTED"],
    }
    with open(MODELS_DIR / "model_votes_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print("\nEntraînement votes terminé → output/models/")


if __name__ == "__main__":
    main()
