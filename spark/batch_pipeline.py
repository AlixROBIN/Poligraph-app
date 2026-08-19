"""
spark/batch_pipeline.py — PySpark batch : remplace pipeline/preprocess.py

Transforme cleaned_analytics.csv en 3 datasets Parquet + CSV :
  - scandales_features  (ML catégorie/parti/élu)
  - votes_features      (ML résultat vote)
  - elus_features       (référentiel élus)

Usage :
  # Local (JAVA_HOME requis)
  python spark/batch_pipeline.py

  # Spark cluster
  spark-submit --master spark://master:7077 spark/batch_pipeline.py

  # Via pipeline.py
  python pipeline.py --engine spark
"""

import os
import shutil
import sys
from pathlib import Path

# Windows : fixes avant tout import PySpark
if os.name == "nt":
    # 1. Hadoop binaries
    _hadoop_dir = Path(__file__).parent.parent / "hadoop"
    if _hadoop_dir.exists() and "HADOOP_HOME" not in os.environ:
        os.environ["HADOOP_HOME"] = str(_hadoop_dir)
        os.environ["hadoop.home.dir"] = str(_hadoop_dir)
    # 2. Python worker : pointe vers le vrai python (évite la redirection Microsoft Store)
    os.environ["PYSPARK_PYTHON"] = sys.executable
    os.environ["PYSPARK_DRIVER_PYTHON"] = sys.executable
    # 3. UTF-8 partout (évite UnicodeEncodeError sur les caractères non-ASCII)
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, IntegerType

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
OUT_DIR  = ROOT / "output" / "analytics"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SPARK_MASTER = os.getenv("SPARK_MASTER", "local[*]")


# ── Session ──────────────────────────────────────────────────────────────────

def get_spark() -> SparkSession:
    return (
        SparkSession.builder
        .appName("MonAppPolitique-Batch")
        .master(SPARK_MASTER)
        .config("spark.sql.adaptive.enabled", "true")
        .config("spark.sql.shuffle.partitions", "8")
        .config("spark.ui.showConsoleProgress", "false")
        .config("spark.sql.ansi.enabled", "false")
        .getOrCreate()
    )


# ── Helpers natifs Spark SQL (aucun Python worker) ────────────────────────────

def _dict_field(col_expr, key: str):
    """Extrait 'key': 'value' d'une chaîne repr-dict Python."""
    pattern = f"'{key}':\\s*'([^']*)'"
    extracted = F.regexp_extract(col_expr, pattern, 1)
    return F.when(extracted != "", extracted).otherwise(F.lit("Non spécifié"))


def _parse_year(col_expr):
    year_str = F.regexp_extract(col_expr, r"(\d{4})", 1)
    return F.when(year_str != "", year_str.cast(DoubleType())).otherwise(F.lit(None).cast(DoubleType()))


def _days_between(start_expr, end_expr):
    date_pattern = r"^\d{4}-\d{2}-\d{2}"
    s = F.when(F.regexp_extract(start_expr, date_pattern, 0) != "", F.to_date(start_expr, "yyyy-MM-dd"))
    e = F.when(F.regexp_extract(end_expr,   date_pattern, 0) != "", F.to_date(end_expr,   "yyyy-MM-dd"))
    return F.datediff(e, s).cast(DoubleType())


# ── Datasets ─────────────────────────────────────────────────────────────────

def build_scandales(df: DataFrame) -> DataFrame:
    print("  [Spark] Construction scandales ...")
    sc = (
        df
        .filter(F.col("category").isNotNull() & (F.col("category") != "Non spécifié"))
        .dropDuplicates(["id"])
        .withColumn("politician_id",      _dict_field(F.col("politician"), "id"))
        .withColumn("politician_name",    _dict_field(F.col("politician"), "fullName"))
        .withColumn("politician_slug",    _dict_field(F.col("politician"), "slug"))
        .withColumn("party_short",        _dict_field(F.col("partyAtTime"), "shortName"))
        .withColumn("party_name",         _dict_field(F.col("partyAtTime"), "name"))
        .withColumn("annee_faits",        _parse_year(F.col("factsDate")))
        .withColumn("annee_verdict",      _parse_year(F.col("verdictDate")))
        .withColumn("duree_procedure",    _days_between(F.col("startDate"), F.col("verdictDate")))
        .withColumn("position_politique", F.coalesce(F.col("politicalPosition"), F.lit("Non spécifié")))
    )
    keep = [
        "id", "slug", "title", "description",
        "status", "category",
        "factsDate", "startDate", "verdictDate",
        "annee_faits", "annee_verdict", "duree_procedure",
        "sentence", "appeal",
        "politician_id", "politician_name", "politician_slug",
        "party_short", "party_name", "position_politique",
        "institution", "departmentCode", "constituency",
    ]
    return sc.select([c for c in keep if c in sc.columns])


