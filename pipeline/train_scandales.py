"""
train_scandales.py
3 modèles entraînés sur les scandales :
  M1 — Catégorie du scandale       (multiclasse)
  M2 — Parti le plus à risque      (multiclasse)
  M3 — Identification de l'élu     (multiclasse → nom retrouvable)
"""

import json
import pickle
import warnings
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")

ROOT_DIR     = Path(__file__).resolve().parent.parent
VECTORS_DIR  = ROOT_DIR / "output/vectors"
MODELS_DIR   = ROOT_DIR / "output/models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# Helpers
# ============================================================

def load_data():
    X = np.load(VECTORS_DIR / "scandales_vectors.npy")
    with open(VECTORS_DIR / "scandales_labels.json", encoding="utf-8") as f:
        labels = json.load(f)
    return X, labels


def save_model(model, le, name):
    with open(MODELS_DIR / f"{name}.pkl", "wb") as f:
        pickle.dump({"model": model, "label_encoder": le}, f)
    print(f"  Modèle sauvegardé → output/models/{name}.pkl")


def encode_labels(raw_labels):
    le = LabelEncoder()
    y  = le.fit_transform(raw_labels)
    return y, le


def best_model_for_small_data(n_samples):
    """Random Forest avec class_weight='balanced' — robuste sur petits datasets."""
    if n_samples < 500:
        return RandomForestClassifier(
            n_estimators=200, max_depth=6,
            class_weight="balanced", random_state=42,
        )
    return GradientBoostingClassifier(n_estimators=200, max_depth=4, random_state=42)


def _load_previous_meta(name: str) -> dict:
    path = MODELS_DIR / f"{name}_meta.json"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _print_delta(label: str, prev: float | None, curr: float):
    if prev is None:
        print(f"  {label} : {curr:.3f}  (premier run)")
    else:
        delta = curr - prev
        sign  = "+" if delta >= 0 else ""
        print(f"  {label} : {curr:.3f}  ({sign}{delta:+.3f} vs run précédent)")


# ============================================================
# M1 — Prédiction catégorie du scandale
# ============================================================

