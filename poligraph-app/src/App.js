import { useState } from "react";
import Navbar from "./components/Navbar";
import HomePage from "./components/HomePage";
import Dashboard from "./components/Dashboard";
import ExplorationPage from "./components/ExplorationPage";
import ThemeAnalysis from "./components/ThemeAnalysis";
import AnnuairePage from "./components/AnnuairePage";
import JournalPage from "./components/JournalPage";
import ChatWidget from "./components/ChatPage";
import "./styles/global.css";

function App() {
  // Historique de navigation : chaque entrée = { page, filters }
  const [history, setHistory] = useState([{ page: "accueil", filters: {} }]);

  const current = history[history.length - 1];
  const canGoBack = history.length > 1;

  const navigate = (page, filters = {}) => {
    setHistory((prev) => [...prev, { page, filters }]);
  };

  const goBack = () => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const { page, filters: explorationFilters } = current;

  return (
    <div className="app">
      <Navbar
        currentPage={page}
        onPageChange={(p) => navigate(p)}
        canGoBack={canGoBack}
        onBack={goBack}
      />
      <main className="main-content">
        {page === "accueil"    && <HomePage onNavigate={navigate} />}
        {page === "dashboard"  && <Dashboard onNavigate={navigate} />}
        {page === "exploration"&& <ExplorationPage key={JSON.stringify(explorationFilters)} initialFilters={explorationFilters} />}
        {page === "themes"     && <ThemeAnalysis />}
        {page === "journal"    && <JournalPage />}
        {page === "annuaire"   && <AnnuairePage onNavigate={navigate} />}
      </main>
      <ChatWidget />
    </div>
  );
}

export default App;