def build_votes(df: DataFrame) -> DataFrame:
    print("  [Spark] Construction votes ...")
    vt = (
        df
        .filter(
            F.col("externalId").isNotNull() &
            (F.col("externalId") != "Non spécifié") &
            F.col("result").isNotNull() &
            (F.col("result") != "Non spécifié")
        )
        .dropDuplicates(["externalId"])
        .withColumn("votesFor",        F.col("votesFor").cast(DoubleType()))
        .withColumn("votesAgainst",    F.col("votesAgainst").cast(DoubleType()))
        .withColumn("votesAbstain",    F.col("votesAbstain").cast(DoubleType()))
        .withColumn("totalVotes",      F.col("totalVotes").cast(DoubleType()))
        .withColumn("annee_vote",      _parse_year(F.col("votingDate")))
        .withColumn("taux_pour",       F.col("votesFor") / F.col("totalVotes"))
        .withColumn("taux_contre",     F.col("votesAgainst") / F.col("totalVotes"))
        .withColumn("taux_abstention", F.col("votesAbstain") / F.col("totalVotes"))
        .withColumn("marge",           F.col("votesFor") - F.col("votesAgainst"))
        .withColumn("result_bin",      (F.col("result") == "ADOPTED").cast(IntegerType()))
    )
    keep = [
        "id", "externalId", "title",
        "votingDate", "annee_vote", "legislature",
        "votesFor", "votesAgainst", "votesAbstain", "totalVotes",
        "taux_pour", "taux_contre", "taux_abstention", "marge",
        "result", "result_bin", "sourceUrl",
    ]
    return vt.select([c for c in keep if c in vt.columns])


def build_elus(df: DataFrame) -> DataFrame:
    print("  [Spark] Construction elus ...")
    el = (
        df
        .filter(F.col("fullName").isNotNull() & (F.col("fullName") != "Non spécifié"))
        .dropDuplicates(["fullName"])
        .withColumn("party_short",        _dict_field(F.col("currentParty"), "shortName"))
        .withColumn("party_name",         _dict_field(F.col("currentParty"), "name"))
        .withColumn("position_politique", F.coalesce(F.col("politicalPosition"), F.lit("Non spécifié")))
        .withColumn("annee_naissance",    _parse_year(F.col("birthDate")))
        .withColumn("age_approx",         (F.lit(2025) - F.col("annee_naissance")).cast(IntegerType()))
    )
    keep = [
        "id", "slug", "fullName", "firstName", "lastName",
        "civility", "birthDate", "annee_naissance", "age_approx",
        "birthPlace", "photoUrl",
        "party_short", "party_name", "position_politique",
        "institution", "departmentCode", "constituency", "isCurrent",
    ]
    return el.select([c for c in keep if c in el.columns])


# ── I/O ───────────────────────────────────────────────────────────────────────

def write_dataset(df: DataFrame, name: str) -> int:
    """Collecte vers pandas puis ecrit Parquet + CSV via pyarrow (contourne le committer Hadoop Windows)."""
    parquet_path = OUT_DIR / f"{name}_features.parquet"
    csv_path     = OUT_DIR / f"{name}_features.csv"

    # Supprime les restes de runs précédents (répertoires Spark ou fichier)
    if parquet_path.exists():
        if parquet_path.is_dir():
            shutil.rmtree(parquet_path)
        else:
            parquet_path.unlink()

    pdf = df.toPandas()
    count = len(pdf)

    pdf.to_parquet(parquet_path, index=False, engine="pyarrow")
    pdf.to_csv(csv_path, index=False)

    print(f"  -> {name}: {count:,} lignes | parquet: {parquet_path}")
    return count


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    spark = get_spark()
    spark.sparkContext.setLogLevel("WARN")

    csv_path = str(DATA_DIR / "cleaned_analytics.csv")
    print(f"\n[Spark Batch] Lecture {csv_path} ...")

    df = spark.read.csv(
        csv_path,
        header=True,
        inferSchema=False,
        multiLine=True,
        escape='"',
    )
    print(f"  -> {df.count():,} lignes x {len(df.columns)} colonnes")

    sc_count = write_dataset(build_scandales(df), "scandales")
    vt_count = write_dataset(build_votes(df),     "votes")
    el_count = write_dataset(build_elus(df),      "elus")

    print(f"\n[Spark Batch] Termine")
    print(f"  scandales : {sc_count:,}")
    print(f"  votes     : {vt_count:,}")
    print(f"  elus      : {el_count:,}")

    spark.stop()


if __name__ == "__main__":
    main()
