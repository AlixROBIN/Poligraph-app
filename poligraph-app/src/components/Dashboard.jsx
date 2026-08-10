import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Cell, PieChart, Pie, Legend,
} from "recharts";
import { fetchDashboardScandales, fetchDashboardVotes, fetchSourceMetrics } from "../data/api";

const COLORS = ["#1a3a6e","#e74c3c","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#34495e"];

function toChart(obj, limit = 10) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}
function toTime(obj) {
  return Object.entries(obj || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([name, value]) => ({ name, value }));
}

const Stat = ({ icon, label, value, sub, onClick }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        ...statStyle,
        cursor: onClick ? "pointer" : "default",
        boxShadow: hover ? "0 6px 20px rgba(20,33,61,0.14)" : statStyle.boxShadow,
        transform: hover ? "translateY(-2px)" : "translateY(0)",
      }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={onClick ? "Cliquez pour explorer" : undefined}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#c9a227" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 15, opacity: 0.55 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#14213d" }}>{value}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, color: "#5b6b85" }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#8b93a7", marginTop: 2 }}>{sub}</div>}
      {onClick && <div style={{ fontSize: 10, color: "#1a3a6e", marginTop: 4, opacity: 0.7, fontWeight: 700 }}>→ Explorer</div>}
    </div>
  );
};

const Card = ({ title, children }) => (
  <div style={cardStyle}>
    <h3 style={{ margin: "0 0 1rem", fontSize: 15, color: "#1a2e5a" }}>{title}</h3>
    {children}
  </div>
);

// Tooltip custom avec hint "cliquer pour filtrer"
const ClickTooltip = ({ active, payload, label, hint }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a2e5a", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div>{payload[0].value?.toLocaleString()}</div>
      {hint && <div style={{ opacity: 0.7, marginTop: 2, fontSize: 10 }}>Clic → filtrer</div>}
    </div>
  );
};

const STATUS_COLOR = { ok: "#2ecc71", degraded: "#f39c12", error: "#e74c3c", unknown: "#aaa" };
const SOURCE_ICON  = {
  "lemonde": "📰", "lefigaro": "📰", "liberation": "📰",
  "franceinfo": "📻", "lepoint": "📰",
  "reddit/r/france": "🟠", "reddit/r/politique": "🟠",
  "bluesky/politique": "🦋", "bluesky/france": "🦋",
};

