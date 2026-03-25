"""
Nettoyage pour la branche Analytics (lisible, orientée exploration / API / React)
"""

from pathlib import Path
import pandas as pd

from config import (
    RAW_CSV,
    CLEANED_ANALYTICS_CSV,
    CLEANED_ANALYTICS_PARQUET,
    MISSING_PLACEHOLDER,
)
from logger_config import setup_logger

logger = setup_logger(__name__)

class AnalyticsCleaner:
    """
    Nettoyage léger :
    - suppression doublons
    - remplissage des valeurs manquantes
    - standardisation légère du texte
    """

    def __init__(self, path: Path = RAW_CSV):
        logger.info(f"[FILE] Chargement brut (analytics) : {path}")
        self.df = pd.read_csv(path, low_memory=False)

    def clean(self) -> pd.DataFrame:
        logger.info("[*] Nettoyage Analytics...\n")
        logger.info(f"Avant : {self.df.shape}")

        self._remove_duplicates()
        self._fill_missing()
        self._standardize_text()

        logger.info(f"Après : {self.df.shape}\n")
        logger.info("[SUCCESS] Nettoyage Analytics terminé\n")
        return self.df

    def _remove_duplicates(self) -> None:
        before = len(self.df)
        self.df = self.df.drop_duplicates()
        removed = before - len(self.df)
        logger.info(f"[OK] Doublons supprimés : {removed}")

    def _fill_missing(self) -> None:
        total_before = int(self.df.isnull().sum().sum())
        self.df = self.df.fillna(MISSING_PLACEHOLDER)
        logger.info(f"[OK] Valeurs manquantes remplies : {total_before}")

    def _standardize_text(self) -> None:
        cols = self.df.select_dtypes(include=["object", "string"]).columns
        for col in cols:
            self.df[col] = (
                self.df[col]
                .astype(str)
                .str.strip()
                .str.replace(r"\s+", " ", regex=True)
            )
        logger.info(f"[OK] Texte standardisé sur {len(cols)} colonnes")

    def save(self) -> None:
        logger.info("[*] Sauvegarde Analytics...")

        # CSV
        self.df.to_csv(CLEANED_ANALYTICS_CSV, index=False, encoding="utf-8-sig")
        logger.info(f"[OK] CSV : {CLEANED_ANALYTICS_CSV}")

        # JSON désactivé (trop lourd)
        logger.info("[SKIP] JSON désactivé (dataset trop volumineux)")

        # Parquet
        self.df.to_parquet(CLEANED_ANALYTICS_PARQUET, index=False)
        logger.info(f"[OK] Parquet : {CLEANED_ANALYTICS_PARQUET}\n")


def main() -> None:
    cleaner = AnalyticsCleaner()
    cleaner.clean()
    cleaner.save()


if __name__ == "__main__":
    main()
