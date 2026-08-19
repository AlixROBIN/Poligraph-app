import { useState, useEffect } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { fetchDashboardVotes } from "../data/api";

const BASE = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";


function toTime(obj) {
  return Object.entries(obj || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([name, value]) => ({ name, value }));
}

const Card = ({ title, subtitle, children, accent }) => (
  <div style={{
    background: "#fff", borderRadius: 12, padding: "1.4rem",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8",
    borderTop: accent ? `3px solid ${accent}` : undefined,
  }}>
    <h3 style={{ margin: "0 0 0.2rem", fontSize: 15, color: "#1a2e5a" }}>{title}</h3>
    {subtitle && <p style={{ margin: "0 0 1rem", fontSize: 11, color: "#aaa" }}>{subtitle}</p>}
    <div style={{ marginTop: subtitle ? 0 : "1rem" }}>{children}</div>
  </div>
);



const VtTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a2e5a", color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div>{payload[0].value?.toLocaleString()} scrutins</div>
    </div>
  );
};

// ─── Matrice parti × thème (source unique) ──────────────────────────────────
// Un élu représentatif par parti → 100 votes récents → classification thématique.
async function fetchPartyMatrix() {
  const res = await fetch(`${BASE}/proxy/party-matrix?limit=500`);
  if (!res.ok) return null;
  return res.json();
}

// Convertit la matrice parti en liste de groupes pour le bar chart
function partyMatrixToGroupes(matrix) {
  const out = Object.entries(matrix).map(([short, d]) => {
    const pour       = Object.values(d.themes).reduce((s, t) => s + (t.pour       || 0), 0);
    const contre     = Object.values(d.themes).reduce((s, t) => s + (t.contre     || 0), 0);
    const abstention = Object.values(d.themes).reduce((s, t) => s + (t.abstention || 0), 0);
    const total = pour + contre + abstention;
    return {
      name: short, color: d.color, pour, contre, abstention, nonVotant: 0, total,
      taux_pour:       total > 0 ? Math.round(pour       / total * 100) : 0,
      taux_contre:     total > 0 ? Math.round(contre     / total * 100) : 0,
      taux_abstention: total > 0 ? Math.round(abstention / total * 100) : 0,
      taux_absent:     0,
    };
  }).filter(g => g.total > 0).sort((a, b) => b.total - a.total);
  return { groupes: out, scrutins_analysed: 100 };
}

// Convertit la matrice parti en {thème: {partiShort: {pour,contre,abstention,color}}}
function partyMatrixToThemeGroups(matrix) {
  const acc = {};
  for (const [short, d] of Object.entries(matrix)) {
    for (const [theme, t] of Object.entries(d.themes)) {
      if (!acc[theme]) acc[theme] = {};
      acc[theme][short] = { pour: t.pour, contre: t.contre, abstention: t.abstention, color: d.color };
    }
  }
  return acc;
}

const ANALYSIS_THEMES = [
  "Agriculture", "Social & Santé", "Économie & Budget", "Sécurité & Justice",
  "Environnement", "Institutions", "Europe & Intl.", "Éducation & Culture",
];

