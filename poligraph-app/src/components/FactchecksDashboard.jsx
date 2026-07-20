import { useState, useEffect, useCallback } from "react";
import candidatsData from "../data/candidats.json";

const BASE = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";

// Détecte si le claimant est une source virale/anonyme (pas un politicien nommé)
function isRumeurClaimant(claimant) {
  if (!claimant) return true;
  const l = claimant.toLowerCase();
  const tokens = ["réseau", "social", "publication", "sources", "multiple", "viral",
                  "web", "internet", "tweet", "facebook", "tiktok", "whatsapp",
                  "circule", "post", "anonyme", "inconnu", "divers", "médias",
                  "internaute", "utilisateur"];
  return tokens.some(t => l.includes(t)) || l.startsWith("des ") || l.startsWith("plusieurs ") || l === "multiple sources";
}

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
  const [summary,        setSummary]        = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [relatedFcs,     setRelatedFcs]     = useState(null);

  if (!fc) return null;
  const cfg  = verdictCfg(fc.verdictRating);
  const pols = (fc.politicians || []).map(p => p?.fullName).filter(Boolean);
  const date = fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : "";
  const rumeur = isRumeurClaimant(fc.claimant);

  // Pour les rumeurs : cherche d'autres FC sur le même sujet (mots-clés du titre)
  const loadRelated = () => {
    if (relatedFcs !== null) return;
    const words = (fc.claimText || "").split(/\s+/).filter(w => w.length > 4).slice(0, 4).join(" ");
    if (!words) { setRelatedFcs([]); return; }
    fetch(`${BASE}/search/factchecks?q=${encodeURIComponent(words)}&limit=6`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setRelatedFcs((d?.data || []).filter(r => r.claimText !== fc.claimText)))
      .catch(() => setRelatedFcs([]));
  };

  const analyze = () => {
    setLoadingSummary(true);
    fetch(`${BASE}/factcheck/summarize`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        claimText:     fc.claimText     || "",
        verdictRating: fc.verdictRating || "",
        claimant:      fc.claimant      || "",
        source:        fc.source        || "",
        publishedAt:   fc.publishedAt   || "",
        politicians:   pols,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setSummary(d?.summary || "Impossible de générer un résumé."))
      .catch(() => setSummary("Erreur réseau lors de la génération."))
      .finally(() => setLoadingSummary(false));
  };

  // Formatter le résumé markdown simple (gras)
  const renderSummary = (text) =>
    text.split(/\n/).map((line, i) => {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      return (
        <p key={i} style={{ margin: "4px 0", fontSize: 13, lineHeight: 1.65, color: "#333" }}>
          {parts.map((part, j) => j % 2 === 1
            ? <strong key={j} style={{ color: "#1a2e5a" }}>{part}</strong>
            : part
          )}
        </p>
      );
    });

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
          maxWidth: 680, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          position: "relative", maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 16, border: "none",
            background: "none", fontSize: 22, cursor: "pointer", color: "#aaa",
          }}
        >✕</button>

        {/* Verdict + source */}
        {(() => {
          const rumeur = isRumeurClaimant(fc.claimant);
          return (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: "1.2rem", flexWrap: "wrap" }}>
                <span style={{
                  background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`,
                  borderRadius: 12, padding: "4px 14px", fontSize: 14, fontWeight: 800,
                }}>
                  {cfg.label}
                </span>
                {rumeur && (
                  <span title="Cette affirmation provient de sources virales ou anonymes, non d'un politicien nommé"
                    style={{ fontSize: 11, background: "#fff3cd", color: "#856404", border: "1px solid #ffc10766", borderRadius: 10, padding: "2px 9px" }}>
                    Rumeur virale
                  </span>
                )}
                <span style={{ fontSize: 12, color: "#888" }}>Vérifié par {fc.source}</span>
                <span style={{ fontSize: 12, color: "#aaa", marginLeft: "auto" }}>{date}</span>
              </div>

              {/* Déclaration — mise en valeur */}
              <blockquote style={{
                fontSize: 16, fontWeight: 700, color: "#1a2e5a", lineHeight: 1.65,
                margin: "0 0 1.2rem", borderLeft: `5px solid ${cfg.color}`,
                paddingLeft: 16, background: cfg.bg + "55", borderRadius: "0 10px 10px 0",
                padding: "12px 12px 12px 16px",
              }}>
                « {fc.claimText || "Déclaration non renseignée"} »
              </blockquote>

              {/* Qui a dit quoi */}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: "1rem", fontSize: 13 }}>
                {fc.claimant && (
                  <div style={{ background: rumeur ? "#fffbea" : "#f0f4ff", borderRadius: 8, padding: "8px 12px", flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2 }}>
                      {rumeur ? "Origine de l'affirmation" : "Déclaré par"}
                    </div>
                    <div style={{ fontWeight: 700, color: rumeur ? "#856404" : "#1a2e5a" }}>
                      {rumeur ? (fc.claimant || "Sources virales / anonymes") : fc.claimant}
                    </div>
                  </div>
                )}
                {pols.length > 0 && pols.join(", ") !== fc.claimant && (
                  <div style={{ background: "#f8f0ff", borderRadius: 8, padding: "8px 12px", flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2 }}>Politicien(s) impliqué(s)</div>
                    <div style={{ fontWeight: 600, color: "#8e44ad" }}>{pols.join(", ")}</div>
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {/* Titre de l'article si disponible */}
        {fc.articleTitle && (
          <div style={{
            background: "#f8f9fc", borderRadius: 10, padding: "10px 14px",
            marginBottom: "1rem", fontSize: 13, color: "#555", lineHeight: 1.55,
            borderLeft: "3px solid #d0d8f0",
          }}>
            <span style={{ fontSize: 11, color: "#aaa", display: "block", marginBottom: 3 }}>Article :</span>
            {fc.articleTitle}
          </div>
        )}

        {/* Section analyse IA */}
        {!summary && (
          <button
            onClick={analyze}
            disabled={loadingSummary}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "12px 16px", borderRadius: 10,
              border: "2px dashed #d0d8f0", background: "#fafbfe",
              cursor: loadingSummary ? "wait" : "pointer", fontSize: 13,
              color: "#1a3a6e", fontWeight: 600, marginBottom: "1rem",
              transition: "border-color 0.2s",
            }}
            onMouseEnter={e => !loadingSummary && (e.currentTarget.style.borderColor = "#1a3a6e")}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#d0d8f0"}
          >
            <span style={{ fontSize: 18 }}>{loadingSummary ? "⏳" : "🤖"}</span>
            {loadingSummary
              ? "Analyse en cours (Groq + CamemBERT)…"
              : "Analyser avec PoliBot — contexte, preuves, explication complète"
            }
          </button>
        )}

        {summary && (
          <div style={{
            background: "linear-gradient(135deg, #f0f4ff, #f8f0ff)",
            borderRadius: 12, padding: "1rem 1.2rem", marginBottom: "1rem",
            border: "1px solid #d0d8f0",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6e" }}>🤖 Analyse PoliBot</span>
              <button
                onClick={() => { setSummary(null); }}
                style={{ border: "none", background: "none", fontSize: 11, color: "#aaa", cursor: "pointer" }}
              >
                Réinitialiser
              </button>
            </div>
            {renderSummary(summary)}
          </div>
        )}

        {/* Lien externe + sources liées pour les rumeurs */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {fc.sourceUrl && (
            <a
              href={fc.sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                padding: "9px 22px", borderRadius: 8,
                background: "#1a3a6e", color: "#fff",
                textDecoration: "none", fontWeight: 700, fontSize: 13,
              }}
            >
              {rumeur ? `Voir la vérification → ${fc.source}` : `Lire l'article complet → ${fc.source}`}
            </a>
          )}
          {rumeur && (
            <button
              onClick={loadRelated}
              style={{
                padding: "9px 16px", borderRadius: 8, border: "1px solid #d0d8f0",
                background: "#f8f9fc", color: "#555", cursor: "pointer", fontSize: 12, fontWeight: 600,
              }}
            >
              Voir d'autres fact-checks sur ce sujet
            </button>
          )}
        </div>

        {/* Fact-checks liés (pour rumeurs virales) */}
        {relatedFcs && relatedFcs.length > 0 && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid #e8ecf8", paddingTop: "1rem" }}>
            <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>
              Autres fact-checks sur ce sujet ({relatedFcs.length}) :
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {relatedFcs.map((r, i) => {
                const rcfg = verdictCfg(r.verdictRating);
                const rdate = r.publishedAt ? new Date(r.publishedAt).toLocaleDateString("fr-FR") : "";
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, padding: "6px 10px", background: "#fafbfe", borderRadius: 8, border: "1px solid #e8ecf8" }}>
                    <span style={{ background: rcfg.bg, color: rcfg.color, border: `1px solid ${rcfg.color}55`, borderRadius: 10, padding: "1px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{rcfg.label}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: "#1a2e5a" }}>{(r.claimText || "").slice(0, 120)}{r.claimText?.length > 120 ? "…" : ""}</span>
                      <span style={{ color: "#aaa", marginLeft: 6 }}>— {r.source} · {rdate}</span>
                    </div>
                    {r.sourceUrl && (
                      <a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#1a3a6e", fontWeight: 700, whiteSpace: "nowrap" }}>↗</a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {relatedFcs && relatedFcs.length === 0 && (
          <p style={{ fontSize: 12, color: "#bbb", marginTop: 8 }}>Aucun fact-check similaire trouvé dans la base.</p>
        )}
      </div>
    </div>
  );
}

// ── Panel fact-checks d'un politicien ────────────────────────────────────────
function PoliticianFcPanel({ politician, onClose, onSelectFc }) {
  const [ownFcs,   setOwnFcs]   = useState(null);   // déclarations faites PAR lui
  const [aboutFcs, setAboutFcs] = useState(null);   // mentions par d'autres
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!politician?.name) return;
    setLoading(true);
    setOwnFcs(null);
    setAboutFcs(null);
    const name = encodeURIComponent(politician.name);
    // Deux requêtes parallèles : claimant strict + mentions générales
    Promise.all([
      fetch(`${BASE}/search/factchecks?claimant=${name}&limit=100`).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/search/factchecks?q=${name}&limit=150`).then(r => r.ok ? r.json() : null),
    ]).then(([ownData, allData]) => {
      const own = ownData?.data || [];
      const ownIds = new Set(own.map(fc => fc.id || fc.claimText));
      // Exclure du flux "mentions" ceux déjà dans "own"
      const about = (allData?.data || []).filter(fc => !ownIds.has(fc.id || fc.claimText));
      setOwnFcs(own);
      setAboutFcs(about);
    }).catch(() => { setOwnFcs([]); setAboutFcs([]); })
      .finally(() => setLoading(false));
  }, [politician?.name]);

  if (!politician) return null;

  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  const FcCard = ({ fc }) => {
    const cfg     = verdictCfg(fc.verdictRating);
    const date    = fc.publishedAt ? new Date(fc.publishedAt).toLocaleDateString("fr-FR") : "";
    const rumeur  = isRumeurClaimant(fc.claimant);
    const showBy  = !rumeur && fc.claimant && norm(fc.claimant) !== norm(politician.name);
    return (
      <div
        onClick={() => onSelectFc(fc)}
        style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #e8ecf8", background: "#fafbfe", cursor: "pointer", transition: "box-shadow 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.10)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`, borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>
          {rumeur && (
            <span title="Affirmation virale / sources anonymes" style={{ fontSize: 10, background: "#fff3cd", color: "#856404", border: "1px solid #ffc10766", borderRadius: 10, padding: "1px 7px" }}>Rumeur virale</span>
          )}
          <span style={{ fontSize: 11, color: "#888" }}>Vérifié par {fc.source}</span>
          {showBy && <span style={{ fontSize: 11, color: "#8e44ad" }}>· déclaré par {fc.claimant}</span>}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#aaa" }}>{date}</span>
        </div>
        <div style={{ fontSize: 13, color: "#1a2e5a", lineHeight: 1.5 }}>
          « {(fc.claimText || "").slice(0, 180)}{(fc.claimText || "").length > 180 ? "…" : ""} »
        </div>
      </div>
    );
  };

  const Section = ({ title, color, bg, items, note }) => !items || items.length === 0 ? null : (
    <div style={{ marginBottom: "1.2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ width: 4, height: 18, borderRadius: 2, background: color }} />
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{title}</span>
        <span style={{ fontSize: 11, color: "#aaa", background: bg, borderRadius: 10, padding: "1px 8px" }}>{items.length}</span>
        {note && <span style={{ fontSize: 10, color: "#bbb", fontStyle: "italic" }}>{note}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((fc, i) => <FcCard key={i} fc={fc} />)}
      </div>
    </div>
  );

  const totalOwn   = politician.nb_déclarations ?? (ownFcs?.length ?? 0);
  const totalAbout = politician.nb_mentions      ?? (aboutFcs?.length ?? 0);

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
          <span style={{ fontSize: 11, background: "#eaf0ff", color: "#1a3a6e", borderRadius: 8, padding: "2px 8px" }}>
            {totalOwn} déclaration{totalOwn !== 1 ? "s" : ""} faite{totalOwn !== 1 ? "s" : ""} par lui
          </span>
          {totalAbout > 0 && (
            <span style={{ fontSize: 11, background: "#f5f0ff", color: "#8e44ad", borderRadius: 8, padding: "2px 8px" }}>
              {totalAbout} mention{totalAbout !== 1 ? "s" : ""} par d'autres
            </span>
          )}
        </div>

        {loading && <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>Chargement…</p>}
        {!loading && (!ownFcs?.length && !aboutFcs?.length) && (
          <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>Aucun fact-check trouvé.</p>
        )}
        {!loading && (
          <>
            <Section
              title="Déclarations faites par lui" color="#1a3a6e" bg="#eaf0ff"
              items={ownFcs}
              note={ownFcs && totalOwn > ownFcs.length ? `(${ownFcs.length} sur ${totalOwn} affichées)` : null}
            />
            <Section
              title="Fact-checks où il est mentionné" color="#8e44ad" bg="#f5f0ff"
              items={aboutFcs}
              note={aboutFcs && aboutFcs.length === 150 ? "(50 dernières affichées)" : null}
            />
          </>
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

// ── Onglet Match programme ───────────────────────────────────────────────────
const CANDIDATS = candidatsData.candidats;
const PROPOSITIONS = candidatsData.quiz.map(q => ({
  ...q,
  topic: q.theme,
  parties: q.positions,
}));

function MatchTab() {
  const [idx,      setIdx]      = useState(0);
  const [votes,    setVotes]    = useState({});
  const [done,     setDone]     = useState(false);
  const [animDir,    setAnimDir]    = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const total = PROPOSITIONS.length;
  const current = PROPOSITIONS[idx];

  const vote = (dir) => {
    if (animDir) return;
    setAnimDir(dir);
    setShowDetail(false);
    setTimeout(() => {
      const newVotes = { ...votes, [current.id]: dir };
      setVotes(newVotes);
      if (idx + 1 >= total) {
        setDone(true);
      } else {
        setIdx(i => i + 1);
      }
      setAnimDir(null);
    }, 280);
  };

  const computeScores = () => {
    const scores = {};
    CANDIDATS.forEach(c => { scores[c.id] = 0; });
    let counted = 0;
    Object.entries(votes).forEach(([propId, userVote]) => {
      if (userVote === "neutre") return;
      counted++;
      const prop = PROPOSITIONS.find(p => p.id === parseInt(propId));
      if (!prop) return;
      const userPos = userVote === "pour" ? 1 : -1;
      CANDIDATS.forEach(c => {
        const partyPos = prop.parties[c.id] ?? 0;
        if (partyPos !== 0 && partyPos === userPos) scores[c.id]++;
      });
    });
    return CANDIDATS
      .map(c => ({ ...c, pct: counted ? Math.round(scores[c.id] / counted * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
  };

  const reset = () => { setIdx(0); setVotes({}); setDone(false); setAnimDir(null); };

  if (done) {
    const ranked = computeScores();
    const best = ranked[0];
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "1rem 0" }}>
        <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", border: "1px solid #e8ecf8", textAlign: "center", marginBottom: "1.4rem" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎯</div>
          <h2 style={{ margin: "0 0 4px", color: "#1a2e5a", fontSize: 20 }}>Votre programme le plus proche</h2>
          <div style={{ fontSize: 32, margin: "12px 0 4px" }}>{best.emoji}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: best.couleur }}>{best.nom}</div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>{best.parti}</div>
          <div style={{ fontSize: 36, fontWeight: 900, color: best.couleur }}>{best.pct}%</div>
          <div style={{ fontSize: 12, color: "#aaa" }}>de compatibilité</div>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: "1.4rem", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", border: "1px solid #e8ecf8", marginBottom: "1rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: 14, color: "#1a2e5a" }}>Classement complet</h3>
          {ranked.map((c, i) => (
            <div key={c.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>
                  <span style={{ color: "#aaa", marginRight: 6 }}>{i + 1}.</span>
                  <span style={{ fontWeight: 700, color: c.couleur }}>{c.emoji} {c.nom}</span>
                  <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>{c.parti}</span>
                </span>
                <span style={{ fontWeight: 800, color: c.couleur, fontSize: 14 }}>{c.pct}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "#f0f2f8", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${c.pct}%`, background: c.couleur, borderRadius: 4, transition: "width 0.6s ease" }} />
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "#bbb", textAlign: "center", margin: "0 0 1rem" }}>
          Basé sur {Object.values(votes).filter(v => v !== "neutre").length} positions exprimées (hors neutres) sur {total} propositions.
          Les positions des partis sont indicatives et basées sur leurs programmes publics.
        </p>
        <button onClick={reset} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#1a3a6e", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          🔄 Recommencer le quiz
        </button>
      </div>
    );
  }

  const cardStyle = {
    transform: animDir === "pour" ? "translateX(120%) rotate(15deg)"
             : animDir === "contre" ? "translateX(-120%) rotate(-15deg)"
             : animDir === "neutre" ? "translateY(-80px) scale(0.9) opacity(0)"
             : "none",
    transition: animDir ? "transform 0.28s ease, opacity 0.28s ease" : "none",
    opacity: animDir ? 0 : 1,
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "1rem 0" }}>
      {/* Progress */}
      <div style={{ marginBottom: "1.2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 6 }}>
          <span>Question {idx + 1} / {total}</span>
          <span>{current.topic} {current.emoji}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "#e8ecf8", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${((idx) / total) * 100}%`, background: "#1a3a6e", transition: "width 0.3s ease", borderRadius: 3 }} />
        </div>
      </div>

      {/* Card */}
      <div style={{ ...cardStyle, background: "#fff", borderRadius: 20, padding: "2.5rem 2rem", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", border: "1px solid #e8ecf8", minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{current.emoji}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{current.topic}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1a2e5a", lineHeight: 1.55 }}>
          « {current.texte} »
        </div>
        {current.detail && (
          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => setShowDetail(v => !v)}
              style={{ background: "none", border: "1px solid #c8d0e8", borderRadius: 8, padding: "4px 12px", fontSize: 12, color: "#5a7abf", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              ℹ️ {showDetail ? "Masquer le contexte" : "En savoir plus"}
            </button>
            {showDetail && (
              <div style={{ marginTop: 10, padding: "12px 14px", background: "#f4f6fb", borderRadius: 10, fontSize: 12, color: "#444", lineHeight: 1.6, textAlign: "left" }}>
                {current.detail}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Boutons */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button
          onClick={() => vote("contre")}
          style={{ flex: 1, padding: "16px 8px", borderRadius: 14, border: "2px solid #e74c3c", background: "#fff", cursor: "pointer", fontSize: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#fdedec"}
          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
        >
          ❌
          <span style={{ fontSize: 11, fontWeight: 700, color: "#e74c3c" }}>Contre</span>
        </button>
        <button
          onClick={() => vote("neutre")}
          style={{ flex: 0.7, padding: "16px 8px", borderRadius: 14, border: "2px solid #bbb", background: "#fff", cursor: "pointer", fontSize: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
        >
          😐
          <span style={{ fontSize: 11, fontWeight: 700, color: "#888" }}>Neutre</span>
        </button>
        <button
          onClick={() => vote("pour")}
          style={{ flex: 1, padding: "16px 8px", borderRadius: 14, border: "2px solid #27ae60", background: "#fff", cursor: "pointer", fontSize: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#eafaf1"}
          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
        >
          ✅
          <span style={{ fontSize: 11, fontWeight: 700, color: "#27ae60" }}>Pour</span>
        </button>
      </div>

      <p style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginTop: "1.2rem" }}>
        Positions basées sur les programmes publics des partis — à titre indicatif
      </p>
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
export default function FactchecksDashboard({ onNavigate, initialTab }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState(initialTab || "factchecks");

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
        {[["factchecks","Politiciens"], ["parties","Partis"], ["sources","Sources & Biais"], ["search","Recherche"], ["match","🗳️ Mon programme"]].map(([id, label]) => (
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

      {/* ── Onglet Mon programme ── */}
      {tab === "match" && <MatchTab />}

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
