"""
Nettoyage avancé pour la branche ML 'diamant'
Part à partir du dataset Analytics pour produire un dataset 100% numérique.
"""

from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd

from config import (
    CLEANED_ANALYTICS_CSV,
    CLEANED_ML_CSV,
    CLEANED_ML_PARQUET,
    MISSING_PLACEHOLDER,
)
from logger_config import setup_logger

logger = setup_logger(__name__)

class MLDiamondCleaner:
    """
    Pipeline diamant :
    - part du cleaned_analytics
    - typage intelligent (numérique, dates, texte)
    - extraction de features temporelles
    - Frequency Encoding pour catégoriel
    - normalisation numérique
    - suppression colonnes constantes
    - dataset final 100% numérique, sans NaN
    """

    def __init__(self, path: Path = CLEANED_ANALYTICS_CSV):
        logger.info(f"[FILE] Chargement Analytics pour ML : {path}")
        self.df = pd.read_csv(path)

        self.stats: Dict[str, any] = {
            "shape_initial": self.df.shape,
            "duplicates_removed": 0,
            "missing_before": int(self.df.isnull().sum().sum()),
            "missing_after": None,
            "constant_columns_removed": [],
            "numeric_columns": [],
            "categorical_columns": [],
            "date_columns": [],
            "text_columns": [],
            "frequency_encoded": [],
            "scaled_columns": [],
        }

    def clean(self) -> pd.DataFrame:
        logger.info("[*] Début du nettoyage ML diamant...\n")

        self._remove_duplicates()
        self._coerce_dates()
        self._extract_date_features()
        self._coerce_numeric()
        self._standardize_text()
        self._handle_missing()
        self._drop_constant_columns()
        self._frequency_encode()
        self._scale_numeric()

        self.stats["shape_final"] = self.df.shape
        self.stats["missing_after"] = int(self.df.isnull().sum().sum())

        self._log_summary()
        logger.info("[SUCCESS] Nettoyage ML diamant terminé\n")
        return self.df

    def save(self) -> None:
        logger.info("[*] Sauvegarde ML diamant...")

        self.df.to_csv(CLEANED_ML_CSV, index=False, encoding="utf-8-sig")
        logger.info(f"[OK] CSV : {CLEANED_ML_CSV}")

        self.df.to_parquet(CLEANED_ML_PARQUET, index=False)
        logger.info(f"[OK] Parquet : {CLEANED_ML_PARQUET}\n")

    # ====== ÉTAPES ======

    def _remove_duplicates(self) -> None:
        before = len(self.df)
        self.df.drop_duplicates(inplace=True)
        removed = before - len(self.df)
        self.stats["duplicates_removed"] = int(removed)
        logger.info(f"[OK] Doublons supprimés : {removed}")

    def _coerce_dates(self) -> None:
        date_cols: List[str] = []
        for col in self.df.columns:
            if "date" in col.lower():
                try:
                    self.df[col] = pd.to_datetime(self.df[col], errors="coerce")
                    date_cols.append(col)
                except Exception:
                    pass
        self.stats["date_columns"] = date_cols
        if date_cols:
            logger.info(f"[OK] Colonnes dates détectées : {date_cols}")

    def _extract_date_features(self) -> None:
        for col in self.stats["date_columns"]:
            self.df[f"{col}_year"] = self.df[col].dt.year
            self.df[f"{col}_month"] = self.df[col].dt.month
            self.df[f"{col}_day"] = self.df[col].dt.day
            self.df[f"{col}_ts"] = self.df[col].astype("int64") // 10**9

        if self.stats["date_columns"]:
            self.df.drop(columns=self.stats["date_columns"], inplace=True)

    def _coerce_numeric(self) -> None:
        numeric_cols = list(self.df.select_dtypes(include=["number"]).columns)

        for col in self.df.select_dtypes(include=["object"]).columns:
            converted = pd.to_numeric(
                self.df[col].str.replace(",", ".", regex=False),
                errors="coerce",
            )
            ratio_valid = 1.0 - (converted.isna().sum() / len(converted))

            if ratio_valid >= 0.8:
                self.df[col] = converted
                numeric_cols.append(col)
                logger.info(f"[OK] Colonne convertie en numérique : {col}")

        self.stats["numeric_columns"] = numeric_cols

    def _standardize_text(self) -> None:
        text_cols: List[str] = []
        for col in self.df.select_dtypes(include=["object"]).columns:
            self.df[col] = (
                self.df[col]
                .astype(str)
                .str.strip()
                .str.lower()
                .str.replace(r"\s+", " ", regex=True)
            )
            text_cols.append(col)

        self.stats["text_columns"] = text_cols
        logger.info(f"[OK] Texte standardisé sur {len(text_cols)} colonnes")

    def _handle_missing(self) -> None:
        # Numérique : médiane
        for col in self.stats["numeric_columns"]:
            if self.df[col].isnull().any():
                median = float(self.df[col].median())
                self.df[col].fillna(median, inplace=True)

        # Texte / cat : placeholder
        for col in self.stats["text_columns"]:
            if self.df[col].isnull().any():
                self.df[col].fillna(MISSING_PLACEHOLDER, inplace=True)

    def _drop_constant_columns(self) -> None:
        constant_cols: List[str] = []
        for col in self.df.columns:
            if self.df[col].nunique(dropna=True) <= 1:
                constant_cols.append(col)

        if constant_cols:
            self.df.drop(columns=constant_cols, inplace=True)
            self.stats["constant_columns_removed"] = constant_cols
            logger.info(f"[OK] Colonnes constantes supprimées : {constant_cols}")

    def _frequency_encode(self) -> None:
        freq_cols: List[str] = []
        for col in self.df.select_dtypes(include=["object"]).columns:
            freq = self.df[col].value_counts(normalize=True)
            self.df[col] = self.df[col].map(freq)
            freq_cols.append(col)

        self.stats["frequency_encoded"] = freq_cols
        logger.info(f"[OK] Frequency Encoding sur {len(freq_cols)} colonnes")

    def _scale_numeric(self) -> None:
        num_cols = self.df.select_dtypes(include=["number"]).columns
        for col in num_cols:
            min_val = self.df[col].min()
            max_val = self.df[col].max()
            if max_val > min_val:
                self.df[col] = (self.df[col] - min_val) / (max_val - min_val)

        self.stats["scaled_columns"] = list(num_cols)
        logger.info(f"[OK] Normalisation MinMax sur {len(num_cols)} colonnes")

    def _log_summary(self) -> None:
        logger.info("\n[SUMMARY ML] Nettoyage diamant :")
        logger.info(f"  - Shape initial : {self.stats['shape_initial']}")
        logger.info(f"  - Shape final   : {self.stats['shape_final']}")
        logger.info(f"  - Doublons supprimés : {self.stats['duplicates_removed']}")
        logger.info(
            f"  - Manquants avant : {self.stats['missing_before']}, "
            f"après : {self.stats['missing_after']}"
        )
        if self.stats["constant_columns_removed"]:
            logger.info(
                f"  - Colonnes constantes supprimées : "
                f"{self.stats['constant_columns_removed']}"
            )

def main() -> None:
    cleaner = MLDiamondCleaner()
    cleaner.clean()
    cleaner.save()

if __name__ == "__main__":
    main()
