import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Cell, PieChart, Pie, Legend,
} from "recharts";
import { fetchDashboardScandales, fetchDashboardVotes } from "../data/api";

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

const Stat = ({ label, value, sub, onClick }) => (
  <div style={{ ...statStyle, cursor: onClick ? "pointer" : "default" }}
    onClick={onClick}
    title={onClick ? "Cliquez pour explorer" : undefined}>
    <div style={{ fontSize: 28, fontWeight: 700, color: "#1a3a6e" }}>{value}</div>
    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{sub}</div>}
    {onClick && <div style={{ fontSize: 10, color: "#1a3a6e", marginTop: 4, opacity: 0.6 }}>→ Explorer</div>}
  </div>
);

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

const Dashboard = ({ onNavigate }) => {
  const [sc, setSc] = useState(null);
  const [vt, setVt] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([fetchDashboardScandales(), fetchDashboardVotes()])
      .then(([s, v]) => { setSc(s); setVt(v); })
      .catch((e) => setErr(e.message));
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        <Stat label="Scandales analysés" value={sc.total?.toLocaleString()}
          onClick={() => go("exploration", { tab: "scandales" })} />
        <Stat label="Votes parlementaires" value={vt.total?.toLocaleString()}
          onClick={() => go("exploration", { tab: "votes" })} />
        <Stat label="Taux d'adoption" value={`${txAdopt}%`} sub="des textes soumis au vote"
          onClick={() => go("exploration", { tab: "votes", result: "ADOPTED" })} />
        <Stat label="Catégories de scandales" value={Object.keys(sc.par_categorie || {}).length}
          onClick={() => go("exploration", { tab: "scandales" })} />
      </div>

      {/* Timelines */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
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
    </div>
  );
};

const statStyle = {
  background: "#fff", borderRadius: 10, padding: "1.2rem",
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)", textAlign: "center",
  transition: "box-shadow 0.15s, transform 0.1s",
};
const cardStyle = {
  background: "#fff", borderRadius: 10, padding: "1.2rem",
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  border: "1px solid #e8ecf8",
};

export default Dashboard;
