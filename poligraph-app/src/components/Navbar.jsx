import React from "react";
import "../styles/Navbar.css";

const PAGES = [
  { id: "accueil",             label: "Accueil" },
  { id: "annuaire",            label: "Annuaire" },
  { id: "exploration",         label: "Exploration" },
  { id: "journal",             label: "Journal" },
  { id: "dashboard-scandales", label: "Scandales" },
  { id: "dashboard-votes",     label: "Votes" },
  { id: "dashboard-factchecks",label: "Fact-checking" },
  { id: "match",               label: "🗳️ Mon programme" },
];

const Navbar = ({ currentPage, onPageChange, canGoBack, onBack }) => (
  <header className="navbar">
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {canGoBack && (
        <button
          onClick={onBack}
          style={{
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.3)",
            color: "#fff",
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.25)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
          title="Page précédente"
        >
          ← Retour
        </button>
      )}
      <h1 style={{ cursor: "pointer" }} onClick={() => onPageChange("accueil")}>
        MonApp<span>Politique</span>
      </h1>
    </div>
    <div className="nav-links">
      {PAGES.map((p) => (
        <button key={p.id}
          className={currentPage === p.id ? "active" : ""}
          onClick={() => onPageChange(p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  </header>
);

export default Navbar;
