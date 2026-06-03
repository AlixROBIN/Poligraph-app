import { useState } from "react";
import Navbar from "./components/Navbar";
import Dashboard from "./components/Dashboard";
import ExplorationPage from "./components/ExplorationPage";
import ThemeAnalysis from "./components/ThemeAnalysis";
import AnnuairePage from "./components/AnnuairePage";
import JournalPage from "./components/JournalPage";
import ChatWidget from "./components/ChatPage";
import "./styles/global.css";

function App() {
  const [page, setPage] = useState("dashboard");
  const [explorationFilters, setExplorationFilters] = useState({});

  const navigate = (targetPage, filters = {}) => {
    setExplorationFilters(filters);
    setPage(targetPage);
  };

  return (
    <div className="app">
      <Navbar currentPage={page} onPageChange={(p) => navigate(p)} />
      <main className="main-content">
        {page === "dashboard"   && <Dashboard onNavigate={navigate} />}
        {page === "exploration" && <ExplorationPage key={JSON.stringify(explorationFilters)} initialFilters={explorationFilters} />}
        {page === "themes"      && <ThemeAnalysis />}
        {page === "journal"     && <JournalPage />}
        {page === "annuaire"    && <AnnuairePage onNavigate={navigate} />}
      </main>
      <ChatWidget />
    </div>
  );
}

export default App;
