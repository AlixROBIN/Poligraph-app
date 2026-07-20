import { useState, useEffect } from "react";

const BASE = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";

// Biais éditoriaux connus des sources françaises
const SOURCE_BIAS = {
  "TF1 Info":           { lean: "Centre-droite", party: "—",  color: "#e67e22", owner: "Bouygues" },
  "AFP Factuel":        { lean: "Neutre",         party: "—",  color: "#27ae60", owner: "Agence publique" },
  "Franceinfo":         { lean: "Neutre",         party: "—",  color: "#2980b9", owner: "Service public (État)" },
  "20 Minutes":         { lean: "Centre",         party: "—",  color: "#8e44ad", owner: "Rossel" },
  "Le Monde":           { lean: "Centre-gauche",  party: "PS/EELV", color: "#2c3e50", owner: "Xavier Niel / Matthieu Pigasse" },
  "Libération":         { lean: "Centre-gauche",  party: "PS", color: "#e74c3c", owner: "Altice (Drahi)" },
  "Le Dauphiné Libéré": { lean: "Centre",         party: "—",  color: "#16a085", owner: "EBRA (Crédit Mutuel)" },
  "DE FACTO":           { lean: "Indépendant",    party: "—",  color: "#7f8c8d", owner: "ONG journaliste" },
};

const VERDICT_COLORS = {
  vrai:     "#27ae60",
  trompeur: "#f39c12",
  faux:     "#e74c3c",
  invefi:   "#95a5a6",
};

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
                {p.party && <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>{p.party} · {p.total} fact-checks</span>}
                {p.short && <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>{p.total} fact-checks</span>}
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

const VERDICT_LABELS = {
  TRUE:          { label: "Vrai",           color: "#27ae60", bg: "#eafaf1" },
  MOSTLY_TRUE:   { label: "Plutôt vrai",    color: "#2ecc71", bg: "#f0faf4" },
  HALF_TRUE:     { label: "Mi-vrai",        color: "#f39c12", bg: "#fef9e7" },
  MISLEADING:    { label: "Trompeur",       color: "#e67e22", bg: "#fdf2e9" },
  FALSE:         { label: "Faux",           color: "#e74c3c", bg: "#fdedec" },
  MOSTLY_FALSE:  { label: "Plutôt faux",    color: "#c0392b", bg: "#fde8e6" },
  UNVERIFIABLE:  { label: "Invérifiable",   color: "#95a5a6", bg: "#f2f3f4" },
};

function SearchTab() {
  const [query,        setQuery]        = useState("");
  const [verdictFilter,setVerdictFilter] = useState("");
  const [results,      setResults]      = useState(null);
  const [searching,    setSearching]    = useState(false);

  const doSearch = () => {
    setSearching(true);
    const params = new URLSearchParams({ limit: 30 });
    if (query)         params.set("q", query);
    if (verdictFilter) params.set("verdictRating", verdictFilter);
    fetch(`${BASE}/proxy/factchecks?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setResults(d?.data || []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8" }}>
      <h3 style={{ margin: "0 0 1rem", fontSize: 15, color: "#1a2e5a" }}>Rechercher un fact-check</h3>

      {/* Filtres */}
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

      {/* Résultats */}
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
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#888" }}>{results.length} résultat(s)</p>
          {results.map((fc, i) => {
            const cfg = VERDICT_LABELS[fc.verdictRating] || { label: fc.verdictRating, color: "#888", bg: "#f5f5f5" };
            const pols = (fc.politicians || []).map(p => p?.fullName).filter(Boolean);
            return (
              <a key={i} href={fc.sourceUrl} target="_blank" rel="noreferrer"
                style={{ display: "block", textDecoration: "none", color: "inherit", padding: "12px 14px", borderRadius: 10, border: "1px solid #e8ecf8", background: "#fafbfe", transition: "box-shadow 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.10)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`, borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
                    {cfg.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#888" }}>{fc.source}</span>
                  {pols.length > 0 && <span style={{ fontSize: 11, color: "#8e44ad", fontWeight: 600 }}>{pols.join(", ")}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#aaa" }}>
                    {fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : ""}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#1a2e5a", lineHeight: 1.5 }}>
                  « {(fc.claimText || "").slice(0, 200)}{(fc.claimText || "").length > 200 ? "…" : ""} »
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function FactchecksDashboard({ onNavigate }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState("factchecks");

  useEffect(() => {
    fetch(`${BASE}/dashboard/factchecks`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const go = (filters) => onNavigate("exploration", { tab: "factchecks", ...filters });

  if (loading) return <p style={{ padding: "2rem", color: "#888" }}>Chargement des {817} fact-checks… (~10s première fois)</p>;
  if (!data)   return <p style={{ padding: "2rem", color: "red" }}>Impossible de charger le dashboard fact-checks.</p>;

  const ov = data.verdicts_globaux || {};
  const total = data.total || 0;

  return (
    <div style={{ padding: "1.5rem", background: "#f5f6fa", minHeight: "100vh" }}>

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
              subtitle="Par proportion de propos vérifiés vrais (≥5 fact-checks)"
              items={data.most_reliable || []}
              metric="pct_vrai" color="#27ae60"
              onClickPolitician={p => onNavigate("annuaire", { q: p.name })}
            />
            <RankingCard
              title="Politiciens les moins fiables"
              subtitle="Par proportion de propos vérifiés faux (≥5 fact-checks)"
              items={data.least_reliable || []}
              metric="pct_faux" color="#e74c3c"
              onClickPolitician={p => onNavigate("annuaire", { q: p.name })}
            />
          </div>

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
            {/* Légende */}
            <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 11, flexWrap: "wrap" }}>
              {Object.entries(VERDICT_COLORS).map(([k, c]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
                  <span style={{ color: "#555", textTransform: "capitalize" }}>{k}</span>
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
            subtitle="Par proportion de propos vérifiés vrais (≥5 fact-checks)"
            items={(data.most_reliable_p || []).map(p => ({ ...p, name: p.short + " – " + p.name }))}
            metric="pct_vrai" color="#27ae60"
            onClickPolitician={p => go({ q: p.short })}
          />
          <RankingCard
            title="Partis les moins fiables"
            subtitle="Par proportion de propos vérifiés faux (≥5 fact-checks)"
            items={(data.least_reliable_p || []).map(p => ({ ...p, name: p.short + " – " + p.name }))}
            metric="pct_faux" color="#e74c3c"
            onClickPolitician={p => go({ q: p.short })}
          />
        </div>
      )}

      {/* ── Onglet Recherche ── */}
      {tab === "search" && <SearchTab />}

      {/* ── Onglet Sources & Biais ── */}
      {tab === "sources" && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#1a2e5a" }}>Sources de fact-checking référencées</h3>
          <p style={{ margin: "0 0 1.2rem", fontSize: 11, color: "#aaa" }}>
            Organismes ayant vérifié des déclarations de politiciens français — avec orientation éditoriale connue
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(data.sources || []).map((s, i) => {
              const bias = SOURCE_BIAS[s.name] || { lean: "Non classifié", party: "—", color: "#95a5a6", owner: "?" };
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
