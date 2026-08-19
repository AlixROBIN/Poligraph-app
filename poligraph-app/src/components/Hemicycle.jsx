import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { fetchHemicycle, fetchPartyMembers } from "../data/api";

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

  // Dépliant "premières infos" ouvert au clic sur un point/logo de parti
  const [openParty,       setOpenParty]       = useState(null);
  const [members,         setMembers]         = useState(null);
  const [loadingMembers,  setLoadingMembers]  = useState(false);

  useEffect(() => {
    fetchHemicycle().then(setData).catch(() => setError(true));
  }, []);

  const toggleParty = useCallback((party) => {
    setOpenParty((prev) => {
      if (prev?.code === party.code) return null;
      return party;
    });
  }, []);

  useEffect(() => {
    if (!openParty?.slug) { setMembers(null); return; }
    setMembers(null);
    setLoadingMembers(true);
    fetchPartyMembers(openParty.slug, 6)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [openParty]);

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
      <p style={{ fontSize: 11, color: "var(--pg-muted)", margin: "0 0 0.75rem" }}>Survolez un point pour un aperçu, cliquez pour voir les élus de ce parti</p>

      <div ref={wrapRef} style={{ position: "relative", height, maxWidth: REF_W, margin: "0 auto" }}>
        {seats.map((seat, i) => {
          const active = hover === seat.party || openParty?.code === seat.party.code;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(seat.party)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggleParty(seat.party)}
              style={{
                position: "absolute", left: seat.x, top: seat.y,
                width: dotSize, height: dotSize, borderRadius: "50%",
                background: `color-mix(in srgb, ${seat.party.color} 78%, white)`, cursor: "pointer",
                transform: active ? "translate(-50%,-50%) scale(1.5)" : "translate(-50%,-50%)",
                boxShadow: active ? "0 0 0 3px rgba(36,36,31,0.10)" : "none",
                transition: "transform 0.12s, box-shadow 0.12s",
                zIndex: active ? 2 : 1,
              }}
            />
          );
        })}
        {hover && (
          <div style={{
            position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)",
            background: "var(--pg-ink)", color: "#fff", padding: "7px 14px", borderRadius: 8,
            fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
            boxShadow: "var(--pg-sh-md)",
          }}>
            {hover.logoUrl && <img src={hover.logoUrl} alt="" style={{ height: 16, maxWidth: 60, objectFit: "contain", filter: "brightness(0) invert(1)", opacity: 0.9 }} />}
            <span>{hover.name} — <b>{hover.deputes}</b> député·e·s</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, justifyContent: "center" }}>
        {data.partis.map((p) => {
          const active = hover === p || openParty?.code === p.code;
          return (
            <div
              key={p.code}
              onClick={() => toggleParty(p)}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 11px 5px 9px",
                borderRadius: 999,
                background: `color-mix(in srgb, ${p.color} ${active ? 22 : 12}%, white)`,
                color: `color-mix(in srgb, ${p.color} 65%, black)`,
                fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                boxShadow: active ? `0 0 0 2px color-mix(in srgb, ${p.color} 55%, white)` : "none",
                transition: "background 0.12s, box-shadow 0.12s",
              }}
            >
              {p.logoUrl
                ? <img src={p.logoUrl} alt="" style={{ height: 13, maxWidth: 20, objectFit: "contain" }} />
                : <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, flexShrink: 0 }} />}
              <span>{p.code}</span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{p.deputes}</b>
            </div>
          );
        })}
      </div>

      {/* Dépliant "premières infos" — élus du parti sélectionné */}
      {openParty && (
        <div style={{
          marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--pg-line)",
          animation: "pg-fold-in 0.16s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            {openParty.logoUrl
              ? <img src={openParty.logoUrl} alt="" style={{ height: 18, maxWidth: 30, objectFit: "contain" }} />
              : <span style={{ width: 12, height: 12, borderRadius: "50%", background: openParty.color, flexShrink: 0 }} />}
            <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: "var(--pg-ink)" }}>
              {openParty.name} — {openParty.deputes} député·e·s
            </h4>
            <button onClick={() => setOpenParty(null)} style={{
              marginLeft: "auto", border: "none", background: "none", cursor: "pointer",
              fontSize: 16, color: "var(--pg-muted)", lineHeight: 1, padding: 4,
            }} aria-label="Fermer">✕</button>
          </div>

          {loadingMembers && (
            <p style={{ fontSize: 12, color: "var(--pg-muted)" }}>Chargement des élus…</p>
          )}

          {!loadingMembers && members?.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--pg-muted)", fontStyle: "italic" }}>
              Aucun élu trouvé via l'API pour ce parti.
            </p>
          )}

          {!loadingMembers && members?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {members.map((m) => (
                <div
                  key={m.slug}
                  onClick={() => onNavigate("annuaire", { slug: m.slug })}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px",
                    borderRadius: 999, background: "var(--color-gray-50)",
                    border: "1px solid var(--pg-line)", cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-gray-100)"; e.currentTarget.style.borderColor = openParty.color; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-gray-50)"; e.currentTarget.style.borderColor = "var(--pg-line)"; }}
                >
                  {m.photoUrl
                    ? <img src={m.photoUrl} alt="" style={{
                        width: 28, height: 28, borderRadius: "50%", objectFit: "cover",
                        border: `2px solid ${openParty.color}`,
                      }} />
                    : <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: `color-mix(in srgb, ${openParty.color} 18%, white)`,
                        color: `color-mix(in srgb, ${openParty.color} 65%, black)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 600, border: `2px solid ${openParty.color}`,
                      }}>{m.fullName?.[0]}</div>}
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--pg-ink)" }}>{m.fullName}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => go(openParty.code)}
            style={{
              marginTop: 12, border: "none", background: "none", cursor: "pointer",
              color: "var(--color-blue-600)", fontSize: 12.5, fontWeight: 500, padding: 0,
            }}
          >
            Explorer les scandales de {openParty.code} →
          </button>
        </div>
      )}

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
