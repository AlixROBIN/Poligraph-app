import { useState, useEffect, useCallback } from "react";

const BASE = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";

const SOURCE_BIAS = {
  "TF1 Info":           { lean: "Centre-droite", color: "#e67e22", owner: "Bouygues" },
  "AFP Factuel":        { lean: "Neutre",         color: "#27ae60", owner: "Agence publique" },
  "Franceinfo":         { lean: "Neutre",         color: "#2980b9", owner: "Service public (État)" },
  "20 Minutes":         { lean: "Centre",         color: "#8e44ad", owner: "Rossel" },
  "Le Monde":           { lean: "Centre-gauche",  color: "#2c3e50", owner: "Xavier Niel / Matthieu Pigasse" },
  "Libération":         { lean: "Centre-gauche",  color: "#e74c3c", owner: "Altice (Drahi)" },
  "Le Dauphiné Libéré": { lean: "Centre",         color: "#16a085", owner: "EBRA (Crédit Mutuel)" },
  "DE FACTO":           { lean: "Indépendant",    color: "#7f8c8d", owner: "ONG journaliste" },
};

const VERDICT_COLORS = {
  vrai:     "#27ae60",
  trompeur: "#f39c12",
  faux:     "#e74c3c",
  invefi:   "#95a5a6",
};

const VERDICT_LABELS = {
  TRUE:          { label: "Vrai",           color: "#27ae60", bg: "#eafaf1" },
  MOSTLY_TRUE:   { label: "Plutôt vrai",    color: "#2ecc71", bg: "#f0faf4" },
  HALF_TRUE:     { label: "Mi-vrai",        color: "#f39c12", bg: "#fef9e7" },
  MISLEADING:    { label: "Trompeur",       color: "#e67e22", bg: "#fdf2e9" },
  FALSE:         { label: "Faux",           color: "#e74c3c", bg: "#fdedec" },
  MOSTLY_FALSE:  { label: "Plutôt faux",    color: "#c0392b", bg: "#fde8e6" },
  UNVERIFIABLE:  { label: "Invérifiable",   color: "#95a5a6", bg: "#f2f3f4" },
};

function verdictCfg(rating) {
  return VERDICT_LABELS[rating] || { label: rating || "?", color: "#888", bg: "#f5f5f5" };
}

