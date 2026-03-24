"""
PoliGraph Data Analysis - Pipeline Principal
"""

import sys
from logger_config import setup_logger

logger = setup_logger(__name__)

STEPS = [
    ("1 - Recuperation", "fetching"),
    ("2 - Exploration", "exploration"),
    ("3 - Nettoyage", "cleaning"),
    ("4 - Data Mining", "mining"),
]

def run_pipeline() -> bool:
    """
    Exécute le pipeline complet.
    
    Returns:
        bool: Succès ou non
    """
    logger.info("\n" + "=" * 80)
    logger.info("[PIPELINE] POLIGRAPH DATA ANALYSIS")
    logger.info("=" * 80 + "\n")
    
    for step_name, module_name in STEPS:
        logger.info(f"ETAPE {step_name}")
        logger.info("-" * 80)
        
        try:
            module = __import__(module_name)
            module.main()
            logger.info(f"[SUCCESS] {step_name} completee\n")
            
        except ImportError as e:
            logger.error(f"[ERROR] Module non trouve : {module_name}")
            return False
            
        except Exception as e:
            logger.error(f"[ERROR] Erreur {step_name} : {str(e)}")
            logger.exception("Stack trace :")
            return False
    
    logger.info("=" * 80)
    logger.info("[SUCCESS] PIPELINE COMPLETE !")
    logger.info("=" * 80 + "\n")
    
    return True

if __name__ == "__main__":
    success = run_pipeline()
    sys.exit(0 if success else 1)