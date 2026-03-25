"""
Data Mining thématique sur les données Analytics enrichies
- Détection de thèmes
- Analyse par thème
- Graphiques thématiques
- Rapport thématique
"""

import pandas as pd
import matplotlib.pyplot as plt
from typing import Dict

from config import (
    CLEANED_ANALYTICS_CSV,
    CHART_2,
    REPORT_MINING,
    CHART_DPI,
    CHART_SIZE,
)
from logger_config import setup_logger

logger = setup_logger(__name__)


class DataMiner:
    """Analyse thématique des données Analytics enrichies"""

    def __init__(self, path=CLEANED_ANALYTICS_CSV):
        logger.info(f"[FILE] Chargement Analytics enrichi : {path}")
        self.df = pd.read_csv(path)
        self.themes: Dict[str, str] = {}

    def mine(self) -> Dict[str, str]:
        logger.info("\n[*] Data Mining & Analyse...\n")

        self._detect_themes()
        self._analyze_themes()
        self._generate_charts()
        self._save_report()

        logger.info("[SUCCESS] Mining complet\n")
        return self.themes

    # -----------------------------
    # Détection des thèmes
    # -----------------------------

    def _detect_themes(self) -> None:
        logger.info("[*] Détection des thèmes...\n")

        keywords = {
            "politique": ["party", "institution", "position"],
            "judiciaire": ["sentence", "verdict", "appeal", "status"],
            "territorial": ["department", "city", "county", "constituency"],
            "vote": ["votesFor", "votesAgainst", "votesAbstain"],
        }

        for theme, kwords in keywords.items():
            for col in self.df.columns:
                if any(k.lower() in col.lower() for k in kwords):
                    self.themes[theme] = col
                    logger.info(f"[OK] {theme} → {col}")
                    break

    # -----------------------------
    # Analyse des thèmes
    # -----------------------------

    def _analyze_themes(self) -> None:
        logger.info("\n[STATS] Statistiques globales :")
        logger.info(f"  - Total : {len(self.df)}")
        logger.info(f"  - Colonnes : {len(self.df.columns)}")

        for theme, col in self.themes.items():
            logger.info(f"\n{theme.upper()} ({col}) :")
            logger.info(f"  - Uniques : {self.df[col].nunique()}")
            top = self.df[col].value_counts().head(10)
            for val, cnt in top.items():
                logger.info(f"    {val}: {cnt}")

    # -----------------------------
    # Graphiques thématiques
    # -----------------------------

    def _generate_charts(self) -> None:
        logger.info("\n[*] Génération graphiques Mining...")

        fig, axes = plt.subplots(2, 2, figsize=CHART_SIZE)
        fig.suptitle(
            "Data Mining - PoliGraph (Analytics enrichies)",
            fontsize=16,
            fontweight="bold",
        )

        idx = 0
        for theme, col in self.themes.items():
            if idx >= 4:
                break
            ax = axes.flat[idx]

            top = self.df[col].value_counts().head(10)
            ax.barh(range(len(top)), top.values)
            ax.set_yticks(range(len(top)))
            ax.set_yticklabels(top.index, fontsize=8)
            ax.set_title(theme.upper())
            ax.invert_yaxis()

            idx += 1

        for i in range(idx, 4):
            axes.flat[i].axis("off")

        plt.tight_layout()
        plt.savefig(CHART_2, dpi=CHART_DPI, bbox_inches="tight")
        logger.info(f"[OK] Chart : {CHART_2}")
        plt.close()

    # -----------------------------
    # Rapport
    # -----------------------------

    def _save_report(self) -> None:
        with open(REPORT_MINING, "w", encoding="utf-8") as f:
            f.write("DATA MINING - POLIGRAPH API (Analytics enrichies)\n")
            f.write("=" * 50 + "\n\n")
            f.write(f"Records: {len(self.df)}\n")
            f.write(f"Colonnes: {len(self.df.columns)}\n\n")
            f.write("THEMES DÉTECTÉS:\n")
            for theme, col in self.themes.items():
                f.write(f"\n{theme}:\n")
                f.write(f"  Colonne: {col}\n")
                f.write(f"  Uniques: {self.df[col].nunique()}\n")


def main() -> None:
    miner = DataMiner()
    miner.mine()


if __name__ == "__main__":
    main()
