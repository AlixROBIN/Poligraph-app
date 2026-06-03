"""
preprocess.py
Sépare cleaned_analytics.csv en 3 datasets propres :
- scandales_features.csv  → ML catégorie/parti/élu
- votes_features.csv      → ML résultat vote
- elus_features.csv       → référentiel élus (dashboard + jointure)
"""

import ast
import re
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR   = Path("data")
OUTPUT_DIR = Path("output/analytics")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# Helpers JSON embarqué
# ============================================================

def safe_parse(val):
    """Parse un dict Python sérialisé en string."""
    if pd.isna(val) or str(val).strip() in ("Non spécifié", "", "nan"):
        return {}
    try:
        return ast.literal_eval(str(val))
    except Exception:
        return {}


def extract_party(val):
    d = safe_parse(val)
    return d.get("shortName", "Non spécifié")


def extract_party_name(val):
    d = safe_parse(val)
    return d.get("name", "Non spécifié")


def extract_politician_field(val, field):
    d = safe_parse(val)
    return d.get(field, "Non spécifié")


def parse_year(val):
    s = str(val)[:4]
    return int(s) if s.isdigit() else np.nan


def duration_days(start, end):
    try:
        s = pd.to_datetime(start, errors="coerce")
        e = pd.to_datetime(end,   errors="coerce")
        if pd.isna(s) or pd.isna(e):
            return np.nan
        return (e - s).days
    except Exception:
        return np.nan


# ============================================================
# 1. Chargement
# ============================================================

def load_raw():
    print("Chargement cleaned_analytics.csv …")
    df = pd.read_csv(DATA_DIR / "cleaned_analytics.csv", low_memory=False)
    print(f"  → {df.shape[0]:,} lignes x {df.shape[1]} colonnes")
    return df


# ============================================================
# 2. Dataset scandales
# ============================================================

def build_scandales(df: pd.DataFrame) -> pd.DataFrame:
    print("Construction dataset scandales …")
    sc = df[df["category"].notna() & (df["category"] != "Non spécifié")].copy()
    sc = sc.drop_duplicates(subset=["id"])

    # Extraction champs politician (JSON)
    sc["politician_id"]   = sc["politician"].apply(lambda v: extract_politician_field(v, "id"))
    sc["politician_name"] = sc["politician"].apply(lambda v: extract_politician_field(v, "fullName"))
    sc["politician_slug"] = sc["politician"].apply(lambda v: extract_politician_field(v, "slug"))

    # Extraction parti
    sc["party_short"] = sc["partyAtTime"].apply(extract_party)
    sc["party_name"]  = sc["partyAtTime"].apply(extract_party_name)

    # Dates
    sc["annee_faits"]   = sc["factsDate"].apply(parse_year)
    sc["annee_verdict"] = sc["verdictDate"].apply(parse_year)
    sc["duree_procedure"] = sc.apply(
        lambda r: duration_days(r["startDate"], r["verdictDate"]), axis=1
    )

    # Position politique du parti (si présente dans le join)
    sc["position_politique"] = sc["politicalPosition"].fillna("Non spécifié")

    # Nettoyage colonnes utiles
    cols = [
        "id", "slug", "title", "description",
        "status", "category",
        "factsDate", "startDate", "verdictDate",
        "annee_faits", "annee_verdict", "duree_procedure",
        "sentence", "appeal",
        "politician_id", "politician_name", "politician_slug",
        "party_short", "party_name",
        "position_politique",
        "institution", "departmentCode", "constituency",
    ]
    cols = [c for c in cols if c in sc.columns]
    sc = sc[cols]

    print(f"  → {len(sc)} scandales / {sc['party_short'].nunique()} partis / {sc['category'].nunique()} catégories")
    return sc


# ============================================================
# 3. Dataset votes
# ============================================================

