"""
Configuration centralisée du projet PoliGraph Data Analysis
"""

from pathlib import Path
from typing import Final

# ===== CHEMINS =====
BASE: Final[Path] = Path(__file__).parent
DATA: Final[Path] = BASE / "data"
OUTPUT: Final[Path] = BASE / "output"
LOGS: Final[Path] = BASE / "logs"

# Créer les répertoires
for directory in [DATA, OUTPUT, LOGS]:
    directory.mkdir(exist_ok=True)

# ===== FICHIERS =====
RAW_CSV: Final[Path] = DATA / "raw.csv"
CLEANED_CSV: Final[Path] = DATA / "cleaned.csv"
CLEANED_JSON: Final[Path] = DATA / "cleaned.json"

# ===== API =====
API_URL: Final[str] = "https://poligraph.fr/api/politiques"
API_LIMIT: Final[int] = 100
API_TIMEOUT: Final[int] = 30
MAX_RETRIES: Final[int] = 3

# ===== VISUALISATIONS =====
CHART_1: Final[Path] = OUTPUT / "01_exploration.png"
CHART_2: Final[Path] = OUTPUT / "02_mining.png"
CHART_3: Final[Path] = OUTPUT / "03_detailed.png"

# ===== RAPPORTS =====
REPORT_EXPLORATION: Final[Path] = OUTPUT / "exploration.txt"
REPORT_MINING: Final[Path] = OUTPUT / "mining.txt"
LOG_FILE: Final[Path] = LOGS / "pipeline.log"

# ===== PARAMÈTRES =====
CHART_DPI: Final[int] = 300
CHART_SIZE: Final[tuple] = (15, 10)
MISSING_PLACEHOLDER: Final[str] = "Non spécifié"