"""
Exploration et analyse descriptive des données
"""

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from typing import Dict, Any

from config import RAW_CSV, CHART_1, REPORT_EXPLORATION, CHART_DPI, CHART_SIZE
from logger_config import setup_logger

logger = setup_logger(__name__)

class DataExplorer:
    """Explore les données"""
    
    def __init__(self, path: Path = RAW_CSV):
        """
        Initialise l'explorateur.
        
        Args:
            path: Fichier CSV à explorer
        """
        logger.info(f"[FILE] Chargement : {path}")
        self.df = pd.read_csv(path)
    
    def explore(self) -> Dict[str, Any]:
        """
        Exploration complète.
        
        Returns:
            Dict: Résultats d'analyse
        """
        logger.info("[*] Exploration des données...\n")
        
        # Infos générales
        self._print_info()
        
        # Analyse colonnes
        analysis = self._analyze_columns()
        
        # Visualisations
        self._generate_charts()
        
        # Rapport
        self._save_report(analysis)
        
        logger.info("[SUCCESS] Exploration complétée\n")
        return analysis
    
    def _print_info(self) -> None:
        """Affiche infos générales"""
        logger.info(f"[STATS] Dimensions : {self.df.shape}")
        logger.info(f"[STATS] Colonnes : {list(self.df.columns)}")
        
        missing = self.df.isnull().sum()
        if missing.sum() > 0:
            logger.info("[!] Valeurs manquantes :")
            for col, cnt in missing[missing > 0].items():
                logger.info(f"   {col}: {cnt}")
    
    def _analyze_columns(self) -> Dict[str, Dict[str, Any]]:
        """
        Analyse chaque colonne.
        
        Returns:
            Dict: Analyse par colonne
        """
        analysis = {}
        logger.info("\n[*] Détail colonnes :")
        
        for col in self.df.columns:
            analysis[col] = {
                'type': str(self.df[col].dtype),
                'unique': int(self.df[col].nunique()),
                'missing': int(self.df[col].isnull().sum()),
            }
            
            logger.info(f"\n  [COL] {col}")
            logger.info(f"     Type : {analysis[col]['type']}")
            logger.info(f"     Uniques : {analysis[col]['unique']}")
            
            if self.df[col].dtype == 'object':
                top = self.df[col].value_counts().head(3)
                for val, cnt in top.items():
                    logger.info(f"     - {val}: {cnt}")
            else:
                logger.info(f"     Min: {self.df[col].min()}, "
                          f"Max: {self.df[col].max()}, "
                          f"Avg: {self.df[col].mean():.2f}")
        
        return analysis
    
    def _generate_charts(self) -> None:
        """Génère les graphiques"""
        logger.info("\n[*] Génération graphiques...")
        
        fig, axes = plt.subplots(2, 2, figsize=CHART_SIZE)
        fig.suptitle('Exploration des Donnees - PoliGraph', fontsize=16, fontweight='bold')
        
        # Valeurs manquantes
        missing = self.df.isnull().sum()
        axes[0, 0].barh(range(len(missing)), missing.values, color='coral')
        axes[0, 0].set_yticks(range(len(missing)))
        axes[0, 0].set_yticklabels(missing.index)
        axes[0, 0].set_title('Valeurs manquantes')
        
        # Types de données
        dtype_counts = self.df.dtypes.value_counts()
        axes[0, 1].pie(dtype_counts.values, labels=dtype_counts.index, 
                      autopct='%1.1f%%')
        axes[0, 1].set_title('Types de donnees')
        
        # Cardinalité
        card = self.df.nunique()
        axes[1, 0].barh(range(len(card)), card.values, color='lightgreen')
        axes[1, 0].set_yticks(range(len(card)))
        axes[1, 0].set_yticklabels(card.index)
        axes[1, 0].set_title('Cardinalite')
        
        # Résumé
        axes[1, 1].axis('off')
        summary = f"Records: {len(self.df)}\nColonnes: {len(self.df.columns)}\nDoublons: {self.df.duplicated().sum()}"
        axes[1, 1].text(0.1, 0.5, summary, fontsize=10, family='monospace',
                       bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
        
        plt.tight_layout()
        plt.savefig(CHART_1, dpi=CHART_DPI, bbox_inches='tight')
        logger.info(f"[OK] Chart : {CHART_1}")
        plt.close()
    
    def _save_report(self, analysis: Dict) -> None:
        """Sauvegarde rapport"""
        with open(REPORT_EXPLORATION, 'w', encoding='utf-8') as f:
            f.write("EXPLORATION - POLIGRAPH API\n")
            f.write("=" * 50 + "\n\n")
            f.write(f"Records: {len(self.df)}\n")
            f.write(f"Colonnes: {len(self.df.columns)}\n")
            f.write(f"Doublons: {self.df.duplicated().sum()}\n\n")
            f.write("COLONNES:\n")
            for col, info in analysis.items():
                f.write(f"\n{col}:\n")
                f.write(f"  Type: {info['type']}\n")
                f.write(f"  Uniques: {info['unique']}\n")
                f.write(f"  Manquants: {info['missing']}\n")

def main() -> None:
    """Exécute l'exploration"""
    explorer = DataExplorer()
    explorer.explore()

if __name__ == "__main__":
    main()