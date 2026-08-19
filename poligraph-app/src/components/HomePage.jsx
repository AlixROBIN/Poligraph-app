import { useState, useEffect } from "react";
import { fetchDashboardScandales, fetchDashboardVotes } from "../data/api";
import Card from "./Card";

const BLOC = {
  scandales: {
    id: "scandales",
    icon: "⚖",
    iconBg: "var(--color-red-100)",
    iconFg: "var(--color-red-800)",
    title: "Scandales politiques",
    desc: "Retrouvez toutes les affaires judiciaires, condamnations et mises en examen impliquant des élus français.",
    expl: "Corruption, détournement de fonds, abus de biens sociaux… analysez qui est impliqué et dans quel parti.",
    cta: "Explorer les scandales",
  },
  votes: {
    id: "votes",
    icon: "🗳",
    iconBg: "var(--color-blue-100)",
    iconFg: "var(--color-blue-800)",
    title: "Votes parlementaires",
    desc: "Consultez l'ensemble des scrutins de l'Assemblée nationale : qui a voté quoi et comment.",
    expl: "Chaque loi adoptée ou rejetée, avec le détail des votes pour, contre et les abstentions.",
    cta: "Explorer les votes",
  },
  factchecks: {
    id: "factchecks",
    icon: "✓",
    iconBg: "var(--color-purple-100)",
    iconFg: "var(--color-purple-800)",
    title: "Fact-checking",
    desc: "817 déclarations de politiciens vérifiées par AFP Factuel, TF1 Info, Franceinfo, Le Monde…",
    expl: "Qui dit vrai ? Qui dit faux ? Classement des politiciens et partis par fiabilité avec biais des sources.",
    cta: "Voir les classements",
  },
};

const Metric = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 10.5, color: "var(--pg-muted)" }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 500, color: "var(--pg-ink)", letterSpacing: "-0.3px", fontVariantNumeric: "tabular-nums" }}>
      {value?.toLocaleString() ?? "—"}
    </div>
  </div>
);

const BlocCard = ({ cfg, stats, onClick }) => (
  <Card onClick={onClick} hoverable
    style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: "1rem" }}
    padding="1.5rem">
    <div style={{
      width: 36, height: 36, borderRadius: 10, background: cfg.iconBg, color: cfg.iconFg,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
    }}>{cfg.icon}</div>

    <div>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--pg-ink)", letterSpacing: "-0.3px" }}>{cfg.title}</h2>
      <p style={{ margin: "0.5rem 0 0", fontSize: 13, color: "var(--pg-muted)", lineHeight: 1.6 }}>
        {cfg.desc}
      </p>
    </div>

    {stats && (
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: "0.2rem" }}>
        <Metric label={cfg.id === "scandales" ? "Affaires" : "Scrutins"} value={stats.total} />
        {cfg.id === "scandales" && stats.par_parti && (
          <Metric label="Partis impliqués" value={Object.keys(stats.par_parti).length} />
        )}
        {cfg.id === "votes" && (
          <>
            <Metric label="Adoptés" value={stats.resultats?.ADOPTED} />
            <Metric label="Rejetés" value={stats.resultats?.REJECTED} />
          </>
        )}
      </div>
    )}

    <div style={{ marginTop: "auto", paddingTop: "0.5rem", borderTop: "1px solid var(--pg-line)" }}>
      <p style={{ margin: "0 0 0.6rem", fontSize: 11.5, color: "var(--pg-muted)", lineHeight: 1.5 }}>
        {cfg.expl}
      </p>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-blue-600)" }}>
        {cfg.cta} →
      </span>
    </div>
  </Card>
);

const TIP = ({ icon, title, text }) => (
  <Card style={{ flex: 1, minWidth: 200, display: "flex", gap: 12, alignItems: "flex-start" }} padding="1rem">
    <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
    <div>
      <div style={{ fontWeight: 500, fontSize: 13, color: "var(--pg-ink)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--pg-muted)", lineHeight: 1.6 }}>{text}</div>
    </div>
  </Card>
);

export default function HomePage({ onNavigate }) {
  const [sc, setSc] = useState(null);
  const [vt, setVt] = useState(null);

  useEffect(() => {
    fetchDashboardScandales().then(setSc).catch(() => {});
    fetchDashboardVotes().then(setVt).catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "transparent" }}>
      {/* Hero */}
      <div style={{
        background: "linear-gradient(135deg, var(--pg-navy-deep) 0%, var(--pg-navy) 60%, var(--pg-navy-soft) 100%)",
        padding: "3.5rem 2rem 2.75rem", textAlign: "center", color: "#fff",
      }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(255,255,255,0.08)",
            borderRadius: 999, padding: "3px 12px", fontSize: 11.5, marginBottom: "1.1rem",
            color: "rgba(255,255,255,0.75)", letterSpacing: "0.02em",
          }}>
            Transparence politique française
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(26px, 4.5vw, 42px)", fontWeight: 600, letterSpacing: "-0.5px" }}>
            MonApp<span style={{ color: "var(--pg-gold)" }}>Politique</span>
          </h1>
          <p style={{ fontSize: 15, opacity: 0.75, marginTop: "0.8rem", lineHeight: 1.7, maxWidth: 480, margin: "0.8rem auto 0" }}>
            Explorez les scandales, les votes et les relations des élus français.
            Des données publiques, présentées simplement.
          </p>
        </div>
      </div>

      {/* 3 blocs principaux */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2.25rem 1.5rem 1.5rem" }}>
        <p style={{ textAlign: "center", color: "var(--pg-muted)", marginBottom: "1.25rem", fontSize: 13.5 }}>
          Choisissez un domaine à explorer
        </p>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <BlocCard cfg={BLOC.scandales} stats={sc}
            onClick={() => onNavigate("dashboard-scandales")} />
          <BlocCard cfg={BLOC.votes} stats={vt}
            onClick={() => onNavigate("dashboard-votes")} />
          <BlocCard cfg={BLOC.factchecks} stats={null}
            onClick={() => onNavigate("dashboard-factchecks")} />
        </div>

        {/* Explication pour novices */}
        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ color: "var(--pg-ink)", fontWeight: 500, fontSize: 14, marginBottom: "1rem", textAlign: "center" }}>
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