// ─── Composant principal ──────────────────────────────────────────────────────
export default function VotesDashboard({ onNavigate }) {
  const [data,        setData]        = useState(null);
  const [groupes,     setGroupes]     = useState(null);
  const [themeGroups, setThemeGroups] = useState(null);
  const [loadingG,    setLoadingG]    = useState(true);
  const [loadingTG,   setLoadingTG]   = useState(true);
  const [err,         setErr]         = useState(null);

  useEffect(() => {
    fetchDashboardVotes().then(setData).catch(e => setErr(e.message));
    fetchPartyMatrix()
      .then(matrix => {
        if (!matrix) { setGroupes({ groupes: [], scrutins_analysed: 0 }); setThemeGroups({}); return; }
        setGroupes(partyMatrixToGroupes(matrix));
        setThemeGroups(partyMatrixToThemeGroups(matrix));
      })
      .catch(() => { setGroupes({ groupes: [], scrutins_analysed: 0 }); setThemeGroups({}); })
      .finally(() => { setLoadingG(false); setLoadingTG(false); });
  }, []);

  if (err)  return <p style={{ color: "red", padding: "2rem" }}>Erreur : {err}</p>;
  if (!data) return <p style={{ padding: "2rem" }}>Chargement…</p>;

  const timeline = toTime(data.par_annee);

  const themes    = Object.entries(data.par_theme || {})
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, d]) => ({ name, ...d }));

  const groupList = (groupes?.groupes || []).slice(0, 12);

  const go = (filters) => onNavigate("exploration", { tab: "votes", ...filters });

  return (
    <div style={{ padding: "1.5rem", background: "transparent", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0d1b3e 0%, #1a3a6e 60%, #2980b9 100%)",
        borderRadius: 14, padding: "1.8rem 2rem", marginBottom: "1.5rem", color: "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 36 }}>🗳</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Votes parlementaires</h2>
            <p style={{ margin: "0.3rem 0 0", opacity: 0.85, fontSize: 13 }}>
              Analyse par thème, par groupe politique et marges — Assemblée nationale
            </p>
          </div>
          <button onClick={() => go({})} style={{
            marginLeft: "auto", background: "rgba(255,255,255,0.2)",
            border: "1px solid rgba(255,255,255,0.4)", color: "#fff",
            borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}>
            Explorer les votes →
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Card title="Évolution des scrutins par année"
          subtitle="Cliquez sur un point pour voir tous les votes de cette année">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeline} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="vtGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#1a3a6e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#1a3a6e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<VtTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#1a3a6e" strokeWidth={2.5}
                fill="url(#vtGrad)" dot={{ r: 3, fill: "#1a3a6e" }}
                activeDot={{
                  r: 7, fill: "#c9a227", cursor: "pointer",
                  onClick: (_, p) => go({ annee: Number(p.payload.name) }),
                }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Thèmes */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Card title="Votes par thème législatif"
          subtitle="Cliquez sur un thème pour l'explorer — taux d'adoption par domaine"
          accent="#c9a227">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {themes.map((t) => {
              const clickable = t.name !== "Autres";
              return (
                <div key={t.name}
                  className="row-grid-a"
                  onClick={() => clickable && go({ theme: t.name })}
                  style={{
                    alignItems: "center", gap: 12,
                    padding: "8px 10px", borderRadius: 8, cursor: clickable ? "pointer" : "default",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (clickable) e.currentTarget.style.background = "#f0f4ff"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2e5a" }}>
                    {t.name}
                    {clickable && <span style={{ fontSize: 10, color: "#1a3a6e", marginLeft: 4, opacity: 0.5 }}>→</span>}
                  </div>
                  <div style={{ position: "relative", height: 18, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      width: `${t.taux}%`, height: "100%",
                      background: t.taux >= 50 ? "#27ae60" : "#e74c3c",
                      borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 8,
                    }}>
                      {t.taux >= 12 && (
                        <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{t.taux}% adoptés</span>
                      )}
                    </div>
                    {t.taux < 12 && (
                      <span style={{ position: "absolute", left: `calc(${t.taux}% + 6px)`, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#555" }}>
                        {t.taux}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", textAlign: "right" }}>
                    {t.total.toLocaleString()} votes
                  </div>
                  <div style={{ fontSize: 11, textAlign: "right" }}>
                    <span style={{ color: "#27ae60", fontWeight: 600 }}>{t.adopted.toLocaleString()}</span>
                    <span style={{ color: "#ddd" }}> / </span>
                    <span style={{ color: "#e74c3c" }}>{t.rejected.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#aaa", borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
            Classification automatique par mots-clés du titre — seul le premier thème détecté est retenu.
          </div>
        </Card>
      </div>


      {/* Par groupe parlementaire */}
      <Card title="Vote par parti politique"
        subtitle={
          loadingG
            ? "Chargement — 100 votes récents par parti…"
            : groupes?.groupes?.length > 0
              ? `Agrégé sur ~100 votes récents par élu représentatif — cliquez un parti pour explorer`
              : "Positionnement par parti"
        }
        accent="#1a3a6e">

        {loadingG ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#aaa", fontSize: 13, padding: "1rem 0" }}>
            <div style={{
              width: 16, height: 16, border: "2px solid #1a3a6e", borderTopColor: "transparent",
              borderRadius: "50%", animation: "spin 0.8s linear infinite",
            }} />
            Récupération de ~500 votes par parti (8 partis en parallèle)…
          </div>
        ) : groupList.length === 0 ? (
          <p style={{ color: "#aaa", fontSize: 13, fontStyle: "italic" }}>
            Aucune donnée par groupe disponible pour les scrutins récents.
          </p>
        ) : (
          <>
            {/* Légende */}
            <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 11, color: "#555" }}>
              {[["✓ Pour", "#27ae60"], ["✗ Contre", "#e74c3c"], ["~ Abstention", "#f39c12"], ["○ Absent", "#ccc"]].map(([l, c]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {groupList.map((g, i) => (
                <div key={i}
                  className="row-grid-b"
                  onClick={() => go({ q: g.name })}
                  style={{
                    alignItems: "center", gap: 10,
                    padding: "6px 8px", borderRadius: 8, cursor: "pointer",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0f4ff"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: g.color || "#1a3a6e",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }} title={g.name}>{g.name}</div>

                  <div style={{ height: 20, borderRadius: 4, overflow: "hidden", display: "flex", background: "#f0f0f0" }}>
                    {g.taux_pour > 0 && (
                      <div style={{ width: `${g.taux_pour}%`, background: "#27ae60", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {g.taux_pour > 8 && <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{g.taux_pour}%</span>}
                      </div>
                    )}
                    {g.taux_contre > 0 && (
                      <div style={{ width: `${g.taux_contre}%`, background: "#e74c3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {g.taux_contre > 8 && <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{g.taux_contre}%</span>}
                      </div>
                    )}
                    {g.taux_abstention > 0 && (
                      <div style={{ width: `${g.taux_abstention}%`, background: "#f39c12", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {g.taux_abstention > 8 && <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{g.taux_abstention}%</span>}
                      </div>
                    )}
                    {g.taux_absent > 0 && (
                      <div style={{ width: `${g.taux_absent}%`, background: "#ddd" }} />
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: "#555", textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#27ae60", fontWeight: 600 }}>{g.pour.toLocaleString()} ✓</span>
                    {" · "}
                    <span style={{ color: "#e74c3c", fontWeight: 600 }}>{g.contre.toLocaleString()} ✗</span>
                    {g.abstention > 0 && <span style={{ color: "#f39c12" }}> · {g.abstention.toLocaleString()}</span>}
                    {g.nonVotant  > 0 && <span style={{ color: "#aaa" }}> · {g.nonVotant.toLocaleString()} abs.</span>}
                  </div>
                </div>
              ))}
            </div>

          </>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Card>

      {/* ── Matrice positionnement politique ────────────────────────────────── */}
      <div style={{ marginTop: "1.5rem" }}>
        <Card
          title="Positionnement politique par thème législatif"
          subtitle="% de votes 'pour' par parti selon le domaine de loi — vert = majoritairement pour, rouge = majoritairement contre. Basé sur les votes de représentants de chaque parti."
          accent="#9b59b6">

          {loadingTG && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#aaa", fontSize: 13, padding: "0.5rem 0" }}>
              <div style={{
                width: 16, height: 16, border: "2px solid #9b59b6", borderTopColor: "transparent",
                borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0,
              }} />
              Chargement de la matrice parti × thème (peut prendre ~15s)…
            </div>
          )}

          {!loadingTG && themeGroups && (() => {
            const themes = ANALYSIS_THEMES.filter(t => themeGroups[t] && Object.keys(themeGroups[t]).length > 0);
            if (!themes.length) return (
              <p style={{ color: "#aaa", fontSize: 13, fontStyle: "italic" }}>
                Données insuffisantes — impossible de charger le positionnement par parti.
              </p>
            );

            // Top groupes par total de votes exprimés
            const groupTotals = {};
            const groupColors = {};
            for (const t of themes) {
              for (const [name, d] of Object.entries(themeGroups[t])) {
                groupTotals[name] = (groupTotals[name] || 0) + d.pour + d.contre + d.abstention;
                groupColors[name] = d.color;
              }
            }
            const topGroups = Object.entries(groupTotals)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 9)
              .map(([name]) => name);

            return (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "separate", borderSpacing: "3px", minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "6px 10px", fontSize: 11, color: "#888", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" }}>
                        Thème \ Parti →
                      </th>
                      {topGroups.map(g => (
                        <th key={g}
                          onClick={() => go({ q: g })}
                          title={`Explorer les votes où ${g} a participé`}
                          style={{
                            padding: "6px 10px", fontSize: 11, fontWeight: 800,
                            color: groupColors[g] || "#1a3a6e", textAlign: "center",
                            cursor: "pointer", whiteSpace: "nowrap",
                          }}>
                          {g}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {themes.map(theme => (
                      <tr key={theme}>
                        <td
                          onClick={() => go({ theme })}
                          title={`Explorer les votes ${theme}`}
                          style={{
                            padding: "7px 10px", fontSize: 12, fontWeight: 700, color: "#333",
                            whiteSpace: "nowrap", cursor: "pointer", borderRadius: 4,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = "#f0f0f8"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          {theme}
                        </td>
                        {topGroups.map(gName => {
                          const d = themeGroups[theme]?.[gName];
                          if (!d) return (
                            <td key={gName} style={{
                              padding: "7px 8px", textAlign: "center", fontSize: 12, color: "#ccc",
                              background: "#f8f8f8", borderRadius: 4,
                            }}>—</td>
                          );
                          const tot = d.pour + d.contre + d.abstention;
                          const pctPour = tot > 0 ? Math.round(d.pour / tot * 100) : 0;
                          const pctCon  = tot > 0 ? Math.round(d.contre / tot * 100) : 0;
                          // 0%=rouge, 50%=jaune, 100%=vert
                          const hue = Math.min(120, pctPour * 1.2);
                          return (
                            <td key={gName}
                              title={`${gName} — ${theme}\n${pctPour}% pour · ${pctCon}% contre · ${tot} votes exprimés`}
                              style={{
                                padding: "7px 8px", textAlign: "center",
                                fontSize: 12, fontWeight: 800,
                                background: `hsl(${hue}, 65%, 88%)`,
                                color: `hsl(${hue}, 65%, 25%)`,
                                borderRadius: 4, minWidth: 44,
                              }}>
                              {pctPour}%
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 10, fontSize: 11, color: "#aaa" }}>
                  Basé sur ~500 votes récents par élu représentatif (Marine Le Pen/RN, Manuel Bompard/LFI, Gabriel Attal/RE, etc.).
                  Valeurs parmi les votes exprimés (pour + contre + abstention). Cliquez parti ou thème pour explorer.
                </div>
              </div>
            );
          })()}
        </Card>
      </div>
    </div>
  );
}
