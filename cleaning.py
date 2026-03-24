"""
Nettoyage et préparation des données
"""

import pandas as pd
from pathlib import Path
from typing import Dict

from config import RAW_CSV, CLEANED_CSV, CLEANED_JSON, MISSING_PLACEHOLDER
from logger_config import setup_logger

logger = setup_logger(__name__)

class DataCleaner:
    """Nettoie les données"""
    
    def __init__(self, path: Path = RAW_CSV):
        """
        Initialise le nettoyeur.
        
        Args:
            path: Fichier CSV à nettoyer
        """
        logger.info(f"[FILE] Chargement : {path}")
        self.df = pd.read_csv(path)
        self.stats = {}
    
    def clean(self) -> pd.DataFrame:
        """
        Nettoyage complet.
        
        Returns:
            pd.DataFrame: DataFrame nettoyé
        """
        logger.info("[*] Nettoyage des donnees...\n")
        logger.info(f"Avant : {self.df.shape}")
        
        self._remove_duplicates()
        self._fill_missing()
        self._standardize_text()
        
        logger.info(f"Apres : {self.df.shape}\n")
        logger.info("[SUCCESS] Nettoyage complete\n")
        
        return self.df
    
    def _remove_duplicates(self) -> None:
        """Supprime doublons"""
        before = len(self.df)
        self.df.drop_duplicates(inplace=True)
        removed = before - len(self.df)
        
        self.stats['duplicates'] = removed
        logger.info(f"[OK] Doublons supprimes : {removed}")
    
    def _fill_missing(self) -> None:
        """Remplit valeurs manquantes"""
        before = self.df.isnull().sum().sum()
        self.df.fillna(MISSING_PLACEHOLDER, inplace=True)
        
        self.stats['missing'] = before
        logger.info(f"[OK] Valeurs manquantes remplies : {before}")
    
    def _standardize_text(self) -> None:
        """Standardise text"""
        cols = self.df.select_dtypes(include=['object']).columns
        
        for col in cols:
            self.df[col] = self.df[col].astype(str).str.strip().str.lower()
        
        logger.info(f"[OK] Texte standardise : {len(cols)} colonnes")
    
    def save(self, csv: Path = CLEANED_CSV, json: Path = CLEANED_JSON) -> None:
        """
        Sauvegarde les données.
        
        Args:
            csv: Chemin CSV
            json: Chemin JSON
        """
        logger.info("[*] Sauvegarde donnees nettoyees...")
        
        self.df.to_csv(csv, index=False, encoding='utf-8-sig')
        logger.info(f"[OK] CSV : {csv}")
        
        self.df.to_json(json, orient='records', force_ascii=False, indent=2)
        logger.info(f"[OK] JSON : {json}\n")

def main() -> None:
    """Exécute le nettoyage"""
    cleaner = DataCleaner()
    cleaner.clean()
    cleaner.save()

if __name__ == "__main__":
    main()