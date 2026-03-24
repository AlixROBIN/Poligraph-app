import React, { useState, useEffect } from "react";
import { fetchThemes } from "../data/api";

const ThemeAnalysis = () => {
  const [themes, setThemes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchThemes()
      .then(setThemes)
      .catch((e) => setError(e.message || "Erreur themes"));
  }, []);

  if (error) return <p>Erreur : {error}</p>;
  if (!themes) return <p>Chargement...</p>;

  return (
    <div>
      <h2>Analyse thématique</h2>
      {Object.entries(themes).map(([theme, info]) => (
        <div key={theme} style={{ marginBottom: "1rem", background:"#fff", padding: "0.8rem", borderRadius: 8 }}>
          <h3>{theme}</h3>
          <p>Colonne: {info.column}</p>
          <p>Uniques: {info.unique}</p>
          <p>Manquants: {info.missing}</p>
        </div>
      ))}
    </div>
  );
};

export default ThemeAnalysis;