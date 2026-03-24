import React, { useState, useEffect } from "react";
import { fetchMetrics } from "../data/api";
import "../styles/Dashboard.css";

const Dashboard = () => {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMetrics()
      .then(setMetrics)
      .catch((e) => setError(e.message || "Une erreur"));
  }, []);

  if (error) return <p>Erreur : {error}</p>;
  if (!metrics) return <p>Chargement...</p>;

  return (
    <div className="dashboard">
      <div className="card-grid">
        <div className="card"><h3>Records</h3><p>{metrics.total_records}</p></div>
        <div className="card"><h3>Colonnes</h3><p>{metrics.total_columns}</p></div>
        <div className="card"><h3>Valeurs manquantes</h3><p>{metrics.missing_percent}%</p></div>
      </div>
      <div className="card">
        <h3>Source</h3>
        <p>FastAPI backend → cleaned.csv</p>
      </div>
    </div>
  );
};

export default Dashboard;