"""
train_elus.py — Apprentissage direct sur les élus.

M4 — Prédiction du parti depuis le profil (âge, institution, département)
     → 1 575 élus avec parti connu | multiclasse
     → Métrique : F1-weighted (CV 5-fold) + AUC-OvR

M5 — Risque de scandale (binaire très déséquilibré : 113 positifs / 34 982 négatifs)
     → Toute la base élus | class_weight="balanced"
     → Métriques : AUC-ROC + AUC-PR (Precision-Recall, plus fiable sur données déséquilibrées)
"""

import json
import pickle
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.feature_extraction import FeatureHasher
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    roc_auc_score,
)
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

warnings.filterwarnings("ignore")

ROOT_DIR      = Path(__file__).resolve().parent.parent
ANALYTICS_DIR = ROOT_DIR / "output" / "analytics"
VECTORS_DIR   = ROOT_DIR / "output" / "vectors"
MODELS_DIR    = ROOT_DIR / "output" / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _save(model, name, extra: dict | None = None):
    obj = {"model": model}
    if extra:
        obj.update(extra)
    with open(MODELS_DIR / f"{name}.pkl", "wb") as f:
        pickle.dump(obj, f)
    print(f"  → sauvegardé : output/models/{name}.pkl")


def _save_meta(name: str, meta: dict):
    with open(MODELS_DIR / f"{name}_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def _load_prev(name: str) -> dict:
    p = MODELS_DIR / f"{name}_meta.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else {}


def _delta(label: str, prev: float | None, curr: float):
    if prev is None:
        print(f"  {label} : {curr:.3f}  (premier run)")
    else:
        sign = "+" if curr >= prev else ""
        print(f"  {label} : {curr:.3f}  ({sign}{curr - prev:+.3f} vs run précédent)")


def _build_profile_features(df: pd.DataFrame) -> np.ndarray:
    """
    Construit un vecteur profil depuis les champs démographiques/institutionnels.
    Pas de champ parti pour éviter le data leakage (utilisé pour M4).
    """
    # Numérique : âge
    age = df["age_approx"].fillna(df["age_approx"].median()).values.reshape(-1, 1)
    scaler = StandardScaler()
    X_num = scaler.fit_transform(age)

    # Hash : institution (64), departmentCode (32), constituency (32)
    h64 = FeatureHasher(n_features=64, input_type="string")
    h32 = FeatureHasher(n_features=32, input_type="string")

    def _col(c):
        return df[c].fillna("Non spécifié").astype(str).tolist()

    X_inst  = h64.transform([[v] for v in _col("institution")]).toarray()
    X_dept  = h32.transform([[v] for v in _col("departmentCode")]).toarray()
    X_circ  = h32.transform([[v] for v in _col("constituency")]).toarray()

    return np.hstack([X_num, X_inst, X_dept, X_circ])   # (n, 129)


# ──────────────────────────────────────────────────────────────────────────────
# M4 — Prédiction du parti depuis le profil
# ──────────────────────────────────────────────────────────────────────────────

def train_party_from_profile():
    print("\n[M4] Prédiction du parti depuis le profil de l'élu")

    df = pd.read_csv(ANALYTICS_DIR / "elus_features.csv", low_memory=False)

    # Garder uniquement les élus avec un parti connu
    mask   = (df["party_short"] != "Non spécifié") & df["party_short"].notna()
    df_f   = df[mask].copy()
    n      = len(df_f)

    # Garder les partis avec au moins 5 élus (sinon CV instable)
    counts = df_f["party_short"].value_counts()
    valid_parties = counts[counts >= 5].index
    df_f   = df_f[df_f["party_short"].isin(valid_parties)]
    n_used = len(df_f)
    n_classes = len(valid_parties)

    print(f"  {n} élus avec parti connu → {n_used} après filtrage partis < 5 membres")
    print(f"  {n_classes} partis : {', '.join(sorted(valid_parties))}")

    le = LabelEncoder()
    y  = le.fit_transform(df_f["party_short"])
    X  = _build_profile_features(df_f)

    prev = _load_prev("model_elu_party")

    # CV 5-fold (ou moins si classes trop petites)
    min_count = int(counts[valid_parties].min())
    cv_k = min(5, min_count)

    models = {
        "RandomForest": RandomForestClassifier(
            n_estimators=300, max_depth=8,
            class_weight="balanced", random_state=42,
        ),
        "LogisticReg": LogisticRegression(
            max_iter=1000, class_weight="balanced", random_state=42,
        ),
    }

    best_f1, best_model, best_name = -1.0, None, ""
    for mname, m in models.items():
        cv = cross_val_score(m, X, y, cv=cv_k, scoring="f1_weighted")
        print(f"  {mname:<15} CV F1 : {cv.mean():.3f} ± {cv.std():.3f}  (k={cv_k})")
        if cv.mean() > best_f1:
            best_f1, best_model, best_name = cv.mean(), m, mname

    # Évaluation hold-out
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    best_model.fit(X_tr, y_tr)
    y_pred  = best_model.predict(X_te)
    y_proba = best_model.predict_proba(X_te)

    te_cls    = np.unique(y_te)
    te_names  = le.classes_[te_cls]
    model_cls = np.array(best_model.classes_)
    shared    = np.intersect1d(te_cls, model_cls)
    proba_cols = np.searchsorted(model_cls, shared)
    te_mask   = np.isin(y_te, shared)

    print(f"\n  Meilleur : {best_name}")
    print(classification_report(y_te[te_mask], y_pred[te_mask],
                                 labels=shared,
                                 target_names=le.classes_[shared],
                                 zero_division=0))
    try:
        test_auc = roc_auc_score(
            y_te[te_mask], y_proba[te_mask][:, proba_cols],
            multi_class="ovr", average="weighted", labels=shared,
        )
    except ValueError:
        test_auc = float("nan")

    _delta("Test AUC-OvR", prev.get("test_auc"), test_auc)

    # Entraînement final sur tout
    best_model.fit(X, y)
    _save(best_model, "model_elu_party", {"label_encoder": le})
    _save_meta("model_elu_party", {
        "best_model": best_name,
        "cv_f1": round(best_f1, 4),
        "test_auc": round(test_auc, 4) if test_auc == test_auc else None,
        "n_samples": n_used,
        "n_classes": n_classes,
        "classes": le.classes_.tolist(),
    })


# ──────────────────────────────────────────────────────────────────────────────
# M5 — Risque de scandale (binaire déséquilibré)
# ──────────────────────────────────────────────────────────────────────────────

def train_scandal_risk():
    print("\n[M5] Risque de scandale par élu (classification binaire déséquilibrée)")

    el  = pd.read_csv(ANALYTICS_DIR / "elus_features.csv",     low_memory=False)
    sc  = pd.read_csv(ANALYTICS_DIR / "scandales_features.csv", low_memory=False)

    # Label : 1 si l'élu apparaît dans les scandales
    impliques = set(sc["politician_name"].dropna().unique())
    el["scandale"] = el["fullName"].apply(lambda n: 1 if n in impliques else 0)

    n_pos = el["scandale"].sum()
    n_neg = len(el) - n_pos
    print(f"  Positifs (impliqués) : {n_pos}  |  Négatifs : {n_neg}  |  Ratio : 1:{n_neg//n_pos}")
    print(f"  → Métriques : AUC-ROC + AUC-PR (Precision-Recall, adaptée au déséquilibre)")

    # Features : vecteurs élus pré-calculés
    X = np.load(VECTORS_DIR / "elus_vectors.npy")
    y = el["scandale"].values

    assert len(X) == len(y), "Désalignement élus features / vecteurs"

    prev = _load_prev("model_elu_risk")

    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    models = {
        "RandomForest": RandomForestClassifier(
            n_estimators=300, max_depth=6,
            class_weight="balanced", random_state=42,
        ),
        "LogisticReg": LogisticRegression(
            max_iter=1000, class_weight="balanced", C=0.1, random_state=42,
        ),
        "GradientBoosting": GradientBoostingClassifier(
            n_estimators=200, max_depth=3, learning_rate=0.05,
            subsample=0.8, random_state=42,
        ),
    }

    best_auc_pr, best_model, best_name = -1.0, None, ""

    for mname, m in models.items():
        # CV AUC-ROC (5-fold)
        cv_roc = cross_val_score(m, X_tr, y_tr, cv=5, scoring="roc_auc")
        # CV AUC-PR
        cv_pr  = cross_val_score(m, X_tr, y_tr, cv=5, scoring="average_precision")
        print(f"  {mname:<20} CV AUC-ROC : {cv_roc.mean():.3f} ± {cv_roc.std():.3f}"
              f"  |  CV AUC-PR : {cv_pr.mean():.3f} ± {cv_pr.std():.3f}")
        if cv_pr.mean() > best_auc_pr:
            best_auc_pr, best_model, best_name = cv_pr.mean(), m, mname

    best_model.fit(X_tr, y_tr)
    y_proba_te = best_model.predict_proba(X_te)[:, 1]
    y_pred_te  = best_model.predict(X_te)

    test_roc = roc_auc_score(y_te, y_proba_te)
    test_pr  = average_precision_score(y_te, y_proba_te)

    print(f"\n  Meilleur : {best_name}")
    print(f"  Test AUC-ROC : {test_roc:.3f}  |  Test AUC-PR : {test_pr:.3f}")
    print(classification_report(y_te, y_pred_te,
                                 target_names=["Pas de scandale", "À risque"],
                                 zero_division=0))
    _delta("Test AUC-ROC", prev.get("test_roc"), test_roc)
    _delta("Test AUC-PR",  prev.get("test_pr"),  test_pr)

    # Feature importances
    if hasattr(best_model, "feature_importances_"):
        idx_path = VECTORS_DIR / "elus_index.json"
        feat_path = VECTORS_DIR / "elus_vectors_features.json"
        if feat_path.exists():
            with open(feat_path, encoding="utf-8") as f:
                feat_names = json.load(f)["features"]
            imps = best_model.feature_importances_
            top  = np.argsort(imps)[-10:][::-1]
            print("  Top 10 features :")
            for i in top:
                if i < len(feat_names):
                    print(f"    {feat_names[i]:<40} {imps[i]:.4f}")

    # Entraînement final
    best_model.fit(X, y)
    _save(best_model, "model_elu_risk")
    _save_meta("model_elu_risk", {
        "best_model": best_name,
        "test_roc":  round(test_roc, 4),
        "test_pr":   round(test_pr, 4),
        "n_pos":     int(n_pos),
        "n_neg":     int(n_neg),
        "threshold_note": "Seuil par défaut=0.5. Ajuster selon le compromis précision/rappel.",
    })

    return best_model


# ──────────────────────────────────────────────────────────────────────────────
# Export : score de risque pour chaque élu
# ──────────────────────────────────────────────────────────────────────────────

def export_risk_scores(model):
    """Calcule et exporte le score de risque pour tous les élus."""
    print("\n  Export des scores de risque…")
    el = pd.read_csv(ANALYTICS_DIR / "elus_features.csv", low_memory=False)
    X  = np.load(VECTORS_DIR / "elus_vectors.npy")

    probas = model.predict_proba(X)[:, 1]

    out = el[["id", "slug", "fullName", "party_short", "institution"]].copy()
    out["risk_score"] = np.round(probas, 4)
    out = out.sort_values("risk_score", ascending=False)

    out_path = ANALYTICS_DIR / "elus_risk_scores.csv"
    out.to_csv(out_path, index=False)
    print(f"  → {out_path}  ({len(out):,} élus scorés)")
    print(f"  Top 5 à risque :")
    print(out.head(5)[["fullName", "party_short", "risk_score"]].to_string(index=False))


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    train_party_from_profile()
    model_risk = train_scandal_risk()
    export_risk_scores(model_risk)
    print("\nEntraînement élus terminé → output/models/")


if __name__ == "__main__":
    main()
