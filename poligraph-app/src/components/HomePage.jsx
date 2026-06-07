import { useState, useEffect } from "react";
import { fetchDashboardScandales, fetchDashboardVotes } from "../data/api";

const BLOC = {
  scandales: {
    id: "scandales",
    icon: "⚖",
    title: "Scandales politiques",
    color: "#c0392b",
    gradient: "linear-gradient(135deg, #c0392b 0%, #e74c3c 100%)",
    desc: "Retrouvez toutes les affaires judiciaires, condamnations et mises en examen impliquant des élus français.",
    expl: "Corruption, détournement de fonds, abus de biens sociaux… analysez qui est impliqué et dans quel parti.",
    cta: "Explorer les scandales",
    tab: "scandales",
  },
  votes: {
    id: "votes",
    icon: "🗳",
    title: "Votes parlementaires",
    color: "#1a3a6e",
    gradient: "linear-gradient(135deg, #1a3a6e 0%, #2980b9 100%)",
    desc: "Consultez l'ensemble des scrutins de l'Assemblée nationale : qui a voté quoi et comment.",
    expl: "Chaque loi adoptée ou rejetée, avec le détail des votes pour, contre et les abstentions.",
    cta: "Explorer les votes",
    tab: "votes",
  },
  factchecks: {
    id: "factchecks",
    icon: "✓",
    title: "Fact-checking",
    color: "#8e44ad",
    gradient: "linear-gradient(135deg, #6c3483 0%, #8e44ad 100%)",
    desc: "817 déclarations de politiciens vérifiées par AFP Factuel, TF1 Info, Franceinfo, Le Monde…",
    expl: "Qui dit vrai ? Qui dit faux ? Classement des politiciens et partis par fiabilité avec biais des sources.",
    cta: "Voir les classements",
    tab: "factchecks",
  },
};

const BlocCard = ({ cfg, stats, onClick }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, minWidth: 280, cursor: "pointer", borderRadius: 16,
        background: cfg.gradient,
        boxShadow: hover
          ? "0 12px 40px rgba(0,0,0,0.22)"
          : "0 4px 18px rgba(0,0,0,0.12)",
        transform: hover ? "translateY(-4px)" : "translateY(0)",
        transition: "all 0.22s ease",
        padding: "2.5rem 2rem",
        display: "flex", flexDirection: "column", gap: "1.2rem",
        color: "#fff",
      }}
    >
      <div style={{ fontSize: 48, lineHeight: 1 }}>{cfg.icon}</div>
      <div>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{cfg.title}</h2>
        <p style={{ margin: "0.6rem 0 0", fontSize: 14, opacity: 0.88, lineHeight: 1.6 }}>
          {cfg.desc}
        </p>
      </div>

      {stats && (
        <div style={{
          display: "flex", gap: 16, flexWrap: "wrap",
          background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "0.8rem 1rem",
        }}>
          <StatMini label={cfg.id === "scandales" ? "Affaires" : "Scrutins"} value={stats.total} />
          {cfg.id === "scandales" && stats.par_parti && (
            <StatMini label="Partis impliqués" value={Object.keys(stats.par_parti).length} />
          )}
          {cfg.id === "votes" && (
            <>
              <StatMini label="Adoptés" value={stats.resultats?.ADOPTED} color="#a8f0c8" />
              <StatMini label="Rejetés" value={stats.resultats?.REJECTED} color="#ffa8a8" />
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: "auto" }}>
        <p style={{ margin: "0 0 0.4rem", fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
          {cfg.expl}
        </p>
        <span style={{
          display: "inline-block", background: "rgba(255,255,255,0.25)",
          borderRadius: 20, padding: "6px 16px", fontSize: 13, fontWeight: 700,
          border: "1px solid rgba(255,255,255,0.4)",
        }}>
          {cfg.cta} →
        </span>
      </div>
    </div>
  );
};

const StatMini = ({ label, value, color = "#fff" }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 800, color }}>{value?.toLocaleString() ?? "—"}</div>
    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{label}</div>
  </div>
);

const TIP = ({ icon, title, text }) => (
  <div style={{
    display: "flex", gap: 12, alignItems: "flex-start",
    background: "#fff", borderRadius: 10, padding: "1rem",
    boxShadow: "0 1px 4px rgba(0,0,0,0.07)", flex: 1, minWidth: 200,
  }}>
    <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#1a2e5a", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{text}</div>
    </div>
  </div>
);

export default function HomePage({ onNavigate }) {
  const [sc, setSc] = useState(null);
  const [vt, setVt] = useState(null);

  useEffect(() => {
    fetchDashboardScandales().then(setSc).catch(() => {});
    fetchDashboardVotes().then(setVt).catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f8" }}>
      {/* Hero */}
      <div style={{
        background: "linear-gradient(135deg, #0d1b3e 0%, #1a3a6e 60%, #2c5282 100%)",
        padding: "4rem 2rem 3rem", textAlign: "center", color: "#fff",
      }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(201,162,39,0.2)", border: "1px solid rgba(201,162,39,0.5)",
            borderRadius: 20, padding: "4px 14px", fontSize: 12, marginBottom: "1.2rem",
            color: "#f0c040",
          }}>
            Transparence politique française
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 900, letterSpacing: "-0.5px" }}>
            Poli<span style={{ color: "#c9a227" }}>Graph</span>
          </h1>
          <p style={{ fontSize: 16, opacity: 0.8, marginTop: "0.8rem", lineHeight: 1.7, maxWidth: 500, margin: "0.8rem auto 0" }}>
            Explorez les scandales, les votes et les relations des élus français.
            Des données publiques, présentées simplement.
          </p>
        </div>
      </div>

      {/* 2 blocs principaux */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 1.5rem 1.5rem" }}>
        <p style={{ textAlign: "center", color: "#7a8aaa", marginBottom: "1.5rem", fontSize: 14 }}>
          Choisissez un domaine à explorer
        </p>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <BlocCard cfg={BLOC.scandales} stats={sc}
            onClick={() => onNavigate("dashboard-scandales")} />
          <BlocCard cfg={BLOC.votes} stats={vt}
            onClick={() => onNavigate("dashboard-votes")} />
          <BlocCard cfg={BLOC.factchecks} stats={null}
            onClick={() => onNavigate("dashboard-factchecks")} />
        </div>

        {/* Explication pour novices */}
        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ color: "#1a2e5a", fontSize: 15, marginBottom: "1rem", textAlign: "center" }}>
            Comment ça marche ?
          </h3>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <TIP icon="🔍" title="Qu'est-ce qu'un scandale ?"
              text="Une affaire judiciaire impliquant un élu : corruption, détournement, abus de pouvoir. Les données viennent de sources officielles et de presse." />
            <TIP icon="🗳" title="Qu'est-ce qu'un vote ?"
              text="Chaque loi passe par un vote à l'Assemblée nationale. On peut voir si les députés ont voté pour, contre, ou se sont abstenus." />
            <TIP icon="📊" title="D'où viennent les données ?"
              text="Sources officielles : Assemblée nationale, Sénat, OpenData. Les articles viennent de la presse nationale et des réseaux sociaux." />
            <TIP icon="⚠" title="Interprétez avec recul"
              text="Les sentiments et analyses sont générés automatiquement. Un titre 'critique' ne signifie pas toujours un biais — vérifiez toujours la source." />
          </div>
        </div>
      </div>
    </div>
  );
}
