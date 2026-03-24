import React from "react";
import "../styles/Navbar.css";

const Navbar = ({ currentPage, onPageChange }) => (
  <header className="navbar">
    <h1>PoliGraph</h1>
    <div className="nav-links">
      <button className={currentPage === "dashboard" ? "active" : ""} onClick={() => onPageChange("dashboard")}>Dashboard</button>
      <button className={currentPage === "exploration" ? "active" : ""} onClick={() => onPageChange("exploration")}>Exploration</button>
      <button className={currentPage === "themes" ? "active" : ""} onClick={() => onPageChange("themes")}>Themes</button>
    </div>
  </header>
);

export default Navbar;