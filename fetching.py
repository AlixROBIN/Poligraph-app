"""
Fetching massif pour l'API PoliGraph :
- endpoints paginés : politiques, affaires, votes, partis, mandats, elections
- pagination robuste
- checkpoint par endpoint
- parallélisation
- sauvegarde incrémentale
"""

import json
import time
import requests
import pandas as pd
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import DATA, API_URL, API_LIMIT, API_TIMEOUT, MAX_RETRIES
from logger_config import setup_logger

logger = setup_logger(__name__)

PARTIAL_DIR = DATA / "partial_fetch"
PARTIAL_DIR.mkdir(exist_ok=True)

CHECKPOINT_DIR = DATA / "checkpoints"
CHECKPOINT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------
# 1. ENDPOINTS PAGINÉS
# ---------------------------------------------------------

ENDPOINTS = [
    "politiques",
    "affaires",
    "votes",
    "partis",
    "mandats",
    "elections"
]


# ---------------------------------------------------------
# 2. CHECKPOINT PAR ENDPOINT
# ---------------------------------------------------------

def checkpoint_file(endpoint):
    return CHECKPOINT_DIR / f"{endpoint}_checkpoint.json"


def load_checkpoint(endpoint):
    f = checkpoint_file(endpoint)
    if f.exists():
        try:
            with open(f, "r", encoding="utf-8") as fp:
                cp = json.load(fp)
                if "page" in cp:
                    return cp
        except:
            pass
    return {"page": 1}


def save_checkpoint(endpoint, page):
    with open(checkpoint_file(endpoint), "w", encoding="utf-8") as fp:
        json.dump({"page": page}, fp, indent=2)


# ---------------------------------------------------------
# 3. FETCH D’UNE PAGE
# ---------------------------------------------------------

def fetch_page(endpoint, page):
    params = {"page": page, "limit": API_LIMIT}

    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(f"{API_URL}/{endpoint}", params=params, timeout=API_TIMEOUT)
            r.raise_for_status()
            data = r.json()

            if isinstance(data, dict) and "data" in data:
                return data["data"]

            logger.warning(f"[WARN] Réponse inattendue : {data}")
            return []

        except Exception as e:
            logger.warning(f"[WARN] Tentative {attempt+1}/{MAX_RETRIES} échouée : {e}")
            time.sleep(1)

    logger.error(f"[ERROR] Impossible de fetch {endpoint} page {page}")
    return []


# ---------------------------------------------------------
# 4. FETCH COMPLET D’UN ENDPOINT
# ---------------------------------------------------------

def fetch_endpoint(endpoint):
    logger.info(f"\n=== FETCH ENDPOINT : {endpoint} ===")

    cp = load_checkpoint(endpoint)
    page = cp["page"]

    all_rows = []
    partial_file = PARTIAL_DIR / f"{endpoint}.csv"

    # Reprise si fichier partiel existe
    if partial_file.exists():
        logger.info(f"[INFO] Reprise du fichier {partial_file}")
        all_rows = pd.read_csv(partial_file).to_dict(orient="records")

    while True:
        rows = fetch_page(endpoint, page)
        if not rows:
            break

        all_rows.extend(rows)

        # Sauvegarde incrémentale
        pd.DataFrame(all_rows).to_csv(partial_file, index=False, encoding="utf-8-sig")

        save_checkpoint(endpoint, page)
        page += 1

    logger.info(f"[OK] Terminé : {endpoint} ({len(all_rows)} lignes)")
    return all_rows


# ---------------------------------------------------------
# 5. FETCH GLOBAL PARALLÉLISÉ
# ---------------------------------------------------------

def fetch_all_parallel():
    with ThreadPoolExecutor(max_workers=len(ENDPOINTS)) as executor:
        futures = [executor.submit(fetch_endpoint, ep) for ep in ENDPOINTS]

        for f in as_completed(futures):
            f.result()


# ---------------------------------------------------------
# 6. MAIN
# ---------------------------------------------------------

def main():
    logger.info("\n=== FETCHING MASSIF MULTI-ENDPOINTS ===\n")
    fetch_all_parallel()
    logger.info("\n=== FIN DU FETCHING ===\n")


if __name__ == "__main__":
    main()
