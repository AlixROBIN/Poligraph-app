import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { fetchHemicycle } from "../data/api";

// Rangs concentriques de l'hémicycle : rayon + nombre de sièges par rang,
// exprimés dans un système de référence 620×300 — mis à l'échelle au
// rendu selon la largeur réelle du conteneur (voir useLayoutEffect plus
// bas) pour ne jamais déborder sur mobile.
const ROWS = [
  { r: 64,  cap: 12 },
  { r: 100, cap: 17 },
  { r: 136, cap: 22 },
  { r: 172, cap: 27 },
  { r: 208, cap: 32 },
  { r: 244, cap: 37 },
];
const TOTAL_CAP = ROWS.reduce((s, r) => s + r.cap, 0);
const REF_W = 620, REF_H = 300;
const REF_CX = REF_W / 2, REF_CY = REF_H - 10;

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
      const x = REF_CX + row.r * Math.cos(angle);
      const y = REF_CY - row.r * Math.sin(angle);
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
  const [width, setWidth] = useState(0);
  const roRef = useRef(null);

  useEffect(() => {
    fetchHemicycle().then(setData).catch(() => setError(true));
  }, []);

  // Ref en callback plutôt qu'un useLayoutEffect(deps:[]) classique : le
  // conteneur n'existe pas encore lors du tout premier rendu (état
  // "Chargement...") donc un effet à montage unique manquerait le nœud DOM
  // réel une fois les données arrivées. Le callback ref, lui, se déclenche
  // à chaque fois que le nœud apparaît, peu importe le rendu conditionnel.
  const wrapRef = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (el) {
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (w) setWidth(w);
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  const refSeats = useMemo(() => computeSeats(data?.partis || []), [data]);

  // Mise à l'échelle : le conteneur peut être plus étroit que REF_W (mobile,
  // carte en colonne) — on réduit tout proportionnellement plutôt que de
  // laisser les points déborder du cadre.
  const scale  = width > 0 ? Math.min(width / REF_W, 1) : 1;
  const height = REF_H * scale;
  const seats  = refSeats.map((s) => ({ ...s, x: s.x * scale, y: s.y * scale }));
  const dotSize = Math.max(7, 11 * scale);

  const go = (code) => onNavigate("exploration", { tab: "scandales", parti: code });

  if (error) return null;
  if (!data) return <p style={{ color: "#888", padding: "1rem" }}>Chargement de l'hémicycle...</p>;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 500, color: "var(--pg-ink)" }}>Assemblée nationale — député·e·s actuel·le·s par parti</h3>
        <span style={{ fontSize: 11, color: "var(--pg-muted)" }}>
          {data.sieges_couverts}/{data.total_sieges} sièges couverts — {data.autres_non_inscrits} non-inscrits ou petits groupes
        </span>
      </div>
      <p style={{ fontSize: 11, color: "var(--pg-muted)", margin: "0 0 0.75rem" }}>Survolez ou cliquez un point pour explorer ce parti</p>

      <div ref={wrapRef} style={{ position: "relative", height, maxWidth: REF_W, margin: "0 auto" }}>
        {seats.map((seat, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(seat.party)}
            onMouseLeave={() => setHover(null)}
            onClick={() => go(seat.party.code)}
            title={`${seat.party.name} — ${seat.party.deputes} député·e·s`}
            style={{
              position: "absolute", left: seat.x, top: seat.y,
              width: dotSize, height: dotSize, borderRadius: "50%",
              background: `color-mix(in srgb, ${seat.party.color} 78%, white)`, cursor: "pointer",
              transform: hover === seat.party ? "translate(-50%,-50%) scale(1.5)" : "translate(-50%,-50%)",
              boxShadow: hover === seat.party ? "0 0 0 3px rgba(36,36,31,0.10)" : "none",
              transition: "transform 0.12s, box-shadow 0.12s",
              zIndex: hover === seat.party ? 2 : 1,
            }}
          />
        ))}
        {hover && (
          <div style={{
            position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)",
            background: "var(--pg-ink)", color: "#fff", padding: "7px 14px", borderRadius: 8,
            fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
            boxShadow: "var(--pg-sh-md)",
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
              display: "flex", alignItems: "center", gap: 6, padding: "5px 11px 5px 9px",
              borderRadius: 999,
              background: `color-mix(in srgb, ${p.color} 12%, white)`,
              color: `color-mix(in srgb, ${p.color} 65%, black)`,
              fontSize: 11.5, fontWeight: 500, cursor: "pointer", transition: "filter 0.12s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(0.97)"}
            onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
          >
            {p.logoUrl
              ? <img src={p.logoUrl} alt="" style={{ height: 13, maxWidth: 20, objectFit: "contain" }} />
              : <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, flexShrink: 0 }} />}
            <span>{p.code}</span>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{p.deputes}</b>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 10, color: "var(--pg-muted)", textAlign: "center", marginTop: 10, marginBottom: 0 }}>
        Élus recensés avec un mandat de député en cours — {data.source}
      </p>
    </div>
  );
}

const cardStyle = {
  background: "var(--pg-surface)", borderRadius: "var(--pg-r-md)", padding: "1.4rem",
  border: "1px solid var(--pg-line)",
  marginBottom: "1.5rem",
};