// ── Modal détail d'un fact-check ──────────────────────────────────────────────
function FactCheckModal({ fc, onClose }) {
  if (!fc) return null;
  const cfg  = verdictCfg(fc.verdictRating);
  const pols = (fc.politicians || []).map(p => p?.fullName).filter(Boolean);
  const date = fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: "2rem",
          maxWidth: 640, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          position: "relative", maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 16, border: "none",
            background: "none", fontSize: 22, cursor: "pointer", color: "#aaa",
          }}
        >✕</button>

        {/* Verdict */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: "1.2rem", flexWrap: "wrap" }}>
          <span style={{
            background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`,
            borderRadius: 12, padding: "4px 14px", fontSize: 13, fontWeight: 800,
          }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 12, color: "#888" }}>{fc.source}</span>
          <span style={{ fontSize: 12, color: "#aaa", marginLeft: "auto" }}>{date}</span>
        </div>

        {/* Déclaration */}
        <p style={{
          fontSize: 15, fontWeight: 700, color: "#1a2e5a", lineHeight: 1.6,
          margin: "0 0 1rem", borderLeft: `4px solid ${cfg.color}`,
          paddingLeft: 14,
        }}>
          « {fc.claimText || "Déclaration non renseignée"} »
        </p>

        {/* Qui a dit ça */}
        {fc.claimant && (
          <p style={{ fontSize: 13, color: "#555", margin: "0 0 6px" }}>
            <strong>Déclarant :</strong> {fc.claimant}
          </p>
        )}
        {pols.length > 0 && (
          <p style={{ fontSize: 13, color: "#555", margin: "0 0 1rem" }}>
            <strong>Politicien(s) impliqué(s) :</strong>{" "}
            {pols.join(", ")}
          </p>
        )}

        {/* Explication fournie par le média */}
        {fc.articleTitle && (
          <div style={{
            background: "#f8f9fc", borderRadius: 10, padding: "12px 14px",
            marginBottom: "1rem", fontSize: 13, color: "#444", lineHeight: 1.6,
          }}>
            <strong style={{ color: "#1a2e5a" }}>Titre de l'article :</strong>
            <p style={{ margin: "4px 0 0" }}>{fc.articleTitle}</p>
          </div>
        )}

        {/* Lien externe */}
        {fc.sourceUrl && (
          <a
            href={fc.sourceUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block", marginTop: 8,
              padding: "9px 22px", borderRadius: 8,
              background: "#1a3a6e", color: "#fff",
              textDecoration: "none", fontWeight: 700, fontSize: 13,
            }}
          >
            Lire l'analyse complète → {fc.source}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Panel fact-checks d'un politicien ────────────────────────────────────────
function PoliticianFcPanel({ politician, onClose, onSelectFc }) {
  const [fcs,     setFcs]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!politician?.name) return;
    setLoading(true);
    fetch(`${BASE}/search/factchecks?q=${encodeURIComponent(politician.name)}&limit=50`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setFcs(d?.data || []))
      .catch(() => setFcs([]))
      .finally(() => setLoading(false));
  }, [politician?.name]);

  if (!politician) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: "2rem",
          maxWidth: 700, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          position: "relative", maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#aaa" }}
        >✕</button>

        <h3 style={{ margin: "0 0 4px", fontSize: 18, color: "#1a2e5a" }}>
          {politician.name}
        </h3>
        <div style={{ margin: "0 0 1.2rem", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#888" }}>{politician.party}</span>
          {politician.nb_déclarations != null && (
            <span style={{ fontSize: 11, background: "#eaf0ff", color: "#1a3a6e", borderRadius: 8, padding: "2px 8px" }}>
              {politician.nb_déclarations} déclaration{politician.nb_déclarations > 1 ? "s" : ""} faite{politician.nb_déclarations > 1 ? "s" : ""} par lui
            </span>
          )}
          {politician.nb_mentions != null && politician.nb_mentions > 0 && (
            <span style={{ fontSize: 11, background: "#f5f0ff", color: "#8e44ad", borderRadius: 8, padding: "2px 8px" }}>
              {politician.nb_mentions} mention{politician.nb_mentions > 1 ? "s" : ""} par d'autres
            </span>
          )}
          <span style={{ fontSize: 11, color: "#aaa" }}>— liste ci-dessous : toutes apparitions</span>
        </div>

        {loading && <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>Chargement…</p>}
        {!loading && (!fcs || fcs.length === 0) && (
          <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>Aucun fact-check trouvé.</p>
        )}
        {!loading && fcs && fcs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fcs.map((fc, i) => {
              const cfg  = verdictCfg(fc.verdictRating);
              const date = fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : "";
              return (
                <div
                  key={i}
                  onClick={() => onSelectFc(fc)}
                  style={{
                    padding: "12px 14px", borderRadius: 10, border: "1px solid #e8ecf8",
                    background: "#fafbfe", cursor: "pointer", transition: "box-shadow 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.10)"}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{
                      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`,
                      borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 700,
                    }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: 11, color: "#888" }}>{fc.source}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#aaa" }}>{date}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#1a2e5a", lineHeight: 1.5 }}>
                    « {(fc.claimText || "").slice(0, 180)}{(fc.claimText || "").length > 180 ? "…" : ""} »
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Barre de verdict ──────────────────────────────────────────────────────────
function VerdictBar({ s }) {
  if (!s) return null;
  const total = s.vrai + s.trompeur + s.faux + s.invefi;
  if (!total) return null;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", width: "100%", gap: 1 }}>
      {["vrai","trompeur","faux","invefi"].map(k => s[k] > 0 && (
        <div key={k} title={`${s["pct_"+k]}% ${k}`}
          style={{ width: `${s["pct_"+k]}%`, background: VERDICT_COLORS[k], minWidth: s[k] > 0 ? 2 : 0 }} />
      ))}
    </div>
  );
}

