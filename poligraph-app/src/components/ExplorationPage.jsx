import { useState, useEffect, useCallback } from "react";
import PartyLogo from "./PartyLogo";
import Badge from "./Badge";

// Ton sémantique du statut judiciaire/de vote, pour le badge pilule.
function statutTone(status) {
  const s = (status || "").toUpperCase();
  if (s.includes("CONDAMN") || s === "REJECTED") return "danger";
  if (s.includes("ENQUETE") || s.includes("EN_COURS") || s.includes("INSTRUCTION") || s.includes("EXAMEN") || s.includes("APPEL")) return "warning";
  if (s.includes("RELAXE") || s.includes("ACQUITT") || s.includes("NON_LIEU") || s.includes("CLASSEMENT") || s === "ADOPTED") return "success";
  return "neutral";
}

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

const Field = ({ label, children }) => (
  <div>
    <label style={fieldLabelStyle}>{label}</label>
    {children}
  </div>
);

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
  const [groupes, setGroupes]   = useState(null);
  const [loadingG, setLoadingG] = useState(false);

  useEffect(() => {
    const ref = row.externalId;
    if (!ref) return;
    setLoadingG(true);
    fetch(`${PROXY_URL}/scrutins/${ref}/groupes`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setGroupes(d?.groupes || []))
      .catch(() => setGroupes([]))
      .finally(() => setLoadingG(false));
  }, [row.externalId]);

  const total = Number(row.totalVotes) || (Number(row.votesFor) + Number(row.votesAgainst) + Number(row.votesAbstain)) || 1;
  const pctFor          = Math.round((Number(row.votesFor)     / total) * 100);
  const pctAgainst      = Math.round((Number(row.votesAgainst) / total) * 100);
  const pctAbstain      = Math.round((Number(row.votesAbstain) / total) * 100);
  const AN_SEATS        = 577; // 17e législature
  const participation   = Math.round((total / AN_SEATS) * 100);
  const anUrl = row.sourceUrl || (row.externalId && row.legislature
    ? `https://www.assemblee-nationale.fr/dyn/${row.legislature}/scrutins/${row.externalId.replace(/.*V(\d+)$/, '$1')}`
    : null);
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
        <div style={{ display: "flex", height: 22, borderRadius: 999, overflow: "hidden", boxShadow: "inset 0 0 0 1px #dbe1ee" }}>
          {pctFor > 0 && (
            <div style={{ width: `${pctFor}%`, background: "#2ecc71", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>{pctFor > 5 ? `${pctFor}%` : ""}</span>
            </div>
          )}
          {pctAgainst > 0 && (
            <div style={{ width: `${pctAgainst}%`, background: "#e74c3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>{pctAgainst > 5 ? `${pctAgainst}%` : ""}</span>
            </div>
          )}
          {pctAbstain > 0 && (
            <div style={{ width: `${pctAbstain}%`, background: "#f39c12", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>{pctAbstain > 5 ? `${pctAbstain}%` : ""}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#2ecc71", display: "inline-block" }} />
            <span style={{ color: "#555" }}>Pour : </span><strong style={{ color: "#1a7a4a" }}>{row.votesFor || 0}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e74c3c", display: "inline-block" }} />
            <span style={{ color: "#555" }}>Contre : </span><strong style={{ color: "#c0392b" }}>{row.votesAgainst || 0}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f39c12", display: "inline-block" }} />
            <span style={{ color: "#555" }}>Abstention : </span><strong style={{ color: "#b7770d" }}>{row.votesAbstain || 0}</strong>
          </div>
          <div style={{ color: "#888", marginLeft: "auto", fontSize: 12, textAlign: "right" }}>
            Total : <strong>{row.totalVotes || total}</strong> votants
            <div style={{ marginTop: 2, fontSize: 11, color: participation >= 70 ? "#27ae60" : participation >= 50 ? "#f39c12" : "#e74c3c" }}>
              <strong>{participation}%</strong> de participation ({AN_SEATS} sièges AN)
            </div>
          </div>
        </div>
      </div>

      {/* Détail par groupe parlementaire */}
      <div style={{ marginTop: 16, borderTop: "1px solid #e8ecf8", paddingTop: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#1a2e5a" }}>
          Répartition par groupe parlementaire <Tip term="groupe" />
        </p>

        {loadingG && (
          <p style={{ color: "#aaa", fontSize: 12 }}>Chargement des groupes…</p>
        )}

        {!loadingG && groupes && groupes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groupes
              .filter((g) => (g.pour || 0) + (g.contre || 0) + (g.abstention || 0) > 0)
              .sort((a, b) => (b.pour || 0) - (a.pour || 0))
              .map((g, i) => {
                const gTotal = (g.pour || 0) + (g.contre || 0) + (g.abstention || 0);
                const pFor   = gTotal > 0 ? Math.round(((g.pour   || 0) / gTotal) * 100) : 0;
                const pCon   = gTotal > 0 ? Math.round(((g.contre || 0) / gTotal) * 100) : 0;
                const pAbs   = gTotal > 0 ? Math.round(((g.abstention || 0) / gTotal) * 100) : 0;
                const gColor = g.color || "#1a3a6e";
                const label  = g.shortName || g.name || "—";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px", alignItems: "center", gap: 10 }}>
                    {/* Nom du groupe */}
                    <div style={{
                      fontWeight: 700, fontSize: 12, color: gColor,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={g.name}>
                      {label}
                    </div>

                    {/* Barre stacked */}
                    <div style={{ height: 18, borderRadius: 999, overflow: "hidden", display: "flex", background: "#f0f0f0" }}>
                      {pFor > 0 && (
                        <div style={{ width: `${pFor}%`, background: "#2ecc71", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{pFor > 8 ? `${pFor}%` : ""}</span>
                        </div>
                      )}
                      {pCon > 0 && (
                        <div style={{ width: `${pCon}%`, background: "#e74c3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{pCon > 8 ? `${pCon}%` : ""}</span>
                        </div>
                      )}
                      {pAbs > 0 && (
                        <div style={{ width: `${pAbs}%`, background: "#f39c12", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{pAbs > 8 ? `${pAbs}%` : ""}</span>
                        </div>
                      )}
                    </div>

                    {/* Chiffres */}
                    <div style={{ fontSize: 11, color: "#555", textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#27ae60", fontWeight: 600 }}>{g.pour || 0} ✓</span>
                      {" · "}
                      <span style={{ color: "#e74c3c", fontWeight: 600 }}>{g.contre || 0} ✗</span>
                      {(g.abstention || 0) > 0 && (
                        <span style={{ color: "#f39c12" }}> · {g.abstention} ~</span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {!loadingG && groupes && groupes.length === 0 && (
          <div style={{ fontSize: 12, color: "#888" }}>
            <span style={{ fontStyle: "italic", color: "#aaa" }}>
              Le détail par groupe n'est pas disponible ici —
            </span>{" "}
            {anUrl ? (
              <a href={anUrl} target="_blank" rel="noreferrer"
                style={{ color: "#1a3a6e", fontWeight: 600, textDecoration: "underline" }}>
                voir le vote nominatif par groupe sur assemblee-nationale.fr →
              </a>
            ) : (
              <span style={{ color: "#aaa" }}>référence du scrutin manquante.</span>
            )}
          </div>
        )}

        {!loadingG && !groupes && (
          <p style={{ color: "#aaa", fontSize: 12, fontStyle: "italic" }}>
            Référence du scrutin manquante.
          </p>
        )}
      </div>

      {row.externalId && row.legislature && (
        <div style={{ marginTop: 12, borderTop: "1px solid #d4ddf7", paddingTop: 10 }}>
          <a
            href={`https://www.assemblee-nationale.fr/dyn/${row.legislature}/scrutins/${row.externalId}`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: "#1a3a6e", textDecoration: "underline" }}>
            → Voir le scrutin sur l'Assemblée nationale (noms des votants par groupe)
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
      <div style={filterToolbarStyle}>
        <div style={filterGridStyle}>
          <Field label="Recherche">
            <input style={inputStyle} placeholder="Titre, description, élu..."
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(0)} />
          </Field>
          <Field label="Catégorie">
            <select style={selectStyle} value={category} onChange={(e) => { setCat(e.target.value); search(0); }}>
              <option value="">Toutes catégories</option>
              {filters.categories?.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Parti">
            <select style={selectStyle} value={parti} onChange={(e) => { setParti(e.target.value); search(0); }}>
              <option value="">Tous partis</option>
              {filters.partis?.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Statut">
            <select style={selectStyle} value={statut} onChange={(e) => { setStatut(e.target.value); search(0); }}>
              <option value="">Tous statuts</option>
              {filters.statuts?.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <button style={btnStyle} onClick={() => search(0)}>Rechercher</button>
        </div>
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
                          background: isSelected ? "var(--color-blue-50)" : "transparent",
                          cursor: "pointer",
                          borderLeft: isSelected ? "3px solid var(--pg-navy)" : "3px solid transparent",
                          transition: "background 0.12s",
                        }}>
                        <td style={{ ...tdStyle, maxWidth: 280 }} title={row.title}>
                          {row.title?.slice(0, 60)}{row.title?.length > 60 ? "…" : ""}
                        </td>
                        <td style={tdStyle}>{row.category && <Badge tone="info" size="sm" text={row.category.replace(/_/g, " ")} />}</td>
                        <td style={tdStyle}>{row.status && <Badge tone={statutTone(row.status)} size="sm" text={row.status.replace(/_/g, " ")} />}</td>
                        <td style={tdStyle}>{row.politician_name}</td>
                        <td style={tdStyle}>{row.party_short ? <PartyLogo code={row.party_short} size={14} /> : "—"}</td>
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
  const [theme, setTheme]   = useState(initial.theme  || "");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const search = useCallback(async (off = 0) => {
    setLoading(true);
    setSelected(null);
    const data = await fetchVotes({ q, result: result_, annee, theme, limit: LIMIT, offset: off });
    setResult(data);
    setOffset(off);
    setLoading(false);
  }, [q, result_, annee, theme]);

  useEffect(() => { search(0); }, [search]);

  return (
    <div>
      {theme && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#888" }}>Filtre thème :</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#1a3a6e", color: "#fff", borderRadius: 14,
            padding: "3px 10px", fontSize: 12, fontWeight: 600,
          }}>
            {theme}
            <button onClick={() => setTheme("")} style={{
              background: "none", border: "none", color: "#fff", cursor: "pointer",
              fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.7,
            }}>×</button>
          </span>
        </div>
      )}
      <div style={filterToolbarStyle}>
        <div style={filterGridStyle}>
          <Field label="Recherche">
            <input style={inputStyle} placeholder="Titre du vote..."
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(0)} />
          </Field>
          <Field label="Résultat">
            <select style={selectStyle} value={result_} onChange={(e) => { setRes(e.target.value); search(0); }}>
              <option value="">Tous résultats</option>
              {filters.resultats?.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Année">
            <input style={selectStyle} type="number" placeholder="ex: 2022"
              value={annee || ""} onChange={(e) => setAnnee(Number(e.target.value))} />
          </Field>
          <button style={btnStyle} onClick={() => search(0)}>Rechercher</button>
        </div>
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
                          background: isSelected ? "var(--color-blue-50)" : "transparent",
                          cursor: "pointer",
                          borderLeft: isSelected ? `3px solid ${adopted ? "var(--color-green-600)" : "var(--color-red-600)"}` : "3px solid transparent",
                          transition: "background 0.12s",
                        }}>
                        <td style={{ ...tdStyle, maxWidth: 340 }} title={row.title}>
                          {row.title?.slice(0, 70)}{row.title?.length > 70 ? "…" : ""}
                        </td>
                        <td style={tdStyle}>
                          <Badge tone={adopted ? "success" : "danger"} size="sm" text={adopted ? "Adopté" : "Rejeté"} />
                        </td>
                        <td style={tdStyle}>{row.annee_vote}</td>
                        <td style={{ ...tdStyle, color: "#1a7a4a", fontWeight: 600 }}>{row.votesFor}</td>
                        <td style={{ ...tdStyle, color: "#c0392b", fontWeight: 600 }}>{row.votesAgainst}</td>
                        <td style={{ ...tdStyle, color: "#b7770d" }}>{row.votesAbstain}</td>
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          {row.externalId && row.legislature
                            ? <a href={`https://www.assemblee-nationale.fr/dyn/${row.legislature}/scrutins/${row.externalId}`}
                                target="_blank" rel="noreferrer"
                                title="Voir les votants nominatifs sur assemblee-nationale.fr"
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

// ---- Fact-checks ----
const VERDICT_CFG = {
  TRUE:         { label: "Vrai",          color: "#27ae60", bg: "#d4f7e8" },
  MOSTLY_TRUE:  { label: "Plutôt vrai",   color: "#2ecc71", bg: "#e8faf0" },
  HALF_TRUE:    { label: "Partiellement", color: "#f39c12", bg: "#fef9e7" },
  MISLEADING:   { label: "Trompeur",      color: "#e67e22", bg: "#fdebd0" },
  MOSTLY_FALSE: { label: "Plutôt faux",   color: "#e74c3c", bg: "#fdecea" },
  FALSE:        { label: "Faux",          color: "#c0392b", bg: "#fadbd8" },
  UNVERIFIABLE: { label: "Invérifiable",  color: "#95a5a6", bg: "#f2f3f4" },
};

const VERDICT_TONE = {
  TRUE: "success", MOSTLY_TRUE: "success",
  HALF_TRUE: "warning", MISLEADING: "warning",
  MOSTLY_FALSE: "danger", FALSE: "danger",
  UNVERIFIABLE: "neutral",
};

const VerdictBadge = ({ rating }) => {
  const cfg = VERDICT_CFG[rating] || { label: rating };
  return <Badge tone={VERDICT_TONE[rating] || "neutral"} text={cfg.label} />;
};

const FactcheckSearch = ({ initial = {} }) => {
  const [q,       setQ]       = useState(initial.q       || "");
  const [verdict, setVerdict] = useState(initial.verdict || "");
  const [page,    setPage]    = useState(1);
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 20, page: p });
      if (q)       params.append("q", q);
      if (verdict) params.append("verdictRating", verdict);
      const res = await fetch(`${PROXY_URL}/factchecks?${params}`);
      setResult(res.ok ? await res.json() : null);
      setPage(p);
    } catch { setResult(null); }
    setLoading(false);
  }, [q, verdict]);

  useEffect(() => { search(1); }, [search]);

  const items = result?.data || [];
  const total = result?.pagination?.total || 0;
  const totalPages = result?.pagination?.totalPages || 1;

  return (
    <div>
      {/* Barre de recherche */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid #d0d8f0", borderRadius: 8, fontSize: 13 }}
          placeholder="Rechercher une déclaration, un politicien…"
          value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search(1)}
        />
        <select style={selectStyle} value={verdict} onChange={e => { setVerdict(e.target.value); }}>
          <option value="">Tous verdicts</option>
          {Object.entries(VERDICT_CFG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button style={btnStyle} onClick={() => search(1)}>Rechercher</button>
      </div>

      {loading && <p style={{ color: "#aaa", fontSize: 13 }}>Chargement…</p>}

      {!loading && (
        <>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
            {total.toLocaleString()} fact-check{total > 1 ? "s" : ""} — sources : AFP Factuel, TF1 Info, Franceinfo, Le Monde…
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((fc, i) => (
              <a key={i} href={fc.sourceUrl} target="_blank" rel="noreferrer"
                style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{
                  border: "1px solid #e8ecf8", borderRadius: 10, padding: "12px 14px",
                  background: "#fff", transition: "box-shadow 0.15s",
                  borderLeft: `4px solid ${(VERDICT_CFG[fc.verdictRating] || {}).color || "#ccc"}`,
                }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(26,58,110,0.10)"}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                    <VerdictBadge rating={fc.verdictRating} />
                    <span style={{ fontSize: 11, color: "#aaa" }}>{fc.source}</span>
                    <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>
                      {fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e5a", marginBottom: 4 }}>
                    {fc.claimant && <span style={{ color: "#555", fontWeight: 400 }}>{fc.claimant} : </span>}
                    « {fc.claimText?.slice(0, 160)}{fc.claimText?.length > 160 ? "…" : ""} »
                  </div>
                  <div style={{ fontSize: 12, color: "#888" }}>{fc.title}</div>
                </div>
              </a>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
              <button style={btnStyle} disabled={page <= 1} onClick={() => search(page - 1)}>← Précédent</button>
              <span style={{ fontSize: 13, color: "#888", alignSelf: "center" }}>Page {page}/{totalPages}</span>
              <button style={btnStyle} disabled={page >= totalPages} onClick={() => search(page + 1)}>Suivant →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ---- Page principale ----
const TABS = [
  { id: "scandales",   label: "Scandales" },
  { id: "votes",       label: "Votes" },
  { id: "factchecks",  label: "Fact-checks" },
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
        {tab === "scandales"  && <ScandalSearch  filters={filters} initial={initialFilters} />}
        {tab === "votes"      && <VoteSearch     filters={filters} initial={initialFilters} />}
        {tab === "factchecks" && <FactcheckSearch initial={initialFilters} />}
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
const filterToolbarStyle = {
  background: "#fff", border: "1px solid #dbe1ee", borderRadius: "0 12px 12px 12px",
  boxShadow: "0 1px 3px rgba(20,33,61,0.08)", padding: "14px 16px", marginBottom: 16,
};
const filterGridStyle = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12, alignItems: "end",
};
const fieldLabelStyle = {
  display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.04em", color: "#5b6b85", marginBottom: 5,
};
const inputStyle  = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #dbe1ee", fontSize: 13, background: "#eef1f6" };
const selectStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #dbe1ee", fontSize: 13, background: "#eef1f6" };
const btnStyle    = { padding: "9px 18px", background: "#1a3a6e", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 };
const tabBtn      = { padding: "7px 20px", border: "none", borderRadius: "6px 6px 0 0", cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "all 0.15s" };
const tableStyle  = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle     = { textAlign: "left", padding: "10px 12px", background: "transparent", fontWeight: 500, color: "var(--pg-muted)", borderBottom: "1px solid var(--pg-line)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.03em" };
const tdStyle     = { padding: "11px 12px", borderBottom: "1px solid var(--pg-line)", verticalAlign: "top" };
const pgBtn       = { padding: "5px 14px", border: "1px solid #d4ddf7", borderRadius: 5, background: "#fff", cursor: "pointer", color: "#1a3a6e", fontWeight: 600 };

export default ExplorationPage;
