import { useState, useEffect } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, LabelList,
} from "recharts";
import { fetchDashboardScandales } from "../data/api";
import Hemicycle from "./Hemicycle";

const COLORS = [
  "#c0392b", "#e74c3c", "#e67e22", "#f39c12", "#1a3a6e",
  "#2980b9", "#8e44ad", "#16a085", "#27ae60", "#2c3e50",
  "#d35400", "#7f8c8d",
];

// Normalize: remove accents, uppercase, collapse separators → "CONDAMNE", "MISEENEXAMEN"…
function norm(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[\s_-]/g, "");
}

const STATUT_COLOR_MAP = [
  { key: "CONDAMN",      color: "#c0392b" },
  { key: "MISEENEXAMEN", color: "#e74c3c" },
  { key: "ENCOURSDINST", color: "#e67e22" },
  { key: "ENCOURS",      color: "#f39c12" },
  { key: "ENQUETE",      color: "#f39c12" },
  { key: "PRESCRIT",     color: "#95a5a6" },
  { key: "ACQUITT",      color: "#27ae60" },
  { key: "NONLIEU",      color: "#7f8c8d" },
];

function statutColor(name) {
  const n = norm(name);
  return STATUT_COLOR_MAP.find(({ key }) => n.includes(key))?.color || "#1a3a6e";
}

// Sum statut values whose normalized key includes a keyword
function sumStatut(par_statut, keyword) {
  const kn = norm(keyword);
  return Object.entries(par_statut || {})
    .filter(([k]) => norm(k).includes(kn))
    .reduce((s, [, v]) => s + v, 0);
}

function toChart(obj, limit = 15) {
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

const Card = ({ title, subtitle, children }) => (
  <div style={{
    background: "#fff", borderRadius: 12, padding: "1.4rem",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8",
  }}>
    <h3 style={{ margin: "0 0 0.25rem", fontSize: 15, color: "#1a2e5a" }}>{title}</h3>
    {subtitle && <p style={{ margin: "0 0 1rem", fontSize: 11, color: "#aaa" }}>{subtitle}</p>}
    <div style={{ marginTop: subtitle ? 0 : "1rem" }}>{children}</div>
  </div>
);

const KPI = ({ label, value, sub, color, icon }) => (
  <div style={{
    background: "#fff", borderRadius: 12, padding: "1.4rem", textAlign: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8",
  }}>
    {icon && <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>}
    <div style={{ fontSize: 32, fontWeight: 800, color }}>{value}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginTop: 4 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{sub}</div>}
  </div>
);

const ScTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a2e5a", color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div>{payload[0].value?.toLocaleString()} affaires</div>
    </div>
  );
};