function SourcesCard({ metrics }) {
  if (!metrics) return null;
  const { scraping, kafka, dataframes } = metrics;
  const sources = Object.entries(scraping.sources || {});
  return (
    <div style={{ ...cardStyle, marginTop: "1rem" }}>
      <h3 style={{ margin: "0 0 0.75rem", fontSize: 15, color: "#1a2e5a" }}>
        Métriques sources &amp; pipeline
      </h3>

      {/* Grille sources */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 8, marginBottom: "0.75rem" }}>
        {sources.map(([key, s]) => (
          <div key={key} style={{
            background: "#f8f9fc", borderRadius: 8, padding: "8px 10px",
            border: `1px solid ${STATUS_COLOR[s.status] || "#e0e0e0"}22`,
            borderLeft: `3px solid ${STATUS_COLOR[s.status] || "#ccc"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <span style={{ fontSize: 14 }}>{SOURCE_ICON[key] || "📡"}</span>
              <span style={{ fontWeight: 600, fontSize: 12, color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
              <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[s.status] || "#ccc", flexShrink: 0 }} />
            </div>
            <div style={{ fontSize: 11, color: "#666" }}>
              {s.last_count != null ? `${s.last_count} articles` : "—"}
              {s.success_rate != null && <span style={{ marginLeft: 6, color: s.success_rate >= 80 ? "#2ecc71" : "#e74c3c" }}>{s.success_rate}%</span>}
            </div>
            <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
              {s.ok} ok · {s.errors} erreurs
            </div>
          </div>
        ))}
        {sources.length === 0 && (
          <div style={{ color: "#aaa", fontSize: 12, padding: "0.5rem" }}>
            Aucune donnée — déclencher le Journal pour initialiser.
          </div>
        )}
      </div>

      {/* Ligne basse : Kafka + DB */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", paddingTop: 8, fontSize: 12, color: "#666" }}>
        <span>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: kafka.active ? "#2ecc71" : "#e74c3c", display: "inline-block", marginRight: 5 }} />
          Kafka : <strong>{kafka.active ? "actif" : "inactif"}</strong>
        </span>
        <span>🗄️ Scandales : <strong>{dataframes.scandales.toLocaleString()}</strong></span>
        <span>🗳️ Votes : <strong>{dataframes.votes.toLocaleString()}</strong></span>
        <span>👤 Élus : <strong>{dataframes.elus.toLocaleString()}</strong></span>
        {scraping.last_run_at && (
          <span style={{ marginLeft: "auto", color: "#aaa" }}>
            Dernier scrape : {new Date(scraping.last_run_at).toLocaleTimeString("fr-FR")}
          </span>
        )}
      </div>
    </div>
  );
}

const Dashboard = ({ onNavigate }) => {
  const [sc, setSc]   = useState(null);
  const [vt, setVt]   = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([fetchDashboardScandales(), fetchDashboardVotes()])
      .then(([s, v]) => { setSc(s); setVt(v); })
      .catch((e) => setErr(e.message));
    fetchSourceMetrics().then(setMetrics).catch(() => {});
  }, []);

  if (err) return <p style={{ color: "red", padding: "2rem" }}>Erreur : {err}</p>;
  if (!sc || !vt) return <p style={{ padding: "2rem" }}>Chargement…</p>;

  const topPartis  = toChart(sc.par_parti, 8);
  const topCats    = toChart(sc.par_categorie, 8);
  const topStatuts = toChart(sc.par_statut);
  const anneeScSc = toTime(sc.par_annee);
  const anneeVote = toTime(vt.par_annee);
  const resultats = toChart(vt.resultats);

  const adopted  = vt.resultats?.ADOPTED  || 0;
  const rejected = vt.resultats?.REJECTED || 0;
  const txAdopt  = adopted + rejected > 0 ? ((adopted / (adopted + rejected)) * 100).toFixed(1) : "—";

  const go = (page, filters) => onNavigate(page, filters);

  return (
    <div style={{ padding: "1.5rem", background: "#f5f6fa", minHeight: "100vh" }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "0.3rem" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(135deg, #1a3a6e 60%, #c9a227 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, color: "#fff", fontWeight: 900,
        }}>
          ⚖
        </div>
        <div>
          <h2 style={{ marginBottom: "0.1rem", color: "#1a2e5a" }}>Tableau de bord</h2>
          <p style={{ color: "#7a8aaa", margin: 0, fontSize: 13 }}>
            Vue d'ensemble — cliquez sur un élément pour explorer les données filtrées
          </p>
        </div>
      </div>
      <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", marginBottom: "1.4rem", marginTop: "0.8rem" }}>
        <div style={{ flex: 1, background: "#002395" }} />
        <div style={{ flex: 1, background: "#fff", border: "1px solid #e0e0e0" }} />
        <div style={{ flex: 1, background: "#ED2939" }} />
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <Stat icon="⚖" label="Scandales analysés" value={sc.total?.toLocaleString()}
          onClick={() => go("exploration", { tab: "scandales" })} />
        <Stat icon="🗳" label="Votes parlementaires" value={vt.total?.toLocaleString()}
          onClick={() => go("exploration", { tab: "votes" })} />
        <Stat icon="📈" label="Taux d'adoption" value={`${txAdopt}%`} sub="des textes soumis au vote"
          onClick={() => go("exploration", { tab: "votes", result: "ADOPTED" })} />
        <Stat icon="🏷" label="Catégories de scandales" value={Object.keys(sc.par_categorie || {}).length}
          onClick={() => go("exploration", { tab: "scandales" })} />
      </div>

      {/* Timelines */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
        <Card title="Scandales par année — cliquez sur un point pour filtrer">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={anneeScSc}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" interval={4} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<ClickTooltip hint />} />
              <Line type="monotone" dataKey="value" stroke="#1a3a6e" dot={false} strokeWidth={2}
                activeDot={{
                  r: 7, fill: "#c9a227", cursor: "pointer",
                  onClick: (_, payload) => go("exploration", { tab: "scandales", annee: Number(payload.payload.name) }),
                }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Votes parlementaires par année — cliquez pour filtrer">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={anneeVote}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" interval={2} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<ClickTooltip hint />} />
              <Line type="monotone" dataKey="value" stroke="#2ecc71" dot={false} strokeWidth={2}
                activeDot={{
                  r: 7, fill: "#c9a227", cursor: "pointer",
                  onClick: (_, payload) => go("exploration", { tab: "votes", annee: Number(payload.payload.name) }),
                }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Partis + Catégories + Résultats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
        <Card title="Scandales par parti (top 8)">
          <p style={{ fontSize: 11, color: "#aaa", margin: "-0.5rem 0 0.75rem" }}>Cliquez sur un parti pour filtrer</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topPartis} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={50} tick={{ fontSize: 12 }} />
              <Tooltip content={<ClickTooltip hint />} />
              <Bar dataKey="value" cursor="pointer"
                onClick={(data) => go("exploration", { tab: "scandales", parti: data.name })}>
                {topPartis.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Catégories de scandales">
          <p style={{ fontSize: 11, color: "#aaa", margin: "-0.5rem 0 0.75rem" }}>Cliquez sur une catégorie pour filtrer</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topCats} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
              <Tooltip content={<ClickTooltip hint />} />
              <Bar dataKey="value" cursor="pointer"
                onClick={(data) => go("exploration", { tab: "scandales", category: data.name })}>
                {topCats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Résultats des votes">
          <p style={{ fontSize: 11, color: "#aaa", margin: "-0.5rem 0 0.75rem" }}>Cliquez pour voir les votes filtrés</p>
          <div style={{ marginBottom: "0.5rem" }}>
            {resultats.map((r, i) => {
              const total = resultats.reduce((s, x) => s + x.value, 0);
              const pct   = total > 0 ? ((r.value / total) * 100).toFixed(1) : 0;
              const color = r.name === "ADOPTED" ? "#2ecc71" : r.name === "REJECTED" ? "#e74c3c" : "#f39c12";
              const label = r.name === "ADOPTED" ? "Adopté" : r.name === "REJECTED" ? "Rejeté" : r.name;
              return (
                <div key={i} style={{ marginBottom: 12, cursor: "pointer" }}
                  onClick={() => go("exploration", { tab: "votes", result: r.name })}
                  title={`Voir les votes ${label.toLowerCase()}s`}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color }}>{label}</span>
                    <span style={{ color: "#555" }}>{r.value.toLocaleString()} ({pct}%)</span>
                  </div>
                  <div style={{ background: "#eee", borderRadius: 4, height: 8 }}>
                    <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4, transition: "width 0.5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: "0.75rem", borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
            Moy. pour : {vt.moyenne_pour} · contre : {vt.moyenne_contre} · abstention : {vt.moyenne_abstain}
          </div>
        </Card>
      </div>

      {/* Statut judiciaire */}
      <div style={{ marginTop: "1rem" }}>
        <Card title="Statut judiciaire des scandales">
          <p style={{ fontSize: 11, color: "#aaa", margin: "-0.5rem 0 0.75rem" }}>Cliquez sur un statut pour filtrer</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "center" }}>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={topStatuts} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={100}
                  label={false} labelLine={false}
                  cursor="pointer"
                  onClick={(data) => go("exploration", { tab: "scandales", statut: data.name })}>
                  {topStatuts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(val, name) => [val, name.replace(/_/g, " ")]} />
              </PieChart>
            </ResponsiveContainer>
            <div>
              {topStatuts.map((item, i) => (
                <div key={i}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                    cursor: "pointer", padding: "4px 6px", borderRadius: 6,
                    transition: "background 0.1s" }}
                  onClick={() => go("exploration", { tab: "scandales", statut: item.name })}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f0f3fa"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                    background: COLORS[i % COLORS.length] }} />
                  <span style={{ fontSize: 13 }}>
                    {item.name.replace(/_/g, " ")} — <strong>{item.value}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Métriques sources */}
      <SourcesCard metrics={metrics} />
    </div>
  );
};

const statStyle = {
  background: "#fff", borderRadius: 10, padding: "1.2rem 1.2rem 1.2rem 1.4rem",
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)", textAlign: "left",
  transition: "box-shadow 0.15s, transform 0.15s",
  position: "relative", overflow: "hidden",
};
const cardStyle = {
  background: "#fff", borderRadius: 10, padding: "1.2rem",
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  border: "1px solid #e8ecf8",
};

export default Dashboard;
