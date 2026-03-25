"""
Exploration avancée des données Analytics enrichies
- Analyse temporelle
- Analyse par domaine / parti / institution
- Corrélations
- Rapport global
"""

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

from config import (
    CLEANED_ANALYTICS_CSV,
    OUTPUT,
    CHART_DPI,
    CHART_SIZE,
    REPORT_EXPLORATION,
)
from logger_config import setup_logger

logger = setup_logger(__name__)

CHART_SCANDALES_PAR_AN = OUTPUT / "scandales_par_an.png"
CHART_SCANDALES_PAR_DOMAINE = OUTPUT / "scandales_par_domaine.png"
CHART_SCANDALES_PAR_PARTI = OUTPUT / "scandales_par_parti.png"
CHART_SCANDALES_PAR_INSTITUTION = OUTPUT / "scandales_par_institution.png"
CHART_HEATMAP = OUTPUT / "correlation_heatmap.png"


class DataExplorer:
    """Exploration avancée des données Analytics enrichies"""

    def __init__(self, path=CLEANED_ANALYTICS_CSV):
        logger.info(f"[FILE] Chargement Analytics enrichi : {path}")
        self.df = pd.read_csv(path)

    def explore(self):
        logger.info("[*] Exploration avancée...")

        self._scandales_par_an()
        self._scandales_par_domaine()
        self._scandales_par_parti()
        self._scandales_par_institution()
        self._heatmap_correlations()
        self._save_report()

        logger.info("[SUCCESS] Exploration complétée\n")

    # -----------------------------
    # ANALYSES
    # -----------------------------

    def _scandales_par_an(self):
        logger.info("[*] Scandales par année...")
        if "year" not in self.df.columns:
            return

        counts = self.df["year"].value_counts().sort_index()

        plt.figure(figsize=CHART_SIZE)
        counts.plot(kind="bar", color="steelblue")
        plt.title("Nombre de scandales par année")
        plt.xlabel("Année")
        plt.ylabel("Nombre de scandales")
        plt.tight_layout()
        plt.savefig(CHART_SCANDALES_PAR_AN, dpi=CHART_DPI)
        plt.close()

    def _scandales_par_domaine(self):
        if "category" not in self.df.columns:
            return

        logger.info("[*] Scandales par domaine...")
        counts = (
            self.df[self.df["category"] != "Non spécifié"]["category"]
            .value_counts()
            .head(20)
        )

        plt.figure(figsize=CHART_SIZE)
        counts.plot(kind="barh", color="coral")
        plt.title("Top domaines de scandales")
        plt.xlabel("Nombre")
        plt.tight_layout()
        plt.savefig(CHART_SCANDALES_PAR_DOMAINE, dpi=CHART_DPI)
        plt.close()

    def _scandales_par_parti(self):
        if "party_short" not in self.df.columns:
            return

        logger.info("[*] Scandales par parti politique...")
        counts = (
            self.df[self.df["party_short"].notna()]["party_short"]
            .value_counts()
            .head(20)
        )

        plt.figure(figsize=CHART_SIZE)
        counts.plot(kind="barh", color="purple")
        plt.title("Top partis impliqués dans des scandales")
        plt.xlabel("Nombre")
        plt.tight_layout()
        plt.savefig(CHART_SCANDALES_PAR_PARTI, dpi=CHART_DPI)
        plt.close()

    def _scandales_par_institution(self):
        if "institution_clean" not in self.df.columns:
            return

        logger.info("[*] Scandales par institution...")
        counts = (
            self.df[self.df["institution_clean"].notna()]["institution_clean"]
            .value_counts()
            .head(20)
        )

        plt.figure(figsize=CHART_SIZE)
        counts.plot(kind="barh", color="green")
        plt.title("Top institutions impliquées")
        plt.xlabel("Nombre")
        plt.tight_layout()
        plt.savefig(CHART_SCANDALES_PAR_INSTITUTION, dpi=CHART_DPI)
        plt.close()

    def _heatmap_correlations(self):
        logger.info("[*] Heatmap des corrélations...")
        numeric = self.df.select_dtypes(include=["number"])

        if numeric.empty:
            logger.info("[WARN] Aucune colonne numérique pour corrélation")
            return

        plt.figure(figsize=(12, 10))
        sns.heatmap(numeric.corr(), cmap="coolwarm", center=0)
        plt.title("Corrélations entre variables numériques")
        plt.tight_layout()
        plt.savefig(CHART_HEATMAP, dpi=CHART_DPI)
        plt.close()

    # -----------------------------
    # RAPPORT
    # -----------------------------

    def _save_report(self):
        logger.info("[*] Rapport exploration...")

        with open(REPORT_EXPLORATION, "w", encoding="utf-8") as f:
            f.write("EXPLORATION ANALYTICS ENRICHIES\n")
            f.write("=" * 50 + "\n\n")

            f.write(f"Records: {len(self.df)}\n")
            f.write(f"Colonnes: {len(self.df.columns)}\n\n")

            if "category" in self.df.columns:
                f.write("\nTop domaines :\n")
                f.write(str(self.df["category"].value_counts().head(20)))
                f.write("\n\n")

            if "party_short" in self.df.columns:
                f.write("\nTop partis :\n")
                f.write(str(self.df["party_short"].value_counts().head(20)))
                f.write("\n\n")

            if "institution_clean" in self.df.columns:
                f.write("\nTop institutions :\n")
                f.write(str(self.df["institution_clean"].value_counts().head(20)))
                f.write("\n\n")


def main():
    explorer = DataExplorer()
    explorer.explore()


if __name__ == "__main__":
    main()
