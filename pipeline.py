"""
pipeline.py — Orchestrateur principal
Lance tout dans l'ordre : preprocess → vectorize → train

Usage :
  python pipeline.py                    # pandas (défaut)
  python pipeline.py --engine spark     # PySpark
  python pipeline.py --step pre         # preprocess seulement
  python pipeline.py --step vec         # vectorize seulement
  python pipeline.py --step train       # entraînement seulement
  python pipeline.py --step pre --engine spark
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "pipeline"))

import pipeline.preprocess as preprocess
import pipeline.train_elus as train_elus
import pipeline.train_scandales as train_scandales
import pipeline.train_votes as train_votes
import pipeline.vectorize as vectorize


def run_step(name, fn):
    print(f"\n{'='*60}")
    print(f"  ÉTAPE : {name}")
    print(f"{'='*60}")
    t0 = time.time()
    fn()
    print(f"\n  ✓ {name} terminé en {time.time()-t0:.1f}s")


def preprocess_spark():
    from spark.batch_pipeline import main as spark_main
    spark_main()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", choices=["pre", "vec", "train", "all"], default="all")
    parser.add_argument(
        "--engine",
        choices=["pandas", "spark"],
        default="pandas",
        help="pandas (défaut, sklearn compatible) ou spark (PySpark, requiert Java 11+)",
    )
    args = parser.parse_args()

    pre_fn = preprocess_spark if args.engine == "spark" else preprocess.main
    pre_label = "Preprocessing (PySpark)" if args.engine == "spark" else "Preprocessing (pandas)"

    steps = {
        "pre":   (pre_label,       pre_fn),
        "vec":   ("Vectorisation", vectorize.main),
        "train": ("Entraînement",  lambda: (train_scandales.main(), train_votes.main(), train_elus.main())),
    }

    if args.step == "all":
        for key in ["pre", "vec", "train"]:
            run_step(*steps[key])
    else:
        run_step(*steps[args.step])

    print("\n Pipeline complet ✓")
    print("  Prédictions : python pipeline/predict.py --mode [vote|category|politician]")


if __name__ == "__main__":
    main()
