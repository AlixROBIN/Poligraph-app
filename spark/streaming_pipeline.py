"""
spark/streaming_pipeline.py — Spark Structured Streaming

Kafka "raw-articles"  →  nettoyage + sentiment + NER  →  Kafka "features"

Usage :
  spark-submit \\
    --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1 \\
    --master local[2] \\
    spark/streaming_pipeline.py

  # Depuis docker-compose ou K8s : variable KAFKA_BOOTSTRAP_SERVERS injectée
"""

import os
import re
from typing import List, Dict

import pandas as pd
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.functions import pandas_udf
from pyspark.sql.types import (
    ArrayType,
    DoubleType,
    StringType,
    StructField,
    StructType,
)

_SENTIMENT_SCHEMA = StructType([
    StructField("label", StringType()),
    StructField("score", DoubleType()),
])

KAFKA_SERVERS   = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
INPUT_TOPIC     = "raw-articles"
OUTPUT_TOPIC    = "features"
CHECKPOINT_DIR  = os.getenv("SPARK_CHECKPOINT", "/tmp/poligraph-checkpoint")

# ── Schéma JSON entrant (produit par streaming/producer.py) ──────────────────

RAW_SCHEMA = StructType([
    StructField("id",           StringType(), True),
    StructField("title",        StringType(), True),
    StructField("description",  StringType(), True),
    StructField("source",       StringType(), True),
    StructField("url",          StringType(), True),
    StructField("published_at", StringType(), True),
    StructField("raw_text",     StringType(), True),
    StructField("scraped_at",   StringType(), True),
])


# ── UDFs ─────────────────────────────────────────────────────────────────────

@F.udf(StringType())
def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)       # strip HTML
    text = re.sub(r"http\S+", " ", text)        # remove URLs
    text = re.sub(r"\s+", " ", text).strip()
    return text[:2000]


SENTIMENT_MODEL = os.getenv(
    "SENTIMENT_MODEL",
    "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
)

_POS = {"positive", "pos", "label_2", "5_stars", "4_stars"}
_NEG = {"negative", "neg", "label_0", "1_star",  "2_stars"}


def _norm_label(label: str) -> str:
    l = label.lower()
    if l in _POS: return "POSITIVE"
    if l in _NEG: return "NEGATIVE"
    return "NEUTRAL"


def _signed(label: str, score: float) -> float:
    l = label.lower()
    if l in _POS: return score
    if l in _NEG: return -score
    return 0.0


# pandas_udf : Spark envoie des batches → modèle chargé une seule fois par worker
@pandas_udf(_SENTIMENT_SCHEMA)
def sentiment_udf(texts: pd.Series) -> pd.DataFrame:
    """Retourne label normalisé + score signé en une seule passe."""
    try:
        from transformers import pipeline as hf_pipeline

        if not hasattr(sentiment_udf, "_clf"):
            sentiment_udf._clf = hf_pipeline(
                "text-classification",
                model=SENTIMENT_MODEL,
                tokenizer=SENTIMENT_MODEL,
                batch_size=16,
                truncation=True,
                max_length=512,
                device=-1,   # CPU ; passer device=0 si GPU disponible
            )
        results = sentiment_udf._clf(texts.fillna("").tolist())
        labels = [_norm_label(r["label"]) for r in results]
        scores = [_signed(r["label"], r["score"]) for r in results]
        return pd.DataFrame({"label": labels, "score": scores})
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f"Modèle sentiment indisponible : {exc}")
        n = len(texts)
        return pd.DataFrame({"label": ["UNKNOWN"] * n, "score": [0.0] * n})


# Personnalités et partis à détecter
_POLITICIANS = [
    "Macron", "Le Pen", "Mélenchon", "Bardella", "Weil",
    "Attal", "Philippe", "Hollande", "Sarkozy", "Bayrou",
    "Faure", "Roussel", "Jadot", "Hidalgo", "Pécresse",
    "Zemmour", "Ciotti", "Retailleau", "Darmanin", "Dupond-Moretti",
    "Borne", "Castets", "Glucksmann", "Tondelier", "Ruffin",
]
_PARTIES = [
    "RN", "LFI", "PS", "LR", "LREM", "Renaissance", "En Marche",
    "Écologistes", "PCF", "Reconquête", "MoDem", "Horizons", "NFP",
]
_ENTITY_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, _POLITICIANS + _PARTIES)) + r")\b",
    re.IGNORECASE,
)

