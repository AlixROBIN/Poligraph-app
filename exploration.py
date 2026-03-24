"""
Exploration et analyse descriptive des données brutes
"""

import pandas as pd
import matplotlib.pyplot as plt
from typing import Dict, Any

from config import RAW_CSV, CHART_1, REPORT_EXPLORATION, CHART_DPI, CHART_SIZE
from logger_config import setup_logger

logger = setup_logger(__name__)

class DataExplorer:
    """Explore les données brutes"""

    def __init__(self, path=RAW_CSV):
        logger.info(f"[FILE] Chargement : {path}")
        self.df = pd.read_csv(path)

    def explore(self) -> Dict[str, Any]:
        logger.info("[*] Exploration des données...\n")

        self._print_info()
        analysis = self._analyze_columns()
        self._generate_charts()
        self._save_report(analysis)

        logger.info("[SUCCESS] Exploration complétée\n")
        return analysis

    def _print_info(self) -> None:
        logger.info(f"[STATS] Dimensions : {self.df.shape}")
        logger.info(f"[STATS] Colonnes : {list(self.df.columns)}")

        missing = self.df.isnull().sum()
        total_missing = int(missing.sum())
        if total_missing > 0:
            logger.info(f"[STATS] Valeurs manquantes totales : {total_missing}")
            top_missing = missing[missing > 0].sort_values(ascending=False).head(10)
            for col, cnt in top_missing.items():
                logger.info(f"   - {col}: {cnt}")

    def _analyze_columns(self) -> Dict[str, Dict[str, Any]]:
        analysis: Dict[str, Dict[str, Any]] = {}
        logger.info("\n[*] Détail colonnes :")

        for col in self.df.columns:
            analysis[col] = {
                "type": str(self.df[col].dtype),
                "unique": int(self.df[col].nunique()),
                "missing": int(self.df[col].isnull().sum()),
            }

            logger.info(f"\n  [COL] {col}")
            logger.info(f"     Type : {analysis[col]['type']}")
            logger.info(f"     Uniques : {analysis[col]['unique']}")

        return analysis

    def _generate_charts(self) -> None:
        logger.info("\n[*] Génération graphiques...")

        fig, axes = plt.subplots(2, 2, figsize=CHART_SIZE)
        fig.suptitle(
            "Exploration des Données - PoliGraph",
            fontsize=16,
            fontweight="bold",
        )

        missing = self.df.isnull().sum()
        axes[0, 0].barh(range(len(missing)), missing.values, color="coral")
        axes[0, 0].set_yticks(range(len(missing)))
        axes[0, 0].set_yticklabels(missing.index)
        axes[0, 0].set_title("Valeurs manquantes")

        dtype_counts = self.df.dtypes.value_counts()
        axes[0, 1].pie(
            dtype_counts.values,
            labels=dtype_counts.index,
            autopct="%1.1f%%",
        )
        axes[0, 1].set_title("Types de données")

        card = self.df.nunique()
        axes[1, 0].barh(range(len(card)), card.values, color="lightgreen")
        axes[1, 0].set_yticks(range(len(card)))
        axes[1, 0].set_yticklabels(card.index)
        axes[1, 0].set_title("Cardinalité")

        axes[1, 1].axis("off")

        plt.tight_layout()
        plt.savefig(CHART_1, dpi=CHART_DPI, bbox_inches="tight")
        logger.info(f"[OK] Chart : {CHART_1}")
        plt.close()

    def _save_report(self, analysis: Dict[str, Any]) -> None:
        with open(REPORT_EXPLORATION, "w", encoding="utf-8") as f:
            f.write("EXPLORATION - POLIGRAPH API\n")
            f.write("=" * 50 + "\n\n")
            f.write(f"Records: {len(self.df)}\n")
            f.write(f"Colonnes: {len(self.df.columns)}\n\n")
            f.write("COLONNES:\n")
            for col, info in analysis.items():
                f.write(f"\n{col}:\n")
                f.write(f"  Type: {info['type']}\n")
                f.write(f"  Uniques: {info['unique']}\n")
                f.write(f"  Manquants: {info['missing']}\n")

def main() -> None:
    explorer = DataExplorer()
    explorer.explore()

if __name__ == "__main__":
    main()
