import { useState, useEffect, useCallback } from "react";

const BASE_URL     = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";
const PROXY_URL    = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api/proxy";

// Infobulles pour novices
const GLOSSARY = {
  scrutin:    "Un scrutin est un vote officiel à l'Assemblée nationale ou au Sénat. Les députés votent pour ou contre un texte de loi.",
  adopte:     "Le texte de loi a été approuvé par la majorité des votants. Il peut devenir loi.",
  rejete:     "Le texte de loi a été rejeté. Il ne peut pas entrer en vigueur.",
  groupe:     "Un groupe parlementaire est un ensemble de députés partageant les mêmes idées politiques (ex: RN, LFI, Renaissance…).",
  abstention: "Un élu qui s'abstient ne vote ni pour ni contre. Cela peut signifier une position neutre ou un désaccord partiel.",
  statut:     "Le statut judiciaire indique où en est l'affaire devant la justice (en cours d'enquête, condamné, acquitté…).",
  categorie:  "La catégorie décrit le type d'infraction reprochée à l'élu (corruption, détournement de fonds, abus de biens sociaux…).",
};

const Tip = ({ term }) => {
  const text = GLOSSARY[term];
  if (!text) return null;
  return (
    <span title={text} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 14, height: 14, borderRadius: "50%", background: "#e8ecf8",
      color: "#1a3a6e", fontSize: 9, fontWeight: 700, cursor: "help",
      marginLeft: 4, flexShrink: 0,
    }}>?</span>
  );
};

async function fetchFilters() {
  const res = await fetch(`${BASE_URL}/search/filters`);
  return res.json();
}

async function fetchScandales(params) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== 0))
  ).toString();
  const res = await fetch(`${BASE_URL}/search/scandales?${qs}`);
  return res.json();
}

async function fetchVotes(params) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== 0))
  ).toString();
  const res = await fetch(`${BASE_URL}/search/votes?${qs}`);
  return res.json();
}

const LIMIT = 15;

// ---- Détail scandale ----
const ScandalDetail = ({ row, onClose }) => (
  <div style={detailStyle}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <h4 style={{ margin: 0, fontSize: 15, color: "#1a2e5a" }}>{row.title}</h4>
      <button onClick={onClose} style={closeBtnStyle}>×</button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 2rem", marginTop: 12, fontSize: 13 }}>
      {[
        ["Élu",         row.politician_name || "—"],
        ["Parti",       row.party_short     || "—"],
        ["Catégorie",   row.category?.replace(/_/g, " ") || "—"],
        ["Statut",      row.status?.replace(/_/g, " ")   || "—"],
        ["Institution", row.institution     || "—"],
        ["Année",       row.annee_faits     || "—"],
        ["Peine",       row.sentence        || "—"],
        ["Appel",       row.appeal          || "—"],
      ].map(([k, v]) => (
        <div key={k}><span style={{ color: "#888" }}>{k} : </span><strong>{v}</strong></div>
      ))}
    </div>
    {row.description && (
      <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, color: "#333", borderTop: "1px solid #d4ddf7", paddingTop: 10 }}>
        {row.description}
      </div>
    )}
  </div>
);