_STOP_FR = {
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en",
    "à", "au", "aux", "il", "elle", "que", "qui", "se", "sa", "son",
    "sur", "par", "pour", "dans", "avec", "pas", "plus", "est", "sont",
    "ont", "été", "cette", "ces", "leur", "leurs", "nous", "vous", "ils",
}


@F.udf(ArrayType(StringType()))
def extract_entities(title: str, body: str) -> List[str]:
    text  = f"{title or ''} {body or ''}"
    found = {m.group() for m in _ENTITY_PATTERN.finditer(text)}
    return sorted(found)[:10]


@F.udf(ArrayType(StringType()))
def extract_keywords(text: str) -> List[str]:
    if not text:
        return []
    words = re.findall(r"\b[a-zA-ZÀ-ÿ]{4,}\b", text.lower())
    freq: Dict[str, int] = {}
    for w in words:
        if w not in _STOP_FR:
            freq[w] = freq.get(w, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda x: -x[1])[:8]]


# ── Pipeline ──────────────────────────────────────────────────────────────────

def build_spark() -> SparkSession:
    return (
        SparkSession.builder
        .appName("PoliGraph-Streaming")
        .config("spark.sql.streaming.checkpointLocation", CHECKPOINT_DIR)
        .config("spark.sql.ansi.enabled", "false")
        .config("spark.ui.showConsoleProgress", "false")
        .getOrCreate()
    )


def run():
    spark = build_spark()
    spark.sparkContext.setLogLevel("WARN")

    # ── 1. Lecture Kafka ──────────────────────────────────────────────────
    raw_stream = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_SERVERS)
        .option("subscribe", INPUT_TOPIC)
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .option("kafka.max.poll.records", "50")   # small batches → DistilBERT stays within memory
        .load()
    )

    # ── 2. Parsing JSON ───────────────────────────────────────────────────
    parsed = (
        raw_stream
        .select(F.from_json(F.col("value").cast("string"), RAW_SCHEMA).alias("d"))
        .select("d.*")
    )

    # ── 3. Transformations NLP ────────────────────────────────────────────
    body_col = F.concat_ws(" ", F.col("description"), F.col("raw_text"))

    features = (
        parsed
        .withColumn("title_clean",     clean_text(F.col("title")))
        .withColumn("body_clean",      clean_text(body_col))
        .withColumn("full_text",       F.concat_ws(" ", F.col("title_clean"), F.col("body_clean")))
        .withColumn("_sent",           sentiment_udf(F.col("full_text")))
        .withColumn("sentiment",       F.col("_sent.score"))
        .withColumn("sentiment_label", F.col("_sent.label"))
        .drop("_sent")
        .withColumn("entities",        extract_entities(F.col("title_clean"), F.col("body_clean")))
        .withColumn("keywords",        extract_keywords(F.col("full_text")))
        .withColumn("processed_at",    F.current_timestamp().cast("string"))
        .select(
            "id", "title_clean", "body_clean",
            "source", "url", "published_at",
            "sentiment", "sentiment_label",
            "entities", "keywords",
            "processed_at",
        )
    )

    # ── 4. Écriture Kafka ─────────────────────────────────────────────────
    kafka_output = features.select(
        F.col("id").alias("key"),
        F.to_json(F.struct(*features.columns)).alias("value"),
    )

    query = (
        kafka_output.writeStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_SERVERS)
        .option("topic", OUTPUT_TOPIC)
        .option("checkpointLocation", f"{CHECKPOINT_DIR}/kafka-sink")
        .outputMode("append")
        .trigger(processingTime="60 seconds")
        .start()
    )

    print(f"[Streaming] Actif → '{INPUT_TOPIC}' → '{OUTPUT_TOPIC}' (Kafka: {KAFKA_SERVERS})")
    query.awaitTermination()


if __name__ == "__main__":
    run()