export default function ScandalsDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(null);

  useEffect(() => {
    fetchDashboardScandales().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err)  return <p style={{ color: "red", padding: "2rem" }}>Erreur : {err}</p>;
  if (!data) return <p style={{ padding: "2rem" }}>Chargement…</p>;

  const timeline   = toTime(data.par_annee);
  const topPartis  = toChart(data.par_parti, 12);
  const topCats    = toChart(data.par_categorie, 10);
  const statuts    = toChart(data.par_statut);

  const totalPartis = Object.keys(data.par_parti   || {}).length;
  const totalCats   = Object.keys(data.par_categorie || {}).length;
  const condamnes   = sumStatut(data.par_statut, "CONDAMN");

  const go = (filters) => onNavigate("exploration", { tab: "scandales", ...filters });

  return (
    <div style={{ padding: "1.5rem", background: "#f5f6fa", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #7b0000 0%, #c0392b 60%, #e74c3c 100%)",
        borderRadius: 14, padding: "1.8rem 2rem", marginBottom: "1.5rem", color: "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 36 }}>⚖</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Scandales politiques</h2>
            <p style={{ margin: "0.3rem 0 0", opacity: 0.85, fontSize: 13 }}>
              Analyse détaillée de toutes les affaires judiciaires impliquant des élus français
            </p>
          </div>
          <button onClick={() => go({})} style={{
            marginLeft: "auto", background: "rgba(255,255,255,0.2)",
            border: "1px solid rgba(255,255,255,0.4)", color: "#fff",
            borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}>
            Explorer les données →
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <KPI icon="📁" label="Affaires recensées"   value={data.total?.toLocaleString()} color="#c0392b" />
        <KPI icon="🏛" label="Partis impliqués"     value={totalPartis}                  color="#1a3a6e" />
        <KPI icon="📋" label="Catégories d'infraction" value={totalCats}                 color="#8e44ad" />
        <KPI icon="⚖" label="Condamnations"         value={condamnes.toLocaleString()}   color="#7b0000"
          sub="statut CONDAMNÉ" />
      </div>

      {/* Hémicycle — Assemblée nationale actuelle par parti (données réelles) */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Hemicycle onNavigate={onNavigate} />
      </div>

      {/* Timeline pleine largeur */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Card title="Évolution des affaires par année"
          subtitle="Cliquez sur un point pour filtrer par année dans l'Exploration">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={timeline} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="scGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#c0392b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#c0392b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<ScTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#c0392b" strokeWidth={2.5}
                fill="url(#scGrad)" dot={{ r: 3, fill: "#c0392b" }}
                activeDot={{
                  r: 7, fill: "#7b0000", cursor: "pointer",
                  onClick: (_, p) => go({ annee: Number(p.payload.name) }),
                }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Partis + Catégories */}
      <div className="dashboard-2col-grid" style={{ marginBottom: "1.5rem" }}>
        <Card title="Affaires par parti politique (top 12)"
          subtitle="Cliquez sur un parti pour explorer ses affaires">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={topPartis} layout="vertical" margin={{ left: 10, right: 44 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 11 }} />
              <Tooltip content={<ScTooltip />} />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} cursor="pointer"
                onClick={(d) => go({ parti: d.name })}>
                {topPartis.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: "#555" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Catégories d'infractions (top 10)"
          subtitle="Cliquez sur une catégorie pour voir les affaires correspondantes">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={topCats} layout="vertical" margin={{ left: 10, right: 44 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
              <Tooltip content={<ScTooltip />} />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} cursor="pointer"
                onClick={(d) => go({ category: d.name })}>
                {topCats.map((_, i) => <Cell key={i} fill={COLORS[(i + 4) % COLORS.length]} />)}
                <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: "#555" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Statut judiciaire */}
      <Card title="Statut judiciaire des affaires"
        subtitle="Cliquez sur un statut pour filtrer — répartition complète des dossiers">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "2rem", alignItems: "center" }}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={statuts} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={120} innerRadius={55}
                cursor="pointer" onClick={(d) => go({ statut: d.name })}>
                {statuts.map((s, i) => (
                  <Cell key={i} fill={statutColor(s.name)} />
                ))}
              </Pie>
              <Tooltip formatter={(v, n) => [v.toLocaleString(), n.replace(/_/g, " ")]} />
            </PieChart>
          </ResponsiveContainer>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {statuts.map((s, i) => {
              const tot  = statuts.reduce((acc, x) => acc + x.value, 0);
              const pct  = tot > 0 ? ((s.value / tot) * 100).toFixed(1) : 0;
              const color = statutColor(s.name);
              return (
                <div key={i} style={{ cursor: "pointer" }} onClick={() => go({ statut: s.name })}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                    <span style={{ fontWeight: 700, color }}>{s.name.replace(/_/g, " ")}</span>
                    <span style={{ color: "#555" }}>{s.value.toLocaleString()} <span style={{ color: "#aaa" }}>({pct}%)</span></span>
                  </div>
                  <div style={{ background: "#eee", borderRadius: 5, height: 12 }}>
                    <div style={{ width: `${pct}%`, background: color, height: 12, borderRadius: 5, transition: "width 0.6s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
