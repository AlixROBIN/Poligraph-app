import { useRef, useState, useLayoutEffect, useMemo } from "react";
import { useParties } from "./PartyLogo";

// Sépare les points trop proches (avatars qui se chevauchent) par répulsion
// itérative simple — garde la position lue sur les axes proche de la vraie
// valeur tout en rendant chaque visage/nom lisible individuellement.
function resolveCollisions(points, minDist) {
  const pts = points.map((p) => ({ ...p }));
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < minDist) {
          moved = true;
          const overlap = (minDist - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          a.x -= ux * overlap; a.y -= uy * overlap;
          b.x += ux * overlap; b.y += uy * overlap;
        }
      }
    }
    if (!moved) break;
  }
  return pts;
}

// Nuage de points fiabilité : remplace deux listes séparées par un seul
// graphique lisible sans connaissances politiques préalables — la lecture
// se fait par zone colorée (haut = fiable, bas = pas fiable) et texte en
// clair, pas par des axes chiffrés.
export default function ReliabilityScatter({ items, onClickPolitician }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 420 });
  const byShortName = useParties();

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setSize((s) => ({ ...s, w }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padL = 84, padB = 40, padT = 24, padR = 24;
  const { w: W, h: H } = size;
  const safeItems = items || [];
  const maxFc  = Math.max(...safeItems.map((p) => p.nb_déclarations || 0), 1);
  const scores = safeItems.map((p) => p.net_score || 0);
  const minS = Math.min(...scores, -10), maxS = Math.max(...scores, 10);
  const span = Math.max(maxS - minS, 20);

  const xFor = (fc) => padL + (fc / maxFc) * Math.max(W - padL - padR, 10);
  const yFor = (score) => padT + (1 - (score - minS) / span) * Math.max(H - padT - padB, 10);
  const zeroY = yFor(0);

  const points = useMemo(() => {
    const raw = safeItems.map((p) => ({ item: p, x: xFor(p.nb_déclarations || 0), y: yFor(p.net_score || 0) }));
    return W > 0 ? resolveCollisions(raw, 66) : raw;
  }, [safeItems, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items || items.length === 0) return null;

  return (
    <div style={{
      background: "#fff", borderRadius: 18, padding: "1.4rem",
      boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8",
    }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#1a2e5a" }}>Fiabilité des politiciens</h3>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "#aaa" }}>
        Plus un visage est haut, plus ses déclarations vérifiées se sont révélées vraies.
      </p>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16,
        background: "#f4f6fb", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: "#1a2e5a",
      }}>
        <span>🟢 En haut = plutôt fiable</span>
        <span>🔴 En bas = plutôt pas fiable</span>
        <span>👉 À droite = beaucoup de déclarations vérifiées (donnée plus solide)</span>
        <span>👈 À gauche = peu de déclarations (à prendre avec recul)</span>
      </div>

      <div ref={wrapRef} style={{ position: "relative", height: 420 }}>
        {W > 0 && (
          <>
            <div style={{
              position: "absolute", left: padL, right: 0, top: padT, height: (zeroY - padT),
              background: "linear-gradient(to bottom, rgba(39,174,96,0.10), rgba(39,174,96,0))",
              borderRadius: 8, pointerEvents: "none",
            }} />
            <div style={{
              position: "absolute", left: padL, right: 0, top: zeroY, bottom: padB,
              background: "linear-gradient(to top, rgba(231,76,60,0.10), rgba(231,76,60,0))",
              borderRadius: 8, pointerEvents: "none",
            }} />
            <span style={{ position: "absolute", left: padL + 8, top: padT + 6, fontSize: 10.5, fontWeight: 700, color: "#1a7a4a" }}>🟢 Plutôt fiable</span>
            <span style={{ position: "absolute", left: padL + 8, bottom: padB + 6, fontSize: 10.5, fontWeight: 700, color: "#c0392b" }}>🔴 Plutôt pas fiable</span>

            <div style={{ position: "absolute", left: 0, top: 0, bottom: padB, width: 1, background: "#e8ecf8" }} />
            <div style={{ position: "absolute", left: padL, right: 0, bottom: padB, height: 1, background: "#e8ecf8" }} />
            <div style={{ position: "absolute", left: padL, right: 0, top: zeroY, height: 1, borderTop: "1px dashed #aab", opacity: 0.6 }} />
            {[["Très fiable", maxS], ["Neutre", 0], ["Peu fiable", minS]].map(([txt, s]) => (
              <div key={txt} style={{
                position: "absolute", left: 0, width: 74, textAlign: "right",
                top: yFor(s), transform: "translateY(-50%)", fontSize: 10.5, fontWeight: 600, color: "#8b93a7",
              }}>{txt}</div>
            ))}
            <div style={{
              position: "absolute", left: padL, right: 0, bottom: 12, textAlign: "center",
              fontSize: 10.5, fontWeight: 700, color: "#8b93a7", textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              ← peu de vérifications&nbsp;&nbsp;&nbsp;&nbsp;beaucoup de vérifications →
            </div>

            {points.map(({ item: p, x, y }, i) => {
              const color = byShortName?.[p.party]?.color || "#5b6b85";
              return (
                <div key={p.slug || i}
                  onClick={() => onClickPolitician && onClickPolitician(p)}
                  className="reliability-point"
                  style={{
                    position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    cursor: onClickPolitician ? "pointer" : "default",
                  }}
                  title={`${p.name} — ${p.net_score > 0 ? "+" : ""}${p.net_score} (${p.nb_déclarations} déclarations vérifiées)`}
                >
                  {p.photoUrl
                    ? <img src={p.photoUrl} alt={p.name} style={{
                        width: 42, height: 42, borderRadius: "50%", objectFit: "cover",
                        border: `3px solid ${color}`, boxShadow: "0 1px 3px rgba(0,0,0,0.15)", background: "#eee",
                      }} />
                    : <div style={{
                        width: 42, height: 42, borderRadius: "50%", border: `3px solid ${color}`,
                        background: color + "22", color, display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 800, fontSize: 14,
                      }}>{p.name?.[0]}</div>}
                  <span style={{ fontSize: 9.5, color: "#666", whiteSpace: "nowrap" }}>
                    {p.name?.split(" ").slice(-1)[0]}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
      <style>{`.reliability-point img, .reliability-point div { transition: transform .15s, box-shadow .15s; }
        .reliability-point:hover img, .reliability-point:hover > div:first-child { transform: scale(1.18); z-index: 5; }`}</style>
    </div>
  );
}
