"""
API FastAPI pour servir la branche Analytics à ton frontend React
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd

from config import CLEANED_ANALYTICS_PARQUET
from logger_config import setup_logger

logger = setup_logger(__name__)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

df = None

@app.on_event("startup")
def load_data():
    global df
    logger.info(f"[API] Chargement données Analytics : {CLEANED_ANALYTICS_PARQUET}")
    df = pd.read_parquet(CLEANED_ANALYTICS_PARQUET)
    logger.info(f"[API] Données chargées : {len(df)} lignes")

@app.get("/api/health")
def health():
    return {"status": "ok", "rows": int(len(df)) if df is not None else 0}

@app.get("/api/data")
def api_data(limit: int = 100, offset: int = 0):
    result = df.iloc[offset : offset + limit]
    return {
        "total": int(len(df)),
        "limit": limit,
        "offset": offset,
        "data": result.to_dict(orient="records"),
    }

@app.get("/api/metrics")
def api_metrics():
    missing_pct = (df.isnull().sum().sum() / (len(df) * len(df.columns))) * 100
    return {
        "total_records": int(len(df)),
        "total_columns": int(len(df.columns)),
        "duplicates": int(df.duplicated().sum()),
        "missing_percent": round(missing_pct, 2),
    }

@app.get("/api/themes")
def api_themes():
    keywords = {
        "politique": ["parti", "groupe", "fonction", "mandat"],
        "judiciaire": ["affaire", "judiciaire", "proces", "condamnation"],
        "factcheck": ["fact", "check", "verite", "faux"],
        "transparence": ["transparence", "declaration", "patrimoine"],
    }
    result = {}
    for theme, ks in keywords.items():
        for col in df.columns:
            if any(k in col.lower() for k in ks):
                result[theme] = {
                    "column": col,
                    "unique": int(df[col].nunique()),
                    "missing": int(df[col].isnull().sum()),
                }
                break
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
