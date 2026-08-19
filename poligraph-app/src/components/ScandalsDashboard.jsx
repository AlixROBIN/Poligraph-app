import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, LabelList,
} from "recharts";
import { fetchDashboardScandales } from "../data/api";
import Hemicycle from "./Hemicycle";
import Card from "./Card";
import MetricCard from "./MetricCard";
import { useParties } from "./PartyLogo";

// Palette catégorique neutre (pas de partis) — nuances -400 de la palette
// sémantique, désaturées, cycle sur 6 teintes.
// Recharts pose ces valeurs en attribut SVG "fill" brut, qui ne résout pas
// toujours var(--...) de façon fiable selon le moteur de rendu — on garde
// donc du hex littéral ici (identique aux tokens CSS), var() partout ailleurs.
const CAT_COLORS = ["#6e93c9", "#de7e70", "#d9a64e", "#7fae7f", "#a98bc2", "#a6a69e"];

// Normalize: remove accents, uppercase, collapse separators → "CONDAMNE", "MISEENEXAMEN"…
function norm(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[\s_-]/g, "");
}

const STATUT_COLOR_MAP = [
  { key: "CONDAMN",      color: "#c4503e" },
  { key: "MISEENEXAMEN", color: "#de7e70" },
  { key: "ENCOURSDINST", color: "#b9832a" },
  { key: "ENCOURS",      color: "#d9a64e" },
  { key: "ENQUETE",      color: "#d9a64e" },
  { key: "PRESCRIT",     color: "#a6a69e" },
  { key: "ACQUITT",      color: "#4f8350" },
  { key: "NONLIEU",      color: "#71716a" },
];

function statutColor(name) {
  const n = norm(name);
  return STATUT_COLOR_MAP.find(({ key }) => n.includes(key))?.color || "#3d6098";
}

// Désature une couleur officielle de parti vers le gris neutre (--color-gray-400
// = #a6a69e) en RGB pur — pas de color-mix()/var() ici, peu fiable en attribut
// SVG "fill" selon le moteur de rendu.
function desaturateHex(hex, ratio = 0.7) {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return "#a6a69e";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const [gr, gg, gb] = [166, 166, 158];
  const mix = (c, gc) => Math.round(c * ratio + gc * (1 - ratio));
  return `rgb(${mix(r, gr)}, ${mix(g, gg)}, ${mix(b, gb)})`;
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

const ScTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--pg-ink)", color: "#fff", padding: "7px 11px", borderRadius: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 500 }}>{label}</div>
      <div>{payload[0].value?.toLocaleString()} affaires</div>
    </div>
  );
};

export default function ScandalsDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(null);
  const byShortName = useParties();

  useEffect(() => {
    fetchDashboardScandales().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err)  return <p style={{ color: "var(--color-red-600)", padding: "2rem" }}>Erreur : {err}</p>;
  if (!data) return <p style={{ padding: "2rem", color: "var(--pg-muted)" }}>Chargement…</p>;

  const topPartis  = toChart(data.par_parti, 12);
  const topCats    = toChart(data.par_categorie, 10);
  const statuts    = toChart(data.par_statut);

  const totalPartis = Object.keys(data.par_parti   || {}).length;
  const totalCats   = Object.keys(data.par_categorie || {}).length;
  const condamnes   = sumStatut(data.par_statut, "CONDAMN");

  const go = (filters) => onNavigate("exploration", { tab: "scandales", ...filters });

  // Couleur officielle du parti, désaturée pour le graphique (fond sobre du reste du site)
  const partyColor = (code) => {
    const official = byShortName?.[code]?.color;
    return official ? desaturateHex(official, 0.7) : "#a6a69e";
  };

  return (
    <div style={{ padding: "1.5rem", background: "transparent", minHeight: "100vh" }}>
      {/* Header */}
      <Card style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "1.5rem" }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: "var(--color-red-100)", color: "var(--color-red-800)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0,
        }}>⚖</div>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 500, color: "var(--pg-ink)", letterSpacing: "-0.3px" }}>Scandales politiques</h2>
          <p style={{ margin: "0.25rem 0 0", fontSize: 12.5, color: "var(--pg-muted)" }}>
            Analyse détaillée de toutes les affaires judiciaires impliquant des élus français
          </p>
        </div>
        <button onClick={() => go({})} style={{
          marginLeft: "auto", background: "var(--pg-navy)", border: "none", color: "#fff",
          borderRadius: "var(--pg-r-sm)", padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 500,
        }}>
          Explorer les données →
        </button>
      </Card>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <MetricCard icon="📁" label="Affaires recensées" value={data.total?.toLocaleString()} />
        <MetricCard icon="🏛" label="Partis impliqués" value={totalPartis} />
        <MetricCard icon="📋" label="Catégories d'infraction" value={totalCats} />
        <MetricCard icon="⚖" label="Condamnations" value={condamnes.toLocaleString()} sub="statut CONDAMNÉ" />
      </div>

      {/* Hémicycle — Assemblée nationale actuelle par parti (données réelles) */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Hemicycle onNavigate={onNavigate} />
      </div>

      {/* Partis + Catégories */}
      <div className="dashboard-2col-grid" style={{ marginBottom: "1.5rem" }}>
        <Card title="Affaires par parti politique (top 12)"
          subtitle="Cliquez sur un parti pour explorer ses affaires">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={topPartis} layout="vertical" margin={{ left: 10, right: 44 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "#71716a" }} axisLine={{ stroke: "#e5e5e0" }} tickLine={false} />
              <YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 11, fill: "#24241f" }} axisLine={{ stroke: "#e5e5e0" }} tickLine={false} />
              <Tooltip content={<ScTooltip />} />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} cursor="pointer"
                onClick={(d) => go({ parti: d.name })}>
                {topPartis.map((p, i) => <Cell key={i} fill={partyColor(p.name)} />)}
                <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: "#71716a" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Catégories d'infractions (top 10)"
          subtitle="Cliquez sur une catégorie pour voir les affaires correspondantes">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={topCats} layout="vertical" margin={{ left: 10, right: 44 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "#71716a" }} axisLine={{ stroke: "#e5e5e0" }} tickLine={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: "#24241f" }} axisLine={{ stroke: "#e5e5e0" }} tickLine={false} />
              <Tooltip content={<ScTooltip />} />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} cursor="pointer"
                onClick={(d) => go({ category: d.name })}>
                {topCats.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: "#71716a" }} />
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
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
                    <span style={{ fontWeight: 500, color: "var(--pg-ink)" }}>{s.name.replace(/_/g, " ")}</span>
                    <span style={{ color: "var(--pg-muted)" }}>{s.value.toLocaleString()} <span>({pct}%)</span></span>
                  </div>
                  <div style={{ background: "var(--color-gray-100)", borderRadius: 5, height: 8 }}>
                    <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 5, transition: "width 0.6s" }} />
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
