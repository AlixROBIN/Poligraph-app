"""
Enrichissement avancé des données Analytics à partir du raw.csv
- Parsing JSON (partis, institutions, positions…)
- Extraction des dates
- Colonnes dérivées
- Nettoyage des valeurs
- Préparation pour exploration, mining, ML diamant et dashboard React
"""

import ast
import pandas as pd
from pathlib import Path

from config import RAW_CSV, CLEANED_ANALYTICS_CSV, MISSING_PLACEHOLDER
from logger_config import setup_logger

logger = setup_logger(__name__)


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def safe_json_parse(value):
    """Parse proprement un champ JSON stocké en string."""
    if pd.isna(value):
        return {}
    try:
        return ast.literal_eval(value)
    except:
        return {}


def extract_party(row):
    """Extrait les infos du parti depuis currentParty."""
    obj = safe_json_parse(row)
    return pd.Series({
        "party_id": obj.get("id"),
        "party_name": obj.get("name"),
        "party_short": obj.get("shortName"),
        "party_color": obj.get("color"),
    })


def extract_institution(row):
    """Extrait l'institution (si c'est un objet JSON)."""
    obj = safe_json_parse(row)
    if isinstance(obj, dict):
        return obj.get("name") or obj.get("shortName")
    return row


def extract_position(row):
    """Extrait la position politique."""
    obj = safe_json_parse(row)
    return obj.get("position") if isinstance(obj, dict) else None


# ---------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------

class AnalyticsEnricher:

    def __init__(self, path: Path = RAW_CSV):
        logger.info(f"[LOAD] raw.csv : {path}")
        self.df = pd.read_csv(path, low_memory=False)

    def enrich(self):
        logger.info("[*] Enrichissement Analytics...")

        self._clean_text()
        self._extract_dates()
        self._parse_party()
        self._parse_institution()
        self._parse_positions()
        self._derive_features()

        logger.info("[SUCCESS] Enrichissement terminé")
        return self.df

    # -----------------------------------------------------
    # Nettoyage texte
    # -----------------------------------------------------

    def _clean_text(self):
        logger.info("[CLEAN] Nettoyage texte...")
        text_cols = self.df.select_dtypes(include=["object"]).columns
        for col in text_cols:
            self.df[col] = (
                self.df[col]
                .astype(str)
                .str.strip()
                .str.replace(r"\s+", " ", regex=True)
                .replace("None", MISSING_PLACEHOLDER)
                .replace("nan", MISSING_PLACEHOLDER)
            )

    # -----------------------------------------------------
    # Dates
    # -----------------------------------------------------

    def _extract_dates(self):
        logger.info("[DATE] Extraction dates...")

        date_cols = [
            "postDate", "startDate", "endDate", "factsDate",
            "roundDate", "dateConfirmed", "pubDate", "deathDate",
            "birthDate", "absoluteDate", "longDate"
        ]

        for col in date_cols:
            if col in self.df.columns:
                self.df[col] = pd.to_datetime(self.df[col], errors="coerce")

        # Année principale
        if "factsDate" in self.df.columns:
            self.df["year"] = self.df["factsDate"].dt.year

    # -----------------------------------------------------
    # Parsing JSON
    # -----------------------------------------------------

    def _parse_party(self):
        if "currentParty" not in self.df.columns:
            return

        logger.info("[PARSE] currentParty → colonnes propres (optimisé)...")

        party_id = []
        party_name = []
        party_short = []
        party_color = []

        # Boucle optimisée (beaucoup plus rapide que apply)
        for val in self.df["currentParty"].values:
            if isinstance(val, str) and val.startswith("{") and val.endswith("}"):
                try:
                    obj = ast.literal_eval(val)
                    party_id.append(obj.get("id"))
                    party_name.append(obj.get("name"))
                    party_short.append(obj.get("shortName"))
                    party_color.append(obj.get("color"))
                except Exception:
                    party_id.append(None)
                    party_name.append(None)
                    party_short.append(None)
                    party_color.append(None)
            else:
                party_id.append(None)
                party_name.append(None)
                party_short.append(None)
                party_color.append(None)

        self.df["party_id"] = party_id
        self.df["party_name"] = party_name
        self.df["party_short"] = party_short
        self.df["party_color"] = party_color


    def _parse_institution(self):
        if "institution" not in self.df.columns:
            return

        logger.info("[PARSE] institution...")
        self.df["institution_clean"] = self.df["institution"].apply(extract_institution)

    def _parse_positions(self):
        if "politician" not in self.df.columns:
            return

        logger.info("[PARSE] politician.position...")
        self.df["political_position"] = self.df["politician"].apply(extract_position)

    # -----------------------------------------------------
    # Features dérivées
    # -----------------------------------------------------

    def _derive_features(self):
        logger.info("[FEATURES] Création features dérivées...")

        # Durée entre début et fin
        if "startDate" in self.df.columns and "endDate" in self.df.columns:
            self.df["duration_days"] = (
                self.df["endDate"] - self.df["startDate"]
            ).dt.days

        # Indicateurs booléens
        self.df["has_party"] = self.df["party_id"].notna()
        self.df["has_institution"] = self.df["institution_clean"].notna()
        self.df["has_position"] = self.df["political_position"].notna()

        # Votes
        for col in ["votesFor", "votesAgainst", "votesAbstain"]:
            if col in self.df.columns:
                self.df[col] = pd.to_numeric(self.df[col], errors="coerce")

        if all(c in self.df.columns for c in ["votesFor", "votesAgainst", "votesAbstain"]):
            self.df["votes_total"] = (
                self.df["votesFor"] + self.df["votesAgainst"] + self.df["votesAbstain"]
            )

    # -----------------------------------------------------
    # Sauvegarde
    # -----------------------------------------------------

    def save(self, path: Path = CLEANED_ANALYTICS_CSV):
        logger.info(f"[SAVE] {path}")
        self.df.to_csv(path, index=False, encoding="utf-8-sig")


def main():
    enricher = AnalyticsEnricher()
    enricher.enrich()
    enricher.save()


if __name__ == "__main__":
    main()