// ── Carte de classement ───────────────────────────────────────────────────────
function RankingCard({ title, subtitle, items, metric, color, onClickPolitician }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: "1.4rem",
      boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8", flex: 1,
    }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#1a2e5a" }}>{title}</h3>
      <p style={{ margin: "0 0 1rem", fontSize: 11, color: "#aaa" }}>{subtitle}</p>
      {items.map((p, i) => (
        <div key={i}
          onClick={() => onClickPolitician && onClickPolitician(p)}
          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, cursor: onClickPolitician ? "pointer" : "default" }}
          onMouseEnter={e => onClickPolitician && (e.currentTarget.style.opacity = "0.8")}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          <span style={{ fontSize: 12, color: "#aaa", width: 18, textAlign: "right" }}>{i+1}.</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e5a" }}>{p.name}</span>
                {p.party && <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>{p.party} · {p.total} FC</span>}
                {p.short && <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>{p.total} FC</span>}
                {p.total < 8 && (
                  <span title="Faible nombre de vérifications — score moins représentatif" style={{
                    marginLeft: 6, fontSize: 10, color: "#e67e22",
                    border: "1px solid #e67e2266", borderRadius: 8, padding: "0 5px",
                  }}>⚠ petit échantillon</span>
                )}
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color }}>{p[metric]}%</span>
            </div>
            <VerdictBar s={p} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Onglet Recherche ──────────────────────────────────────────────────────────
