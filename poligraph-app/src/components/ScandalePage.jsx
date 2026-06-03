import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import { fetchDashboardScandales } from "../data/api";

const COLORS = [
  "#1a3a6e", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6",
  "#1abc9c", "#e67e22", "#34495e", "#e91e63", "#00bcd4",
];

function toChartData(obj, limit = 15) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

function toTimeData(obj) {
  return Object.entries(obj)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([name, value]) => ({ name, value }));
}

const ScandalePage = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDashboardScandales()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: "red" }}>Erreur : {error}</p>;
  if (!data)  return <p>Chargement...</p>;

  const catData    = toChartData(data.par_categorie);
  const partiData  = toChartData(data.par_parti, 10);
  const statutData = toChartData(data.par_statut);
  const anneeData  = toTimeData(data.par_annee);

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "0.3rem" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(135deg, #1a3a6e 60%, #c9a227 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, color: "#fff", fontWeight: 900, flexShrink: 0,
        }}>⚑</div>
        <div>
          <h2 style={{ marginBottom: "0.1rem", color: "#1a2e5a" }}>Scandales politiques</h2>
          <p style={{ color: "#7a8aaa", margin: 0, fontSize: 13 }}>
            {data.total?.toLocaleString()} scandales analysés
          </p>
        </div>
      </div>
      <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", marginBottom: "1.4rem", marginTop: "0.8rem" }}>
        <div style={{ flex: 1, background: "#002395" }} />
        <div style={{ flex: 1, background: "#fff", border: "1px solid #e0e0e0" }} />
        <div style={{ flex: 1, background: "#ED2939" }} />
      </div>

      {/* Timeline */}
      <section style={sectionStyle}>
        <h3>Évolution par année</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={anneeData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" interval={4} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#1a3a6e" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Catégorie + Parti côte à côte */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        <section style={sectionStyle}>
          <h3>Par catégorie</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={catData} layout="vertical">
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#1a3a6e" />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section style={sectionStyle}>
          <h3>Par parti (top 10)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={partiData} layout="vertical">
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value">
                {partiData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* Statut judiciaire */}
      <section style={sectionStyle}>
        <h3>Statut judiciaire</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "center" }}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statutData} dataKey="value" nameKey="name"
                   cx="50%" cy="50%" outerRadius={110} label={false} labelLine={false}>
                {statutData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(val, name) => [val, name.replace(/_/g, " ")]} />
            </PieChart>
          </ResponsiveContainer>
          <div>
            {statutData.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
                <span style={{ fontSize: 13 }}>{item.name.replace(/_/g, " ")} — <strong>{item.value}</strong></span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

const sectionStyle = {
  background: "#fff",
  borderRadius: 10,
  padding: "1.2rem",
  marginBottom: "1.5rem",
  boxShadow: "0 1px 4px rgba(26,58,110,0.08)",
  border: "1px solid #e8ecf8",
};

export default ScandalePage;
