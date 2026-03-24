"""
Récupération des données depuis l'API PoliGraph
"""

import requests
import pandas as pd
from typing import List, Dict, Any
from pathlib import Path

from config import API_URL, API_LIMIT, API_TIMEOUT, MAX_RETRIES, RAW_CSV
from logger_config import setup_logger

logger = setup_logger(__name__)

class APIFetcher:
    """Récupère les données de l'API PoliGraph"""
    
    def __init__(self, url: str = API_URL, limit: int = API_LIMIT):
        """
        Initialise le fetcher.
        
        Args:
            url: URL de l'API
            limit: Limite par page
        """
        self.url = url
        self.limit = limit
        self.session = requests.Session()
    
    def fetch_all(self) -> List[Dict[str, Any]]:
        """
        Récupère toutes les données avec pagination.
        
        Returns:
            List[Dict]: Tous les enregistrements
            
        Raises:
            Exception: Si échec après MAX_RETRIES
        """
        logger.info("[*] Récupération des données...")
        all_data = []
        page = 1
        
        while True:
            try:
                page_data = self._fetch_page(page)
                
                if not page_data:
                    logger.info(f"[OK] Fin de pagination à la page {page}")
                    break
                
                all_data.extend(page_data)
                logger.info(f"  [OK] Page {page} : {len(page_data)} records "
                          f"(Total: {len(all_data)})")
                page += 1
                
            except Exception as e:
                logger.error(f"[ERROR] Erreur page {page} : {str(e)}")
                raise
        
        logger.info(f"[SUCCESS] Total : {len(all_data)} enregistrements\n")
        return all_data
    
    def _fetch_page(self, page: int) -> List[Dict[str, Any]]:
        """
        Récupère une page avec retry.
        
        Args:
            page: Numéro de page
            
        Returns:
            List[Dict]: Données de la page
        """
        params = {"page": page, "limit": self.limit}
        
        for attempt in range(MAX_RETRIES):
            try:
                response = self.session.get(
                    self.url, params=params, timeout=API_TIMEOUT
                )
                response.raise_for_status()
                return response.json()
                
            except requests.RequestException as e:
                if attempt < MAX_RETRIES - 1:
                    logger.warning(f"Tentative {attempt + 1}/{MAX_RETRIES} échouée")
                else:
                    logger.error(f"Échec après {MAX_RETRIES} tentatives")
                    raise

def save_raw(data: List[Dict[str, Any]], path: Path = RAW_CSV) -> pd.DataFrame:
    """
    Sauvegarde les données brutes.
    
    Args:
        data: Enregistrements
        path: Chemin de sauvegarde
        
    Returns:
        pd.DataFrame: DataFrame créé
    """
    logger.info("[*] Sauvegarde données brutes...")
    df = pd.DataFrame(data)
    df.to_csv(path, index=False, encoding='utf-8-sig')
    logger.info(f"[OK] CSV : {path}\n")
    return df

def main() -> None:
    """Exécute la récupération"""
    fetcher = APIFetcher()
    data = fetcher.fetch_all()
    save_raw(data)

if __name__ == "__main__":
    main()