function SearchTab({ onSelectFc }) {
  const [query,         setQuery]         = useState("");
  const [verdictFilter, setVerdictFilter] = useState("");
  const [results,       setResults]       = useState(null);   // array | null
  const [corpusSize,    setCorpusSize]    = useState(null);
  const [searching,     setSearching]     = useState(false);

  const doSearch = () => {
    setSearching(true);
    const params = new URLSearchParams({ limit: 50 });
    if (query)         params.set("q", query);
    if (verdictFilter) params.set("verdictRating", verdictFilter);
    fetch(`${BASE}/search/factchecks?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setResults(d?.data || []);
        setCorpusSize(d?.searched_corpus || null);
      })
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8" }}>
      <h3 style={{ margin: "0 0 1rem", fontSize: 15, color: "#1a2e5a" }}>Rechercher un fact-check</h3>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: "1rem" }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="Chercher une déclaration…"
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #d0d8f0", fontSize: 13, outline: "none" }}
        />
        <select
          value={verdictFilter}
          onChange={e => setVerdictFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d0d8f0", fontSize: 13, background: "#fff", cursor: "pointer" }}
        >
          <option value="">Tous les verdicts</option>
          {Object.entries(VERDICT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={doSearch} disabled={searching} style={{
          padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
          background: "#1a3a6e", color: "#fff", fontWeight: 700, fontSize: 13,
          opacity: searching ? 0.7 : 1,
        }}>
          {searching ? "Recherche…" : "Chercher"}
        </button>
      </div>

      {results === null && (
        <p style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: "2rem 0" }}>
          Entrez un mot-clé et appuyez sur Chercher
        </p>
      )}
      {results !== null && results.length === 0 && (
        <p style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: "2rem 0" }}>
          Aucun fact-check trouvé pour ces critères.
        </p>
      )}
      {results !== null && results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#888" }}>
            {results.length} résultat(s) sur {corpusSize || "?"} fact-checks analysés — cliquer pour voir l'analyse
          </p>
          {results.map((fc, i) => {
            const cfg  = verdictCfg(fc.verdictRating);
            const pols = (fc.politicians || []).map(p => p?.fullName).filter(Boolean);
            const date = fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : "";
            return (
              <div
                key={i}
                onClick={() => onSelectFc(fc)}
                style={{
                  display: "block", padding: "12px 14px", borderRadius: 10,
                  border: "1px solid #e8ecf8", background: "#fafbfe",
                  cursor: "pointer", transition: "box-shadow 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.10)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`, borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
                    {cfg.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#888" }}>{fc.source}</span>
                  {pols.length > 0 && <span style={{ fontSize: 11, color: "#8e44ad", fontWeight: 600 }}>{pols.join(", ")}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#aaa" }}>{date}</span>
                </div>
                <div style={{ fontSize: 13, color: "#1a2e5a", lineHeight: 1.5 }}>
                  « {(fc.claimText || "").slice(0, 200)}{(fc.claimText || "").length > 200 ? "…" : ""} »
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function FactchecksDashboard({ onNavigate }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState("factchecks");

  // Modals
  const [selectedFc,  setSelectedFc]  = useState(null);
  const [selectedPol, setSelectedPol] = useState(null);

  const openPol = useCallback((p) => { setSelectedPol(p); setSelectedFc(null); }, []);
  const openFc  = useCallback((fc) => { setSelectedFc(fc); }, []);
  const closeFc = useCallback(() => setSelectedFc(null), []);
  const closePol = useCallback(() => setSelectedPol(null), []);
  const openFcFromPol = useCallback((fc) => setSelectedFc(fc), []);

  useEffect(() => {
    fetch(`${BASE}/dashboard/factchecks`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const go = (filters) => onNavigate("exploration", { tab: "factchecks", ...filters });

  if (loading) return <p style={{ padding: "2rem", color: "#888" }}>Chargement des fact-checks… (~10s première fois)</p>;
  if (!data)   return <p style={{ padding: "2rem", color: "red" }}>Impossible de charger le dashboard fact-checks.</p>;

  const ov    = data.verdicts_globaux || {};
  const total = data.total || 0;

  return (
    <div style={{ padding: "1.5rem", background: "#f5f6fa", minHeight: "100vh" }}>

      {/* Modals */}
      {selectedPol && !selectedFc && (
        <PoliticianFcPanel
          politician={selectedPol}
          onClose={closePol}
          onSelectFc={openFcFromPol}
        />
      )}
      {selectedFc && (
        <FactCheckModal fc={selectedFc} onClose={closeFc} />
      )}

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a2e5a 0%, #2c3e6e 60%, #8e44ad 100%)",
        borderRadius: 14, padding: "1.8rem 2rem", marginBottom: "1.5rem", color: "#fff",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Fact-checking politique</h2>
            <p style={{ margin: "6px 0 0", opacity: 0.75, fontSize: 13 }}>
              {total.toLocaleString()} déclarations vérifiées · Sources : AFP Factuel, TF1 Info, Franceinfo, Le Monde…
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
            {[["vrai","Vrais",ov.pct_vrai], ["trompeur","Trompeurs",ov.pct_trompeur], ["faux","Faux",ov.pct_faux]].map(([k,l,v]) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: VERDICT_COLORS[k] }}>{v}%</div>
                <div style={{ opacity: 0.7 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1.2rem", flexWrap: "wrap" }}>
        {[["factchecks","Politiciens"], ["parties","Partis"], ["sources","Sources & Biais"], ["search","Recherche"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: tab === id ? "#1a3a6e" : "#e8ecf8",
            color: tab === id ? "#fff" : "#555",
          }}>{label}</button>
        ))}
      </div>

      {/* ── Onglet Politiciens ── */}
      {tab === "factchecks" && (
        <>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
            <RankingCard
              title="Politiciens les plus fiables"
              subtitle="Score net lissé : propos vrais − faux (sur déclarations du politicien, ≥3 FC). Cliquer pour voir les fact-checks."
              items={data.most_reliable || []}
              metric="pct_vrai" color="#27ae60"
              onClickPolitician={openPol}
            />
            <RankingCard
              title="Politiciens les moins fiables"
              subtitle="Score net lissé le plus bas (même méthode) — un politicien ne peut pas être dans les deux listes."
              items={data.least_reliable || []}
              metric="pct_faux" color="#e74c3c"
              onClickPolitician={openPol}
            />
          </div>

          {/* Les plus mentionnés */}
          {(data.most_mentioned || []).length > 0 && (
            <div style={{ background: "#fff", borderRadius: 14, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8", marginBottom: "1.5rem" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#1a2e5a" }}>Politiciens les plus impliqués</h3>
              <p style={{ margin: "0 0 1rem", fontSize: 11, color: "#aaa" }}>
                Toutes apparitions confondues — déclarations faites par eux + mentions par d'autres. Cliquer pour voir leurs fact-checks.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(data.most_mentioned || []).map((p, i) => (
                  <div key={i}
                    onClick={() => openPol(p)}
                    style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                    <span style={{ fontSize: 12, color: "#aaa", width: 20, textAlign: "right" }}>{i+1}.</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e5a", flex: 1 }}>{p.name}</span>
                    <span style={{ fontSize: 11, color: "#888" }}>{p.party}</span>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#1a3a6e" }}>{p.total_mentions}</span>
                      <span style={{ fontSize: 11, color: "#aaa", marginLeft: 4 }}>fact-checks</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#888", textAlign: "right", minWidth: 120 }}>
                      <span style={{ color: "#8e44ad" }}>{p.nb_déclarations} décl.</span>
                      {" · "}
                      <span style={{ color: "#555" }}>{p.nb_mentions} mentions</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Répartition globale */}
          <div style={{ background: "#fff", borderRadius: 14, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8", marginBottom: "1.5rem" }}>
            <h3 style={{ margin: "0 0 1rem", fontSize: 15, color: "#1a2e5a" }}>Répartition des verdicts</h3>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              {[
                ["Vrai / Plutôt vrai", ov.vrai, ov.pct_vrai, "vrai"],
                ["Trompeur / Hors contexte", ov.trompeur, ov.pct_trompeur, "trompeur"],
                ["Faux / Plutôt faux", ov.faux, ov.pct_faux, "faux"],
                ["Invérifiable", ov.invefi, ov.pct_invefi, "invefi"],
              ].map(([label, count, pct, key]) => (
                <div key={key} style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                    <span style={{ color: "#555" }}>{label}</span>
                    <span style={{ fontWeight: 700, color: VERDICT_COLORS[key] }}>{count}</span>
                  </div>
                  <div style={{ background: "#f0f0f0", borderRadius: 4, height: 10 }}>
                    <div style={{ width: `${pct}%`, background: VERDICT_COLORS[key], height: 10, borderRadius: 4 }} />
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#888", marginTop: 3 }}>{pct}%</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Onglet Partis ── */}
      {tab === "parties" && (
        <div style={{ display: "flex", gap: "1rem" }}>
          <RankingCard
            title="Partis les plus fiables"
            subtitle="Score net lissé (vrai − faux sur déclarations des membres, ≥3 FC). Tri unique — un parti ne peut pas être dans les deux listes."
            items={(data.most_reliable_p || []).map(p => ({ ...p, name: p.short + " – " + p.name }))}
            metric="pct_vrai" color="#27ae60"
            onClickPolitician={p => go({ q: p.short })}
          />
          <RankingCard
            title="Partis les moins fiables"
            subtitle="Score net lissé le plus bas — proportion de faux la plus élevée avec pondération du volume."
            items={(data.least_reliable_p || []).map(p => ({ ...p, name: p.short + " – " + p.name }))}
            metric="pct_faux" color="#e74c3c"
            onClickPolitician={p => go({ q: p.short })}
          />
        </div>
      )}

      {/* ── Onglet Recherche ── */}
      {tab === "search" && <SearchTab onSelectFc={openFc} />}

      {/* ── Onglet Sources & Biais ── */}
      {tab === "sources" && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#1a2e5a" }}>Sources de fact-checking référencées</h3>
          <p style={{ margin: "0 0 1.2rem", fontSize: 11, color: "#aaa" }}>
            Organismes ayant vérifié des déclarations de politiciens français — avec orientation éditoriale connue
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(data.sources || []).map((s, i) => {
              const bias = SOURCE_BIAS[s.name] || { lean: "Non classifié", color: "#95a5a6", owner: "?" };
              const barW = Math.round(s.count / (data.total || 1) * 100);
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 200px 120px 90px", alignItems: "center", gap: 14, padding: "10px 14px", borderRadius: 10, border: "1px solid #e8ecf8", background: "#fafbfe" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1a2e5a", marginBottom: 2 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>Propriétaire : {bias.owner}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: bias.color, fontWeight: 700 }}>{bias.lean}</span>
                      <span style={{ color: "#aaa" }}>{s.count} vérif.</span>
                    </div>
                    <div style={{ background: "#e8e8e8", borderRadius: 4, height: 6 }}>
                      <div style={{ width: `${barW}%`, background: bias.color, height: 6, borderRadius: 4 }} />
                    </div>
                  </div>
                  <div style={{
                    background: bias.color + "20", color: bias.color, border: `1px solid ${bias.color}44`,
                    borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, textAlign: "center",
                  }}>
                    {bias.lean}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a6e", textAlign: "right" }}>
                    {s.count} <span style={{ fontWeight: 400, color: "#888" }}>fact-checks</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: "#aaa", marginTop: 12 }}>
            ⚠ Les orientations éditoriales sont issues de sources publiques (rapports ARCOM, études académiques, déclarations d'actionnariat). Elles n'impliquent pas un parti pris systématique.
          </p>
        </div>
      )}

    </div>
  );
}
