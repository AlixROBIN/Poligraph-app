import { useState, useEffect, useMemo } from "react";
import { fetchHemicycle } from "../data/api";

// Rangs concentriques de l'hémicycle : rayon + nombre de sièges par rang.
const ROWS = [
  { r: 60,  cap: 14 },
  { r: 92,  cap: 20 },
  { r: 124, cap: 26 },
  { r: 156, cap: 32 },
  { r: 188, cap: 38 },
  { r: 220, cap: 44 },
];
const TOTAL_CAP = ROWS.reduce((s, r) => s + r.cap, 0);
const W = 620, H = 300;
const CX = W / 2, CY = H - 10;

function computeSeats(partis) {
  const totalDeputes = partis.reduce((s, p) => s + p.deputes, 0);
  if (!totalDeputes) return [];

  // Nombre de points affichés par parti, proportionnel à ses député·e·s réel·le·s
  let perParty = partis.map((p) => Math.max(1, Math.round((p.deputes / totalDeputes) * TOTAL_CAP)));
  let flat = [];
  perParty.forEach((n, i) => { for (let k = 0; k < n; k++) flat.push(i); });
  while (flat.length < TOTAL_CAP) flat.push(flat[flat.length - 1] ?? 0);
  flat = flat.slice(0, TOTAL_CAP);

  const seats = [];
  let idx = 0;
  ROWS.forEach((row) => {
    for (let s = 0; s < row.cap; s++) {
      const t = row.cap === 1 ? 0.5 : s / (row.cap - 1);
      const angle = Math.PI - t * Math.PI; // 180° (gauche) → 0° (droite)
      const x = CX + row.r * Math.cos(angle);
      const y = CY - row.r * Math.sin(angle);
      const party = partis[flat[idx++] ?? partis.length - 1];
      seats.push({ x, y, party });
    }
  });
  return seats;
}

export default function Hemicycle({ onNavigate }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    fetchHemicycle().then(setData).catch(() => setError(true));
  }, []);

  const seats = useMemo(() => computeSeats(data?.partis || []), [data]);

  const go = (code) => onNavigate("exploration", { tab: "scandales", parti: code });

  if (error) return null;
  if (!data) return <p style={{ color: "#888", padding: "1rem" }}>Chargement de l'hémicycle...</p>;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#1a2e5a" }}>Assemblée nationale — député·e·s actuel·le·s par parti</h3>
        <span style={{ fontSize: 11, color: "#8b93a7" }}>
          {data.sieges_couverts}/{data.total_sieges} sièges couverts — {data.autres_non_inscrits} non-inscrits ou petits groupes
        </span>
      </div>
      <p style={{ fontSize: 11, color: "#aaa", margin: "0 0 0.75rem" }}>Survolez ou cliquez un point pour explorer ce parti</p>

      <div style={{ position: "relative", height: H, maxWidth: W, margin: "0 auto" }}>
        {seats.map((seat, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(seat.party)}
            onMouseLeave={() => setHover(null)}
            onClick={() => go(seat.party.code)}
            title={`${seat.party.name} — ${seat.party.deputes} député·e·s`}
            style={{
              position: "absolute", left: seat.x, top: seat.y,
              width: 9, height: 9, borderRadius: "50%",
              background: seat.party.color, cursor: "pointer",
              transform: hover === seat.party ? "translate(-50%,-50%) scale(1.6)" : "translate(-50%,-50%)",
              boxShadow: hover === seat.party ? "0 0 0 3px rgba(20,33,61,0.12)" : "none",
              transition: "transform 0.12s, box-shadow 0.12s",
              zIndex: hover === seat.party ? 2 : 1,
            }}
          />
        ))}
        {hover && (
          <div style={{
            position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)",
            background: "#14213d", color: "#fff", padding: "7px 14px", borderRadius: 8,
            fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
            boxShadow: "0 6px 20px rgba(20,33,61,0.25)",
          }}>
            {hover.logoUrl && <img src={hover.logoUrl} alt="" style={{ height: 16, filter: "brightness(0) invert(1)", opacity: 0.9 }} />}
            <span>{hover.name} — <b>{hover.deputes}</b> député·e·s</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, justifyContent: "center" }}>
        {data.partis.map((p) => (
          <div
            key={p.code}
            onClick={() => go(p.code)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px",
              borderRadius: 999, background: "#eef1f6", border: "1px solid #dbe1ee",
              fontSize: 11.5, cursor: "pointer", transition: "border-color 0.12s",
            }}
          >
            {p.logoUrl
              ? <img src={p.logoUrl} alt="" style={{ height: 13, maxWidth: 20, objectFit: "contain" }} />
              : <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, flexShrink: 0 }} />}
            <span>{p.code}</span>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{p.deputes}</b>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 10, marginBottom: 0 }}>
        Élus recensés avec un mandat de député en cours — {data.source}
      </p>
    </div>
  );
}

const cardStyle = {
  background: "#fff", borderRadius: 10, padding: "1.2rem",
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)", border: "1px solid #e8ecf8",
  marginBottom: "1.5rem",
};