def build_votes(df: pd.DataFrame) -> pd.DataFrame:
    print("Construction dataset votes …")
    vt = df[
        df["externalId"].notna() &
        (df["externalId"] != "Non spécifié") &
        (df["result"].notna()) &
        (df["result"] != "Non spécifié")
    ].copy()
    vt = vt.drop_duplicates(subset=["externalId"])

    # Numériques
    for col in ["votesFor", "votesAgainst", "votesAbstain", "totalVotes"]:
        vt[col] = pd.to_numeric(vt[col], errors="coerce").fillna(0)

    vt["annee_vote"]     = vt["votingDate"].apply(parse_year)
    vt["taux_pour"]      = vt["votesFor"]     / vt["totalVotes"].replace(0, np.nan)
    vt["taux_contre"]    = vt["votesAgainst"] / vt["totalVotes"].replace(0, np.nan)
    vt["taux_abstention"]= vt["votesAbstain"] / vt["totalVotes"].replace(0, np.nan)
    vt["marge"]          = vt["votesFor"] - vt["votesAgainst"]

    # Encodage cible binaire
    vt["result_bin"] = (vt["result"] == "ADOPTED").astype(int)

    cols = [
        "id", "externalId", "title",
        "votingDate", "annee_vote", "legislature",
        "votesFor", "votesAgainst", "votesAbstain", "totalVotes",
        "taux_pour", "taux_contre", "taux_abstention", "marge",
        "result", "result_bin",
        "sourceUrl",
    ]
    cols = [c for c in cols if c in vt.columns]
    vt = vt[cols]

    print(f"  → {len(vt)} votes | ADOPTED: {vt['result_bin'].sum()} / REJECTED: {(vt['result_bin']==0).sum()}")
    return vt


# ============================================================
# 4. Dataset élus
# ============================================================

def build_elus(df: pd.DataFrame) -> pd.DataFrame:
    print("Construction dataset élus …")
    el = df[
        df["fullName"].notna() &
        (df["fullName"] != "Non spécifié")
    ].copy()
    el = el.drop_duplicates(subset=["fullName"])

    el["party_short"]      = el["currentParty"].apply(extract_party)
    el["party_name"]       = el["currentParty"].apply(extract_party_name)
    el["position_politique"]= el["politicalPosition"].fillna("Non spécifié")
    el["annee_naissance"]  = el["birthDate"].apply(parse_year)
    el["age_approx"]       = 2025 - el["annee_naissance"]

    cols = [
        "id", "slug", "fullName", "firstName", "lastName",
        "civility", "birthDate", "annee_naissance", "age_approx",
        "birthPlace", "photoUrl",
        "party_short", "party_name", "position_politique",
        "institution", "departmentCode", "constituency",
        "isCurrent",
    ]
    cols = [c for c in cols if c in el.columns]
    el = el[cols]

    print(f"  → {len(el)} élus uniques / {el['party_short'].nunique()} partis")
    return el


# ============================================================
# 5. Enrichissement : scandales × élus
# ============================================================

def enrich_scandales(sc: pd.DataFrame, el: pd.DataFrame) -> pd.DataFrame:
    """Jointure scandales → élus pour récupérer infos manquantes."""
    print("Enrichissement scandales avec profil élu …")
    el_mini = el[["fullName", "age_approx", "annee_naissance", "isCurrent"]].rename(
        columns={"fullName": "politician_name"}
    )
    sc = sc.merge(el_mini, on="politician_name", how="left")
    return sc


# ============================================================
# MAIN
# ============================================================

def main():
    df  = load_raw()
    sc  = build_scandales(df)
    vt  = build_votes(df)
    el  = build_elus(df)
    sc  = enrich_scandales(sc, el)

    sc.to_csv(OUTPUT_DIR / "scandales_features.csv", index=False, encoding="utf-8")
    vt.to_csv(OUTPUT_DIR / "votes_features.csv",     index=False, encoding="utf-8")
    el.to_csv(OUTPUT_DIR / "elus_features.csv",      index=False, encoding="utf-8")

    print("\nFichiers sauvegardés dans output/analytics/")
    print(f"  scandales_features.csv  : {len(sc)} lignes")
    print(f"  votes_features.csv      : {len(vt)} lignes")
    print(f"  elus_features.csv       : {len(el)} lignes")


if __name__ == "__main__":
    main()
