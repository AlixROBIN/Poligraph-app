"""
Data Mining et Analyse des données
"""

import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path
from typing import Dict

from config import CLEANED_CSV, CHART_2, REPORT_MINING, CHART_DPI, CHART_SIZE
from logger_config import setup_logger

logger = setup_logger(__name__)

class DataMiner:
    """Analyse les données"""
    
    def __init__(self, path: Path = CLEANED_CSV):
        """
        Initialise le mining.
        
        Args:
            path: Fichier nettoyé
        """
        logger.info(f"[FILE] Chargement : {path}")
        self.df = pd.read_csv(path)
        self.themes = {}
    
    def mine(self) -> Dict:
        """
        Mining complet.
        
        Returns:
            Dict: Résultats
        """
        logger.info("\n[*] Data Mining & Analyse...\n")
        
        # Détecter thèmes
        self._detect_themes()
        
        # Analyser
        self._analyze()
        
        # Graphiques
        self._generate_charts()
        
        # Rapport
        self._save_report()
        
        logger.info("[SUCCESS] Mining complete\n")
        return self.themes
    
    def _detect_themes(self) -> None:
        """Détecte les thèmes PoliGraph"""
        logger.info("[*] Detection des themes...\n")
        
        keywords = {
            'politique': ['parti', 'groupe', 'fonction', 'mandat'],
            'judiciaire': ['affaire', 'judiciaire', 'proces', 'condamnation'],
            'factcheck': ['fact', 'check', 'verite', 'faux', 'mensonge'],
            'transparence': ['transparence', 'declaration', 'patrimoine', 'conflit']
        }
        
        for theme, kwords in keywords.items():
            for col in self.df.columns:
                if any(k in col.lower() for k in kwords):
                    self.themes[theme] = col
                    logger.info(f"[OK] {theme} -> {col}")
                    break
    
    def _analyze(self) -> None:
        """Analyse les thèmes"""
        logger.info("\n[STATS] Statistiques :")
        logger.info(f"  - Total : {len(self.df)}")
        logger.info(f"  - Colonnes : {len(self.df.columns)}")
        
        # Analyse par thème
        for theme, col in self.themes.items():
            logger.info(f"\n{theme.upper()} ({col}) :")
            logger.info(f"  - Uniques : {self.df[col].nunique()}")
            top = self.df[col].value_counts().head(5)
            for val, cnt in top.items():
                logger.info(f"    {val}: {cnt}")
    
    def _generate_charts(self) -> None:
        """Génère graphiques"""
        logger.info("\n[*] Generation graphiques...")
        
        fig, axes = plt.subplots(2, 2, figsize=CHART_SIZE)
        fig.suptitle('Data Mining - PoliGraph', fontsize=16, fontweight='bold')
        
        idx = 0
        for theme, col in self.themes.items():
            if idx >= 4:
                break
            ax = axes.flat[idx]
            
            top = self.df[col].value_counts().head(10)
            ax.barh(range(len(top)), top.values)
            ax.set_yticks(range(len(top)))
            ax.set_yticklabels(top.index, fontsize=8)
            ax.set_title(f'{theme.upper()}')
            ax.invert_yaxis()
            
            idx += 1
        
        # Masquer graphiques vides
        for i in range(idx, 4):
            axes.flat[i].axis('off')
        
        plt.tight_layout()
        plt.savefig(CHART_2, dpi=CHART_DPI, bbox_inches='tight')
        logger.info(f"[OK] Chart : {CHART_2}")
        plt.close()
    
    def _save_report(self) -> None:
        """Sauvegarde rapport"""
        with open(REPORT_MINING, 'w', encoding='utf-8') as f:
            f.write("DATA MINING - POLIGRAPH API\n")
            f.write("=" * 50 + "\n\n")
            f.write(f"Records: {len(self.df)}\n")
            f.write(f"Colonnes: {len(self.df.columns)}\n\n")
            f.write("THEMES DETECTES:\n")
            for theme, col in self.themes.items():
                f.write(f"\n{theme}:\n")
                f.write(f"  Colonne: {col}\n")
                f.write(f"  Uniques: {self.df[col].nunique()}\n")

def main() -> None:
    """Exécute le mining"""
    miner = DataMiner()
    miner.mine()

if __name__ == "__main__":
    main()