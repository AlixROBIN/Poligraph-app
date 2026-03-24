"""
PoliGraph Data Analysis - Pipeline Principal
Branche Analytics + branche ML diamant
"""

import sys
from logger_config import setup_logger

logger = setup_logger(__name__)

STEPS = [
    ("1 - Récupération", "fetching"),
    ("2 - Exploration (RAW)", "exploration"),
    ("3 - Nettoyage Analytics", "cleaning_analytics"),
    ("4 - Data Mining (Analytics)", "mining"),
    ("5 - Nettoyage ML Diamant", "cleaning_ml"),
]

def run_pipeline() -> bool:
    logger.info("\n" + "=" * 80)
    logger.info("[PIPELINE] POLIGRAPH DATA ANALYSIS")
    logger.info("=" * 80 + "\n")

    for step_name, module_name in STEPS:
        logger.info(f"ETAPE {step_name}")
        logger.info("-" * 80)

        try:
            module = __import__(module_name)
            module.main()
            logger.info(f"[SUCCESS] {step_name} complétée\n")

        except ImportError:
            logger.error(f"[ERROR] Module non trouvé : {module_name}")
            return False

        except Exception as e:
            logger.error(f"[ERROR] Erreur {step_name} : {str(e)}")
            logger.exception("Stack trace :")
            return False

    logger.info("=" * 80)
    logger.info("[SUCCESS] PIPELINE COMPLET (Analytics + ML) !")
    logger.info("=" * 80 + "\n")
    return True

if __name__ == "__main__":
    success = run_pipeline()
    sys.exit(0 if success else 1)
