import React from "react";
import "../styles/Navbar.css";

const PAGES = [
  { id: "dashboard",   label: "Dashboard" },
  { id: "annuaire",    label: "Annuaire" },
  { id: "exploration", label: "Exploration" },
  { id: "journal",     label: "Journal" },
  { id: "predict",     label: "Prédictions" },
  { id: "chat",        label: "PoliBot 🤖" },
];

const Navbar = ({ currentPage, onPageChange }) => (
  <header className="navbar">
    <h1>Poli<span>Graph</span></h1>
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
