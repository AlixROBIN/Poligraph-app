"""Configuration centralisée du logging"""

import logging
import logging.handlers
from config import LOG_FILE

def setup_logger(name: str) -> logging.Logger:
    """
    Configure un logger avec fichier et console.
    
    Args:
        name: Nom du logger (généralement __name__)
        
    Returns:
        logging.Logger: Logger configuré
    """
    logger = logging.getLogger(name)
    
    # Éviter les logs dupliqués
    if logger.handlers:
        return logger
    
    logger.setLevel(logging.DEBUG)
    
    # Format
    fmt = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Handler fichier
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_FILE, maxBytes=10_000_000, backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)
    
    # Handler console
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(fmt)
    logger.addHandler(console_handler)
    
    return logger