// ---- Détail vote ----
const VoteDetail = ({ row, onClose }) => {
  const [groupes, setGroupes] = useState(null);

  useEffect(() => {
    if (row.scrutinRef) {
      fetch(`${PROXY_URL}/scrutins/${row.scrutinRef}/groupes`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => setGroupes(d?.groupes || []))
        .catch(() => setGroupes([]));
    }
  }, [row.scrutinRef]);

  const total = Number(row.totalVotes) || (Number(row.votesFor) + Number(row.votesAgainst) + Number(row.votesAbstain)) || 1;
  const pctFor     = Math.round((Number(row.votesFor)     / total) * 100);
  const pctAgainst = Math.round((Number(row.votesAgainst) / total) * 100);
  const pctAbstain = Math.round((Number(row.votesAbstain) / total) * 100);
  const adopted = row.result === "ADOPTED";

  return (
    <div style={{ ...detailStyle, borderTopColor: adopted ? "#2ecc71" : "#e74c3c" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{
              padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700,
              background: adopted ? "#d4f7e8" : "#fde8e8",
              color: adopted ? "#1a7a4a" : "#c0392b",
            }}>
              {adopted ? "✓ ADOPTÉ" : "✗ REJETÉ"}
            </span>
            {row.legislature && (
              <span style={{ fontSize: 11, color: "#888", background: "#f0f0f0", padding: "2px 8px", borderRadius: 10 }}>
                {row.legislature}e législature
              </span>
            )}
            {row.annee_vote && (
              <span style={{ fontSize: 11, color: "#888" }}>{row.annee_vote}</span>
            )}
          </div>
          <h4 style={{ margin: 0, fontSize: 14, color: "#1a2e5a", lineHeight: 1.4 }}>{row.title}</h4>
        </div>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      {/* Barre de vote globale */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden", gap: 2 }}>
          {pctFor > 0 && (
            <div style={{ width: `${pctFor}%`, background: "#2ecc71", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{pctFor > 5 ? `${pctFor}%` : ""}</span>
            </div>
          )}
          {pctAgainst > 0 && (
            <div style={{ width: `${pctAgainst}%`, background: "#e74c3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{pctAgainst > 5 ? `${pctAgainst}%` : ""}</span>
            </div>
          )}
          {pctAbstain > 0 && (
            <div style={{ width: `${pctAbstain}%`, background: "#f39c12", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{pctAbstain > 5 ? `${pctAbstain}%` : ""}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#2ecc71", display: "inline-block" }} />
            <span style={{ color: "#555" }}>Pour : </span><strong>{row.votesFor || 0}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e74c3c", display: "inline-block" }} />
            <span style={{ color: "#555" }}>Contre : </span><strong>{row.votesAgainst || 0}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f39c12", display: "inline-block" }} />
            <span style={{ color: "#555" }}>Abstention : </span><strong>{row.votesAbstain || 0}</strong>
          </div>
          <div style={{ color: "#888", marginLeft: "auto", fontSize: 12 }}>
            Total : <strong>{row.totalVotes || total}</strong> votants
          </div>
        </div>
      </div>

      {/* Détail par groupe parlementaire */}
      {groupes && groupes.length > 0 && (
        <div style={{ marginTop: 16, borderTop: "1px solid #e8ecf8", paddingTop: 12 }}>
          <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: "#1a2e5a" }}>
            Vote par groupe parlementaire <Tip term="groupe" />
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {groupes.map((g, i) => {
              const gTotal = (g.pour || 0) + (g.contre || 0) + (g.abstention || 0);
              const gPct   = gTotal > 0 ? Math.round(((g.pour || 0) / gTotal) * 100) : 0;
              const gColor = g.color || "#1a3a6e";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <div style={{ width: 80, fontWeight: 600, color: gColor, flexShrink: 0,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    title={g.name}>
                    {g.shortName || g.name}
                  </div>
                  <div style={{ flex: 1, height: 12, borderRadius: 3, overflow: "hidden",
                    display: "flex", gap: 1, background: "#f0f0f0" }}>
                    {g.pour    > 0 && <div style={{ width: `${Math.round((g.pour    / gTotal)*100)}%`, background: "#2ecc71" }} />}
                    {g.contre  > 0 && <div style={{ width: `${Math.round((g.contre  / gTotal)*100)}%`, background: "#e74c3c" }} />}
                    {g.abstention > 0 && <div style={{ width: `${Math.round((g.abstention / gTotal)*100)}%`, background: "#f39c12" }} />}
                  </div>
                  <div style={{ fontSize: 11, color: "#555", flexShrink: 0, minWidth: 140, textAlign: "right" }}>
                    <span style={{ color: "#27ae60" }}>{g.pour || 0} pour</span>
                    {" · "}
                    <span style={{ color: "#e74c3c" }}>{g.contre || 0} contre</span>
                    {g.abstention > 0 && <span style={{ color: "#f39c12" }}> · {g.abstention} abs.</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {row.sourceUrl && (
        <div style={{ marginTop: 12, borderTop: "1px solid #d4ddf7", paddingTop: 10 }}>
          <a href={row.sourceUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: "#1a3a6e", textDecoration: "underline" }}>
            → Voir sur le site officiel de l'Assemblée nationale
          </a>
        </div>
      )}
    </div>
  );
};

// ---- Scandales ----
const ScandalSearch = ({ filters, initial = {} }) => {
  const [q, setQ]           = useState(initial.q        || "");
  const [category, setCat]  = useState(initial.category || "");
  const [parti, setParti]   = useState(initial.parti    || "");
  const [statut, setStatut] = useState(initial.statut   || "");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const search = useCallback(async (off = 0) => {
    setLoading(true);
    setSelected(null);
    const data = await fetchScandales({ q, category, parti, statut, limit: LIMIT, offset: off });
    setResult(data);
    setOffset(off);
    setLoading(false);
  }, [q, category, parti, statut]);

  useEffect(() => { search(0); }, [search]);

  return (
    <div>
      <div style={filterRowStyle}>
        <input style={inputStyle} placeholder="Recherche (titre, description, élu...)"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search(0)} />
        <select style={selectStyle} value={category} onChange={(e) => { setCat(e.target.value); search(0); }}>
          <option value="">Toutes catégories</option>
          {filters.categories?.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select style={selectStyle} value={parti} onChange={(e) => { setParti(e.target.value); search(0); }}>
          <option value="">Tous partis</option>
          {filters.partis?.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select style={selectStyle} value={statut} onChange={(e) => { setStatut(e.target.value); search(0); }}>
          <option value="">Tous statuts</option>
          {filters.statuts?.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button style={btnStyle} onClick={() => search(0)}>Rechercher</button>
      </div>

      {loading && <p style={{ color: "#888" }}>Chargement...</p>}
      {result && (
        <>
          <p style={{ color: "#666", marginBottom: 8, fontSize: 13 }}>
            {result.total} résultat{result.total > 1 ? "s" : ""} — cliquez sur une ligne pour le détail
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {[
                    ["Titre", null], ["Catégorie", "categorie"], ["Statut", "statut"],
                    ["Élu", null], ["Parti", null], ["Année", null]
                  ].map(([h, tip]) => (
                    <th key={h} style={thStyle}>
                      {h}{tip && <Tip term={tip} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.map((row, i) => {
                  const isSelected = selected === i;
                  return (
                    <>
                      <tr key={i}
                        onClick={() => setSelected(isSelected ? null : i)}
                        style={{
                          background: isSelected ? "#eef2ff" : i % 2 === 0 ? "#fff" : "#f9fafc",
                          cursor: "pointer",
                          borderLeft: isSelected ? "3px solid #1a3a6e" : "3px solid transparent",
                        }}>
                        <td style={{ ...tdStyle, maxWidth: 280 }} title={row.title}>
                          {row.title?.slice(0, 60)}{row.title?.length > 60 ? "…" : ""}
                        </td>
                        <td style={tdStyle}><Badge text={row.category} /></td>
                        <td style={tdStyle}><span style={{ fontSize: 11 }}>{row.status?.replace(/_/g, " ")}</span></td>
                        <td style={tdStyle}>{row.politician_name}</td>
                        <td style={tdStyle}><strong>{row.party_short}</strong></td>
                        <td style={tdStyle}>{row.annee_faits || "—"}</td>
                      </tr>
                      {isSelected && (
                        <tr key={`detail-${i}`}>
                          <td colSpan={6} style={{ padding: 0 }}>
                            <ScandalDetail row={row} onClose={() => setSelected(null)} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={result.total} offset={offset} limit={LIMIT} onChange={search} />
        </>
      )}
    </div>
  );
};

// ---- Votes ----
const VoteSearch = ({ filters, initial = {} }) => {
  const [q, setQ]           = useState(initial.q      || "");
  const [result_, setRes]   = useState(initial.result || "");
  const [annee, setAnnee]   = useState(initial.annee  || 0);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const search = useCallback(async (off = 0) => {
    setLoading(true);
    setSelected(null);
    const data = await fetchVotes({ q, result: result_, annee, limit: LIMIT, offset: off });
    setResult(data);
    setOffset(off);
    setLoading(false);
  }, [q, result_, annee]);

  useEffect(() => { search(0); }, [search]);

  return (
    <div>
      <div style={filterRowStyle}>
        <input style={inputStyle} placeholder="Recherche dans le titre du vote..."
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search(0)} />
        <select style={selectStyle} value={result_} onChange={(e) => { setRes(e.target.value); search(0); }}>
          <option value="">Tous résultats</option>
          {filters.resultats?.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input style={{ ...selectStyle, width: 90 }} type="number" placeholder="Année"
          value={annee || ""} onChange={(e) => setAnnee(Number(e.target.value))} />
        <button style={btnStyle} onClick={() => search(0)}>Rechercher</button>
      </div>

      {loading && <p style={{ color: "#888" }}>Chargement...</p>}
      {result && (
        <>
          <p style={{ color: "#666", marginBottom: 8, fontSize: 13 }}>
            {result.total} résultat{result.total > 1 ? "s" : ""} — cliquez sur une ligne pour le détail
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {[
                    ["Titre", "scrutin"], ["Résultat", "adopte"], ["Année", null],
                    ["Pour", null], ["Contre", null], ["Abstention", "abstention"], ["Lien", null]
                  ].map(([h, tip]) => (
                    <th key={h} style={thStyle}>
                      {h}{tip && <Tip term={tip} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.map((row, i) => {
                  const isSelected = selected === i;
                  const adopted = row.result === "ADOPTED";
                  return (
                    <>
                      <tr key={i}
                        onClick={() => setSelected(isSelected ? null : i)}
                        style={{
                          background: isSelected ? "#eef2ff" : i % 2 === 0 ? "#fff" : "#f9fafc",
                          cursor: "pointer",
                          borderLeft: isSelected ? `3px solid ${adopted ? "#2ecc71" : "#e74c3c"}` : "3px solid transparent",
                        }}>
                        <td style={{ ...tdStyle, maxWidth: 340 }} title={row.title}>
                          {row.title?.slice(0, 70)}{row.title?.length > 70 ? "…" : ""}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: adopted ? "#1a7a4a" : "#c0392b", fontWeight: 600, fontSize: 12 }}>
                            {adopted ? "✓ Adopté" : "✗ Rejeté"}
                          </span>
                        </td>
                        <td style={tdStyle}>{row.annee_vote}</td>
                        <td style={{ ...tdStyle, color: "#1a7a4a", fontWeight: 600 }}>{row.votesFor}</td>
                        <td style={{ ...tdStyle, color: "#c0392b", fontWeight: 600 }}>{row.votesAgainst}</td>
                        <td style={{ ...tdStyle, color: "#b7770d" }}>{row.votesAbstain}</td>
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          {row.sourceUrl
                            ? <a href={row.sourceUrl} target="_blank" rel="noreferrer"
                                style={{ fontSize: 13, color: "#1a3a6e", textDecoration: "none" }}>→</a>
                            : "—"}
                        </td>
                      </tr>
                      {isSelected && (
                        <tr key={`detail-${i}`}>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <VoteDetail row={row} onClose={() => setSelected(null)} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={result.total} offset={offset} limit={LIMIT} onChange={search} />
        </>
      )}
    </div>
  );
};

// ---- Composants utilitaires ----
const Badge = ({ text }) => {
  if (!text) return null;
  return (
    <span style={{
      fontSize: 10, padding: "2px 7px", borderRadius: 4,
      background: "#e8ecf8", color: "#1a3a6e", fontWeight: 700, whiteSpace: "nowrap",
      letterSpacing: "0.02em",
    }}>
      {text.replace(/_/g, " ")}
    </span>
  );
};

const Pagination = ({ total, offset, limit, onChange }) => {
  const page    = Math.floor(offset / limit);
  const maxPage = Math.ceil(total / limit) - 1;
  if (maxPage <= 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
      <button style={pgBtn} disabled={page === 0} onClick={() => onChange((page - 1) * limit)}>←</button>
      <span style={{ fontSize: 13, color: "#555" }}>Page {page + 1} / {maxPage + 1}</span>
      <button style={pgBtn} disabled={page >= maxPage} onClick={() => onChange((page + 1) * limit)}>→</button>
    </div>
  );
};

// ---- Page principale ----
const TABS = [
  { id: "scandales", label: "Scandales" },
  { id: "votes",     label: "Votes" },
];

const ExplorationPage = ({ initialFilters = {} }) => {
  const [tab, setTab]         = useState(initialFilters.tab || "scandales");
  const [filters, setFilters] = useState({});

  useEffect(() => {
    fetchFilters().then(setFilters).catch(() => {});
  }, []);

  return (
    <div style={{ padding: "1.5rem" }}>
      {/* En-tête institutionnel */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "0.3rem" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(135deg, #1a3a6e 60%, #c9a227 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, color: "#fff", fontWeight: 900, flexShrink: 0,
        }}>
          ⚖
        </div>
        <div>
          <h2 style={{ marginBottom: "0.1rem", color: "#1a2e5a", letterSpacing: "-0.01em" }}>
            Exploration des données
          </h2>
          <p style={{ color: "#7a8aaa", margin: 0, fontSize: 13 }}>
            Recherche et filtres sur les scandales et les votes parlementaires
          </p>
        </div>
      </div>

      {/* Séparateur tricolore */}
      <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", marginBottom: "1.4rem", marginTop: "0.8rem" }}>
        <div style={{ flex: 1, background: "#002395" }} />
        <div style={{ flex: 1, background: "#fff", border: "1px solid #e0e0e0" }} />
        <div style={{ flex: 1, background: "#ED2939" }} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: "1.2rem" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              ...tabBtn,
              background: tab === t.id ? "#1a3a6e" : "#f0f2f8",
              color: tab === t.id ? "#fff" : "#555",
              borderBottom: tab === t.id ? "2px solid #c9a227" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{
        background: "#fff", borderRadius: 10, padding: "1.2rem",
        boxShadow: "0 1px 6px rgba(26,58,110,0.08)",
        border: "1px solid #e8ecf8",
      }}>
        {tab === "scandales" && <ScandalSearch filters={filters} initial={initialFilters} />}
        {tab === "votes"     && <VoteSearch    filters={filters} initial={initialFilters} />}
      </div>
    </div>
  );
};

// ---- Styles ----
const detailStyle = {
  padding: "1rem 1.2rem",
  background: "#f7f9fd",
  borderTop: "2px solid #1a3a6e",
  borderBottom: "1px solid #d4ddf7",
};
const closeBtnStyle = {
  border: "none", background: "none", cursor: "pointer",
  fontSize: 20, color: "#aaa", lineHeight: 1, flexShrink: 0,
  padding: "0 4px",
};
const filterRowStyle = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 };
const inputStyle  = { padding: "7px 12px", borderRadius: 6, border: "1px solid #d4ddf7", fontSize: 13, flex: 1, minWidth: 200 };
const selectStyle = { padding: "7px 10px", borderRadius: 6, border: "1px solid #d4ddf7", fontSize: 13 };
const btnStyle    = { padding: "7px 16px", background: "#1a3a6e", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 };
const tabBtn      = { padding: "7px 20px", border: "none", borderRadius: "6px 6px 0 0", cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "all 0.15s" };
const tableStyle  = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle     = { textAlign: "left", padding: "9px 10px", background: "#f0f3fa", fontWeight: 700, color: "#1a3a6e", borderBottom: "2px solid #d4ddf7", letterSpacing: "0.02em", fontSize: 12 };
const tdStyle     = { padding: "8px 10px", borderBottom: "1px solid #f0f2f8", verticalAlign: "top" };
const pgBtn       = { padding: "5px 14px", border: "1px solid #d4ddf7", borderRadius: 5, background: "#fff", cursor: "pointer", color: "#1a3a6e", fontWeight: 600 };

export default ExplorationPage;