def train_category(X, labels):
    print("\n[M1] Prédiction de la catégorie du scandale")
    raw  = labels["category"]
    y, le = encode_labels(raw)
    n    = len(y)
    n_classes = len(le.classes_)

    prev_meta = _load_previous_meta("model_category")

    # ── Filtrage des classes singleton (trop peu pour stratifier) ────────────
    counts   = np.bincount(y)
    ok_mask  = counts[y] >= 2          # garder les exemples de classes avec ≥ 2 membres
    singletons = int((counts == 1).sum())
    if singletons:
        print(f"  ⚠ {singletons} classe(s) avec 1 seul exemple exclues de l'évaluation"
              f" (conservées pour l'entraînement final)")
    X_eval, y_eval = X[ok_mask], y[ok_mask]

    # ── Hold-out 20 % stratifié sur les classes éligibles ────────────────────
    X_tr, X_te, y_tr, y_te = train_test_split(
        X_eval, y_eval, test_size=0.2, stratify=y_eval, random_state=42
    )

    model = best_model_for_small_data(n)

    # ── CV 5-fold (adapte k si certaines classes sont trop petites) ──────────
    min_class_count = int(counts[counts >= 2].min())
    cv_k = min(5, min_class_count)
    cv_f1  = cross_val_score(model, X_tr, y_tr, cv=cv_k, scoring="f1_weighted")
    cv_auc = cross_val_score(model, X_tr, y_tr, cv=cv_k, scoring="roc_auc_ovr_weighted")
    print(f"  Échantillons : {n} total | {len(X_tr)} train | {len(X_te)} test"
          f" | {n_classes} classes | CV k={cv_k}")
    _print_delta("CV F1-weighted (train)", prev_meta.get("cv_f1"),  cv_f1.mean())
    _print_delta("CV AUC-OvR   (train)", prev_meta.get("cv_auc"), cv_auc.mean())

    # ── Entraînement final sur train ──────────────────────────
    model.fit(X_tr, y_tr)

    # ── Évaluation sur test ───────────────────────────────────
    y_pred  = model.predict(X_te)
    y_proba = model.predict_proba(X_te)
    try:
        # model.classes_ = classes vues à l'entraînement (peut exclure les singletons)
        model_cls    = np.array(model.classes_)
        te_unique    = np.unique(y_te)
        # Garder uniquement les classes présentes à la fois dans le test ET dans le modèle
        shared_cls   = np.intersect1d(te_unique, model_cls)
        proba_cols   = np.searchsorted(model_cls, shared_cls)
        te_mask      = np.isin(y_te, shared_cls)
        test_auc = roc_auc_score(
            y_te[te_mask], y_proba[te_mask][:, proba_cols],
            multi_class="ovr", average="weighted",
            labels=shared_cls,
        )
    except ValueError:
        test_auc = float("nan")

    print(f"\n  Rapport test :")
    te_labels      = np.unique(y_te)
    te_class_names = le.classes_[te_labels]
    print(classification_report(y_te, y_pred, labels=te_labels,
                                 target_names=te_class_names, zero_division=0))
    _print_delta("Test AUC-OvR", prev_meta.get("test_auc"), test_auc)

    # ── Entraînement final sur TOUT le dataset ────────────────
    model.fit(X, y)

    # ── Top features ──────────────────────────────────────────
    if hasattr(model, "feature_importances_"):
        feat_path = VECTORS_DIR / "scandales_vectors_features.json"
        if feat_path.exists():
            with open(feat_path, encoding="utf-8") as f:
                feat_names = json.load(f)["features"]
            importances = model.feature_importances_
            top_idx = np.argsort(importances)[-10:][::-1]
            print("  Top 10 features :")
            for i in top_idx:
                if i < len(feat_names):
                    marker = " ◀ SENTIMENT" if feat_names[i] == "sentiment_score" else ""
                    print(f"    {feat_names[i]:<40} {importances[i]:.4f}{marker}")

    save_model(model, le, "model_category")

    # ── Meta JSON (comparaison future) ────────────────────────
    meta = {
        "cv_f1":    round(float(cv_f1.mean()),  4),
        "cv_f1_std":round(float(cv_f1.std()),   4),
        "cv_auc":   round(float(cv_auc.mean()), 4),
        "test_auc": round(test_auc, 4) if not (test_auc != test_auc) else None,
        "n_samples": n,
        "n_classes": n_classes,
        "classes":   le.classes_.tolist(),
        "sentiment_feature": "sentiment_score" in (
            json.load(open(VECTORS_DIR / "scandales_vectors_features.json"))["features"]
            if (VECTORS_DIR / "scandales_vectors_features.json").exists() else []
        ),
    }
    with open(MODELS_DIR / "model_category_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    return model, le


# ============================================================
# M2 — Prédiction du parti le plus à risque
# ============================================================

def train_party(X, labels):
    print("\n[M2] Prédiction du parti (risque scandale)")
    raw = [p for p in labels["party_short"]]
    # Exclure "Non spécifié"
    mask = np.array([p != "Non spécifié" for p in raw])
    X_f  = X[mask]
    raw_f = [r for r, m in zip(raw, mask) if m]

    if len(raw_f) < 10:
        print("  ⚠ Pas assez de données labelisées pour ce modèle.")
        return None, None

    y, le = encode_labels(raw_f)

    model = best_model_for_small_data(len(y))
    scores = cross_val_score(model, X_f, y, cv=min(5, len(y)//5),
                              scoring="f1_weighted")
    print(f"  CV F1-weighted : {scores.mean():.3f} ± {scores.std():.3f}")

    model.fit(X_f, y)

    # Distribution prédite
    proba_mean = model.predict_proba(X_f).mean(axis=0)
    print("  Probabilité moyenne par parti :")
    for cls, p in sorted(zip(le.classes_, proba_mean), key=lambda x: -x[1])[:8]:
        print(f"    {cls:<15} {p:.3f}")

    save_model(model, le, "model_party")
    return model, le


# ============================================================
# M3 — Identification de l'élu (nom retrouvable)
# ============================================================

def train_politician(X, labels):
    print("\n[M3] Identification de l'élu")
    raw_names = labels["politician_name"]
    raw_ids   = labels["politician_id"]

    # Exclure Non spécifié
    mask = np.array([n not in ("Non spécifié", "", None) for n in raw_names])
    X_f  = X[mask]
    names_f = [n for n, m in zip(raw_names, mask) if m]
    ids_f   = [i for i, m in zip(raw_ids,   mask) if m]

    if len(names_f) < 5:
        print("  ⚠ Pas assez d'élus identifiés pour entraîner ce modèle.")
        return None, None

    y, le = encode_labels(names_f)
    n_classes = len(le.classes_)
    print(f"  {len(y)} scandales / {n_classes} élus distincts")

    # Avec peu de classes, Logistic Regression + RF comparés
    models = {
        "RandomForest":  RandomForestClassifier(n_estimators=300, max_depth=8,
                                                class_weight="balanced", random_state=42),
        "LogisticReg":   LogisticRegression(max_iter=1000, class_weight="balanced",
                                             random_state=42),
    }

    best_score, best_model = -1, None
    cv_k = min(5, max(2, len(y) // n_classes))

    for mname, m in models.items():
        try:
            s = cross_val_score(m, X_f, y, cv=cv_k, scoring="f1_weighted")
            print(f"  {mname:<15} CV F1 : {s.mean():.3f} ± {s.std():.3f}")
            if s.mean() > best_score:
                best_score = s.mean()
                best_model = m
        except Exception as e:
            print(f"  {mname} erreur : {e}")

    if best_model is None:
        return None, None

    best_model.fit(X_f, y)

    # Mapping id → nom pour lookup post-prédiction
    id_to_name = {i: n for i, n in zip(ids_f, names_f)}
    with open(MODELS_DIR / "politician_id_to_name.json", "w", encoding="utf-8") as f:
        json.dump(id_to_name, f, ensure_ascii=False, indent=2)

    save_model(best_model, le, "model_politician")
    return best_model, le


# ============================================================
# MAIN
# ============================================================

def main():
    print("Chargement des vecteurs scandales …")
    X, labels = load_data()
    print(f"  X shape : {X.shape}")

    train_category(X, labels)
    train_party(X, labels)
    train_politician(X, labels)

    print("\nEntraînement terminé → output/models/")


if __name__ == "__main__":
    main()
