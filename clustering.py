"""
Clustering sur la branche ML 'diamant'
- KMeans
- DBSCAN
- Visualisation PCA 2D
"""

from pathlib import Path
from typing import Dict, Any

import matplotlib.pyplot as plt
import pandas as pd
from sklearn.cluster import KMeans, DBSCAN
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from config import (
    CLEANED_ML_PARQUET,
    OUTPUT,
    CHART_DPI,
)
from logger_config import setup_logger

logger = setup_logger(__name__)

CLUSTERING_RESULTS_CSV = OUTPUT / "clustering_results.csv"
CLUSTERING_PCA_PNG = OUTPUT / "clustering_pca.png"


class ClusteringRunner:
    """
    Applique du clustering sur le dataset ML diamant.
    """

    def __init__(self, path: Path = CLEANED_ML_PARQUET):
        logger.info(f"[FILE] Chargement ML diamant : {path}")
        self.df = pd.read_parquet(path)
        self.features = self.df.copy()  # toutes colonnes numériques
        self.results: Dict[str, Any] = {}

    def run(self, n_clusters: int = 5) -> pd.DataFrame:
        logger.info("[*] Démarrage du clustering...")

        self._scale_features()
        self._run_kmeans(n_clusters=n_clusters)
        self._run_dbscan()
        self._run_pca_and_plot()

        self._save_results()

        logger.info("[SUCCESS] Clustering terminé\n")
        return self.df

    def _scale_features(self) -> None:
        logger.info("[*] Standardisation des features...")
        scaler = StandardScaler()
        self.X = scaler.fit_transform(self.features.values)
        logger.info(f"[OK] Shape features : {self.X.shape}")

    def _run_kmeans(self, n_clusters: int) -> None:
        logger.info(f"[*] KMeans avec {n_clusters} clusters...")
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
        self.df["cluster_kmeans"] = kmeans.fit_predict(self.X)
        self.results["kmeans_inertia"] = float(kmeans.inertia_)
        logger.info(f"[OK] KMeans inertia : {kmeans.inertia_:.2f}")

    def _run_dbscan(self) -> None:
        logger.info("[*] DBSCAN (eps=0.5, min_samples=5)...")
        dbscan = DBSCAN(eps=0.5, min_samples=5)
        self.df["cluster_dbscan"] = dbscan.fit_predict(self.X)
        n_noise = int((self.df["cluster_dbscan"] == -1).sum())
        n_clusters = len(set(self.df["cluster_dbscan"])) - (1 if -1 in self.df["cluster_dbscan"].values else 0)
        self.results["dbscan_clusters"] = int(n_clusters)
        self.results["dbscan_noise_points"] = n_noise
        logger.info(f"[OK] DBSCAN : {n_clusters} clusters, {n_noise} points bruit")

    def _run_pca_and_plot(self) -> None:
        logger.info("[*] PCA 2D pour visualisation...")
        pca = PCA(n_components=2, random_state=42)
        X_pca = pca.fit_transform(self.X)

        plt.figure(figsize=(10, 7))
        scatter = plt.scatter(
            X_pca[:, 0],
            X_pca[:, 1],
            c=self.df["cluster_kmeans"],
            cmap="tab10",
            s=10,
            alpha=0.7,
        )
        plt.title("Clustering KMeans (PCA 2D) - ML Diamant")
        plt.xlabel("PCA 1")
        plt.ylabel("PCA 2")
        plt.colorbar(scatter, label="Cluster KMeans")

        CLUSTERING_PCA_PNG.parent.mkdir(exist_ok=True, parents=True)
        plt.tight_layout()
        plt.savefig(CLUSTERING_PCA_PNG, dpi=CHART_DPI, bbox_inches="tight")
        plt.close()
        logger.info(f"[OK] Graph PCA clustering : {CLUSTERING_PCA_PNG}")

    def _save_results(self) -> None:
        logger.info("[*] Sauvegarde des résultats de clustering...")
        CLUSTERING_RESULTS_CSV.parent.mkdir(exist_ok=True, parents=True)
        self.df.to_csv(CLUSTERING_RESULTS_CSV, index=False, encoding="utf-8-sig")
        logger.info(f"[OK] Résultats clustering : {CLUSTERING_RESULTS_CSV}")
        logger.info(f"[SUMMARY] {self.results}")


def main() -> None:
    runner = ClusteringRunner()
    runner.run(n_clusters=5)


if __name__ == "__main__":
    main()
