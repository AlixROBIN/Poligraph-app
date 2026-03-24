import React, { useState, useEffect } from "react";
import { fetchData } from "../data/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const ExplorationPage = () => {
  const [rows, setRows] = useState([]);
  const [col, setCol] = useState("");
  const [data, setData] = useState([]);

  useEffect(() => {
    fetchData(200, 0).then((r) => {
      setRows(r);
      if (r.length > 0) setCol(Object.keys(r[0])[0]);
    });
  }, []);

  useEffect(() => {
    if (!col || !rows.length) return;
    const counts = {};
    rows.forEach((row) => {
      const v = row[col] ?? "undefined";
      counts[v] = (counts[v] || 0) + 1;
    });
    setData(Object.entries(counts).map(([name, value]) => ({ name, value })).slice(0, 20));
  }, [col, rows]);

  return (
    <div>
      <h2>Exploration</h2>
      <div>
        <label>Colonne : </label>
        <select value={col} onChange={(e) => setCol(e.target.value)}>
          {rows.length > 0 && Object.keys(rows[0]).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ height: 420, marginTop: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={90}/>
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#3468f2" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ExplorationPage;