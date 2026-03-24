import React, { useState } from "react";
import Navbar from "./components/Navbar";
import Dashboard from "./components/Dashboard";
import ExplorationPage from "./components/ExplorationPage";
import ThemeAnalysis from "./components/ThemeAnalysis";
import "./styles/global.css";

function App() {
  const [page, setPage] = useState("dashboard");
  return (
    <div className="app">
      <Navbar currentPage={page} onPageChange={setPage} />
      <main className="main-content">
        {page === "dashboard" && <Dashboard />}
        {page === "exploration" && <ExplorationPage />}
        {page === "themes" && <ThemeAnalysis />}
      </main>
    </div>
  );
}

export default App;