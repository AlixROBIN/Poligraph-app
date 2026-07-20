import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchJSON, sendChat } from "../data/api";

// ── Config sources ────────────────────────────────────────────────────────────

const SOURCES_CONFIG = {
  // ── Presse ──────────────────────────────────────────────────────────────
  lemonde:                { label: "Le Monde",             type: "presse", color: "#0066CC", bg: "#e8f0fb",
    owner: "Groupe Le Monde (Xavier Niel, Matthieu Pigasse…)", lean: "Centre-gauche", leanColor: "#2980b9" },
  lefigaro:               { label: "Le Figaro",            type: "presse", color: "#C00000", bg: "#fdecea",
    owner: "Groupe Dassault (famille Dassault)", lean: "Droite", leanColor: "#c0392b" },
  liberation:             { label: "Libération",           type: "presse", color: "#E4002B", bg: "#fff0f0",
    owner: "Altice France (Patrick Drahi)", lean: "Centre-gauche", leanColor: "#2980b9" },
  franceinfo:             { label: "France Info",          type: "presse", color: "#003189", bg: "#e8eaf6",
    owner: "Service public (État français)", lean: "Neutre institutionnel", leanColor: "#7f8c8d" },
  lepoint:                { label: "Le Point",             type: "presse", color: "#2c2c2c", bg: "#f5f5f5",
    owner: "Artémis (famille Pinault/Kering)", lean: "Centre-droit", leanColor: "#e67e22" },
  "googlenews/politique": { label: "Google News",          type: "presse", color: "#4285F4", bg: "#e8f0fe",
    owner: "Google (Alphabet Inc.)", lean: "Agrégateur neutre", leanColor: "#7f8c8d" },
  "googlenews/parlement": { label: "Google News · Parl.",  type: "presse", color: "#4285F4", bg: "#e8f0fe",
    owner: "Google (Alphabet Inc.)", lean: "Agrégateur neutre", leanColor: "#7f8c8d" },
};

const TYPE_ICON = { presse: "📰" };

const SENTIMENT_CFG = {
  POSITIVE: {
    color: "#27ae60", bg: "#eafaf1", bar: "#2ecc71",
    label: "Ton favorable",
    sublabel: "L'auteur semble porter un regard positif sur le sujet — possible biais favorable",
    icon: "↑",
  },
  NEGATIVE: {
    color: "#c0392b", bg: "#fdedec", bar: "#e74c3c",
    label: "Ton critique",
    sublabel: "L'auteur exprime une opinion négative — possible biais défavorable au sujet",
    icon: "↓",
  },
  NEUTRAL: {
    color: "#7f8c8d", bg: "#f2f3f4", bar: "#bbb",
    label: "Ton équilibré",
    sublabel: "Aucun biais apparent détecté — l'article semble traiter le sujet de façon neutre",
    icon: "=",
  },
  UNKNOWN: { color: "#bbb", bg: "#f5f5f5", label: "–", sublabel: "", icon: "?", bar: "#eee" },
};

const PRESS_SOURCES = [
  "lemonde", "lefigaro", "liberation", "franceinfo", "lepoint",
  "googlenews/politique", "googlenews/parlement",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function getSourceCfg(source) {
  if (!source) return { label: source, type: "presse", color: "#1a3a6e", bg: "#f0f2f8" };
  const key = Object.keys(SOURCES_CONFIG).find(k => source.startsWith(k));
  return SOURCES_CONFIG[key] || { label: source, type: "presse", color: "#1a3a6e", bg: "#f0f2f8" };
}

// ── Atomes réutilisables ──────────────────────────────────────────────────────

function SourceBadge({ source }) {
  const cfg = getSourceCfg(source);
  const tooltip = cfg.owner
    ? `Propriétaire : ${cfg.owner}\nOrientation : ${cfg.lean}`
    : cfg.label;
  return (
    <span title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33`,
      textTransform: "uppercase", letterSpacing: "0.4px", cursor: "help",
    }}>
      <span>{TYPE_ICON[cfg.type]}</span>
      {cfg.label}
      {cfg.lean && (
        <span style={{
          fontSize: 9, background: cfg.leanColor + "22", color: cfg.leanColor,
          borderRadius: 3, padding: "1px 4px", fontWeight: 700, marginLeft: 2,
        }}>
          {cfg.lean.split(" ")[0]}
        </span>
      )}
    </span>
  );
}

function SentimentBadge({ label, score, entities }) {
  if (!label || label === "UNKNOWN") return null;
  const cfg = SENTIMENT_CFG[label] || SENTIMENT_CFG.NEUTRAL;
  const subject = entities?.length > 0 ? entities[0] : null;
  const tooltip = cfg.sublabel
    + (subject ? `\n→ Sujet détecté : ${entities.slice(0, 3).join(", ")}` : "");
  return (
    <span title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color, cursor: "help", flexWrap: "nowrap",
    }}>
      <span style={{ fontWeight: 700, fontSize: 10 }}>{cfg.icon}</span>
      {cfg.label}
      {subject && (
        <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 10 }}>
          {" envers "}<em>{subject}</em>
        </span>
      )}
      {score != null && (
        <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 10 }}>
          {score > 0 ? ` +${score.toFixed(2)}` : ` ${score.toFixed(2)}`}
        </span>
      )}
    </span>
  );
}

function EntityTag({ name }) {
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: "#fef9e7", color: "#c9a227", border: "1px solid #f0c04033",
    }}>
      {name}
    </span>
  );
}

function Keyword({ word }) {
  return (
    <span style={{
      padding: "2px 7px", borderRadius: 10, fontSize: 11,
      background: "#f0f2f8", color: "#4a6fa5",
    }}>
      {word}
    </span>
  );
}

// ── Gauge sentiment ───────────────────────────────────────────────────────────

function SentimentGauge({ label, score }) {
  if (!label || label === "UNKNOWN") return null;
  const cfg = SENTIMENT_CFG[label] || SENTIMENT_CFG.NEUTRAL;
  // score ∈ [-1, +1] → pct width from 0%–100% mapped to -1→0 / 0→50% / +1→100%
  const absScore = score != null ? Math.abs(score) : 0;
  const pct = Math.round(absScore * 100);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
        <span style={{ color: "#888" }}>
          {score != null ? (score > 0 ? `+${score.toFixed(3)}` : score.toFixed(3)) : "—"}
        </span>
      </div>
      <div style={{ background: "#f0f2f8", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: 8, borderRadius: 4,
          background: cfg.bar,
          transition: "width 0.5s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#bbb", marginTop: 2 }}>
        <span>0</span><span>50%</span><span>100%</span>
      </div>
    </div>
  );
}

// ── Modal / drawer article ────────────────────────────────────────────────────

function ArticleDrawer({ article, onClose, kafkaAvailable }) {
  const cfg      = getSourceCfg(article.source);
  const isSocial = false;
  const [polibotAnalysis, setPolibotAnalysis] = useState(null);
  const [polibotLoading,  setPolibotLoading]  = useState(false);
  const [polibotError,    setPolibotError]    = useState(null);

  const analyzeWithPoliBot = async () => {
    setPolibotLoading(true);
    setPolibotError(null);
    try {
      const question = `Analyse politique de cet article : "${article.title}". ${article.summary || ""}. Quels politiciens ou partis sont impliqués ? Y a-t-il des fact-checks liés dans ta base ?`;
      const data = await sendChat({ message: question });
      setPolibotAnalysis(data.response || data.message || "Aucune analyse disponible.");
    } catch (e) {
      setPolibotError("Erreur lors de l'analyse PoliBot.");
    } finally {
      setPolibotLoading(false);
    }
  };

  // Fermer avec Échap
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(10,20,50,0.45)",
          zIndex: 1000, backdropFilter: "blur(2px)",
        }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(540px, 100vw)",
        background: "#fff",
        zIndex: 1001,
        overflowY: "auto",
        boxShadow: "-6px 0 30px rgba(10,20,50,0.18)",
        display: "flex", flexDirection: "column",
        animation: "slideIn 0.22s ease",
      }}>

        {/* ── Header drawer ─────────────────────────────────────────── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "#fff",
          borderBottom: "1px solid #e8ecf8",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <SourceBadge source={article.source} />
          <SentimentBadge label={article.sentiment_label} score={article.sentiment} />
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", background: "none", border: "none",
              cursor: "pointer", fontSize: 20, color: "#888",
              width: 32, height: 32, display: "flex", alignItems: "center",
              justifyContent: "center", borderRadius: "50%",
            }}
            title="Fermer (Échap)"
          >×</button>
        </div>

        {/* ── Corps ─────────────────────────────────────────────────── */}
        <div style={{ padding: "20px 24px", flex: 1 }}>

          {/* Titre */}
          <h2 style={{
            fontSize: 18, fontWeight: 800, color: "#1a2e5a",
            lineHeight: 1.5, margin: "0 0 6px",
          }}>
            {article.title || "Sans titre"}
          </h2>

          {/* Méta date */}
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>
            Publié le {formatDate(article.published_at)}
            {article.processed_at && (
              <span> · Analysé le {formatDate(article.processed_at)}</span>
            )}
          </div>

          {/* Séparateur tricolore */}
          <div style={{ display: "flex", height: 2, borderRadius: 2, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ flex: 1, background: "#002395" }} />
            <div style={{ flex: 1, background: "#fff", border: "1px solid #e0e0e0" }} />
            <div style={{ flex: 1, background: "#ED2939" }} />
          </div>

          {/* Résumé / texte complet */}
          {article.summary ? (
            <div style={{ marginBottom: 20 }}>
              <p style={{
                fontSize: 13, color: "#444", lineHeight: 1.75,
                margin: 0,
                fontStyle: isSocial ? "italic" : "normal",
                borderLeft: isSocial ? `3px solid ${cfg.color}55` : "none",
                paddingLeft: isSocial ? 14 : 0,
              }}>
                {article.summary}
              </p>
            </div>
          ) : (
            <p style={{ color: "#bbb", fontSize: 13, marginBottom: 20 }}>
              Aucun résumé disponible.
            </p>
          )}

          {/* Entités détectées */}
          {article.entities?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={sectionLabel}>
                {isSocial ? "Mentionné dans le contexte de" : "Personnalités & partis cités"}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {article.entities.map((e, i) => <EntityTag key={i} name={e} />)}
              </div>
            </div>
          )}

          {/* Mots-clés NLP */}
          {article.keywords?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={sectionLabel}>Mots-clés extraits</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {article.keywords.map((k, i) => <Keyword key={i} word={k} />)}
              </div>
            </div>
          )}

          {/* Analyse sentiment */}
          <div style={{
            background: "#f8f9ff", borderRadius: 10, padding: "16px 18px", marginBottom: 20,
            border: "1px solid #e8ecf8",
          }}>
            <p style={{ ...sectionLabel, marginBottom: 12 }}>Analyse de sentiment</p>
            {article.sentiment_label && article.sentiment_label !== "UNKNOWN" ? (() => {
              const scfg = SENTIMENT_CFG[article.sentiment_label] || SENTIMENT_CFG.NEUTRAL;
              return (
                <>
                  <p style={{ fontSize: 13, color: "#444", lineHeight: 1.7, margin: "0 0 12px" }}>
                    Cet article exprime un{" "}
                    <strong style={{ color: scfg.color }}>{scfg.label.toLowerCase()}</strong>
                    {article.entities?.length > 0 && (
                      <> envers{" "}
                        <strong>{article.entities.slice(0, 3).join(", ")}</strong>
                      </>
                    )}.{" "}
                    <span style={{ color: "#888", fontSize: 12 }}>{scfg.sublabel}.</span>
                  </p>
                  <SentimentGauge label={article.sentiment_label} score={article.sentiment} />
                </>
              );
            })() : (
              <p style={{ fontSize: 12, color: "#bbb", margin: 0 }}>
                {article.enriched
                  ? "Score non disponible pour cet article."
                  : "Article non encore analysé par Spark/DistilBERT. Démarrez la stack Kafka pour l'enrichissement en temps réel."}
              </p>
            )}
          </div>

          {/* Infos pipeline */}
          <div style={{
            background: article.enriched ? "#eafaf1" : "#fafafa",
            borderRadius: 8, padding: "12px 16px", marginBottom: 20,
            border: `1px solid ${article.enriched ? "#2ecc7133" : "#e0e0e0"}`,
            fontSize: 12,
          }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700,
              color: article.enriched ? "#1e8449" : "#888" }}>
              {article.enriched ? "✓ Traité par le pipeline Spark" : "⏳ Non enrichi (RSS direct)"}
            </p>
            <div style={{ color: "#666", lineHeight: 1.7 }}>
              <span>Source : <strong>{cfg.label}</strong></span>
              {article.enriched && (
                <>
                  <span style={{ margin: "0 8px", color: "#ddd" }}>|</span>
                  <span>{kafkaAvailable ? "Kafka → " : ""}Spark → DistilBERT → features</span>
                </>
              )}
            </div>
          </div>

          {/* PoliBot analyse */}
          <div style={{ marginBottom: 20 }}>
            {!polibotAnalysis && !polibotLoading && (
              <button
                onClick={analyzeWithPoliBot}
                style={{
                  width: "100%", padding: "11px 16px", borderRadius: 10,
                  border: "1.5px solid #1a3a6e", background: "#f0f4ff",
                  color: "#1a3a6e", fontWeight: 700, fontSize: 13,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#dce6ff"}
                onMouseLeave={e => e.currentTarget.style.background = "#f0f4ff"}
              >
                🤖 Analyser avec PoliBot
              </button>
            )}
            {polibotLoading && (
              <div style={{ textAlign: "center", color: "#888", fontSize: 13, padding: "12px 0" }}>
                🤖 PoliBot analyse l'article…
              </div>
            )}
            {polibotError && (
              <p style={{ color: "#e74c3c", fontSize: 12, margin: 0 }}>{polibotError}</p>
            )}
            {polibotAnalysis && (
              <div style={{
                background: "#f0f4ff", borderRadius: 10, padding: "14px 16px",
                border: "1.5px solid #c5d3f0",
              }}>
                <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#7a8aaa", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                  🤖 Analyse PoliBot
                </p>
                <p style={{ margin: 0, fontSize: 13, color: "#333", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {polibotAnalysis}
                </p>
              </div>
            )}
          </div>

          {/* URL — bouton principal */}
          {article.url && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, padding: "12px 20px",
                background: cfg.color, color: "#fff",
                borderRadius: 8, textDecoration: "none",
                fontWeight: 700, fontSize: 14,
                boxShadow: `0 2px 8px ${cfg.color}55`,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}
            >
              {isSocial ? "Voir le post original →" : "Lire l'article complet →"}
            </a>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

const sectionLabel = {
  fontSize: 11, fontWeight: 700, color: "#7a8aaa",
  textTransform: "uppercase", letterSpacing: "0.6px",
  margin: "0 0 8px",
};

// ── Carte article (liste) ─────────────────────────────────────────────────────

function ArticleCard({ article, onOpen }) {
  const cfg      = getSourceCfg(article.source);
  const isSocial = false;

  const handleClick = e => {
    // Ne pas ouvrir le drawer si on clique sur un lien externe
    if (e.target.tagName === "A" || e.target.closest("a")) return;
    onOpen(article);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        background: "#fff", borderRadius: 10, overflow: "hidden",
        marginBottom: "1rem", boxShadow: "0 1px 4px rgba(26,58,110,0.07)",
        border: "1px solid #e8ecf8",
        borderLeft: `3px solid ${cfg.color}`,
        cursor: "pointer",
        transition: "box-shadow 0.2s, transform 0.15s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "0 4px 18px rgba(26,58,110,0.14)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(26,58,110,0.07)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div style={{ padding: "1rem 1.2rem" }}>

        {/* Ligne 1 — source + sentiment + date */}
        <div style={{ display: "flex", alignItems: "center", gap: 8,
          marginBottom: 10, flexWrap: "wrap" }}>
          <SourceBadge source={article.source} />
          <SentimentBadge label={article.sentiment_label} score={article.sentiment} entities={article.entities} />
          {!article.enriched && (
            <span style={{ fontSize: 11, color: "#bbb", fontStyle: "italic" }}>non analysé</span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#aaa" }}>
            {formatDate(article.published_at)}
          </span>
        </div>

        {/* Titre */}
        <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700,
          color: "#1a2e5a", lineHeight: 1.45 }}>
          {article.title}
        </h3>

        {/* Entités */}
        {article.entities?.length > 0 && (
          <div style={{
            background: "#f8f9ff", borderRadius: 6, padding: "7px 11px",
            marginBottom: 10, fontSize: 13,
          }}>
            <span style={{ color: "#7a8aaa", fontSize: 11, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {isSocial ? "Mentionné" : "Cités"}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
              {article.entities.map((e, i) => <EntityTag key={i} name={e} />)}
            </div>
          </div>
        )}

        {/* Résumé tronqué */}
        {article.summary && (
          <p style={{
            margin: "0 0 10px", fontSize: 13, color: "#555", lineHeight: 1.65,
            fontStyle: isSocial ? "italic" : "normal",
            borderLeft: isSocial ? "3px solid #e0e0e0" : "none",
            paddingLeft: isSocial ? 10 : 0,
          }}>
            {article.summary.slice(0, 160)}
            {article.summary.length > 160 && (
              <span style={{ color: "#1a3a6e", fontWeight: 600, fontSize: 12 }}> … voir plus</span>
            )}
          </p>
        )}

        {/* Mots-clés */}
        {article.keywords?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {article.keywords.slice(0, 5).map((k, i) => <Keyword key={i} word={k} />)}
            {article.keywords.length > 5 && (
              <span style={{ fontSize: 11, color: "#aaa", alignSelf: "center" }}>
                +{article.keywords.length - 5}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", paddingTop: 8,
          borderTop: "1px solid #f0f2f8",
        }}>
          <span style={{ fontSize: 11, color: "#bbb" }}>{article.source}</span>
          <span style={{ fontSize: 12, color: cfg.color, fontWeight: 600 }}>
            Voir le détail →
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Multi-select dropdown ─────────────────────────────────────────────────────

function CheckItem({ label, checked, onChange, color }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 14px", cursor: "pointer",
      background: checked ? "#eef2ff" : "transparent",
      transition: "background 0.1s",
    }}
    onMouseEnter={e => { if (!checked) e.currentTarget.style.background = "#f8f9fc"; }}
    onMouseLeave={e => { if (!checked) e.currentTarget.style.background = "transparent"; }}
    >
      <input type="checkbox" checked={checked} onChange={onChange}
        style={{ accentColor: color || "#1a3a6e", width: 14, height: 14 }} />
      <span style={{ fontSize: 13, color: color || "#1a2e5a", fontWeight: checked ? 600 : 400 }}>
        {label}
      </span>
    </label>
  );
}

function MultiSelectDropdown({ label, selected, onToggle, onClear, groups, totalCount }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const count = selected.length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 12px", borderRadius: 8,
        border: count > 0 ? "1px solid #1a3a6e" : "1px solid #d4ddf7",
        background: count > 0 ? "#1a3a6e" : "#f8f9fc",
        color: count > 0 ? "#fff" : "#1a2e5a",
        cursor: "pointer", fontSize: 13, fontWeight: 600, minWidth: 130,
      }}>
        <span>{label}</span>
        {count > 0 && (
          <span style={{
            background: "rgba(255,255,255,0.3)", borderRadius: 10,
            padding: "1px 7px", fontSize: 11,
          }}>{count}</span>
        )}
        {totalCount !== undefined && count === 0 && (
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: "auto" }}>({totalCount})</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
          background: "#fff", borderRadius: 10,
          boxShadow: "0 8px 28px rgba(0,0,0,0.14)",
          border: "1px solid #e8ecf8",
          minWidth: 220, maxHeight: 320, overflowY: "auto",
          padding: "6px 0",
        }}>
          {count > 0 && (
            <button onClick={() => { onClear(); setOpen(false); }} style={{
              width: "100%", textAlign: "left", padding: "6px 14px",
              background: "none", border: "none", borderBottom: "1px solid #f0f0f0",
              color: "#e74c3c", fontSize: 12, fontWeight: 600, cursor: "pointer",
              marginBottom: 4,
            }}>
              Tout désélectionner ✕
            </button>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              {g.label && (
                <div style={{
                  padding: "5px 14px 2px", fontSize: 10, fontWeight: 700,
                  color: "#aaa", textTransform: "uppercase", letterSpacing: "0.5px",
                  borderTop: "1px solid #f5f5f5", marginTop: 4,
                }}>
                  {g.label}
                </div>
              )}
              {g.options.map((opt) => (
                <CheckItem
                  key={opt.value}
                  label={opt.label}
                  checked={selected.includes(opt.value)}
                  color={opt.color}
                  onChange={() => onToggle(opt.value)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

const JournalPage = () => {
  const [allArticles, setAllArticles]       = useState([]);
  const [loading, setLoading]               = useState(true);
  const [wsStatus, setWsStatus]             = useState("connecting");
  const [filterTypes, setFilterTypes]       = useState([]);
  const [filterSources, setFilterSources]   = useState([]);
  const [filterSentiments, setFilterSentiments] = useState([]);
  const [kafkaAvailable, setKafkaAvailable] = useState(false);
  const [enriched, setEnriched]             = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const wsRef = useRef(null);

  const fetchArticles = useCallback(async () => {
    try {
      const data = await fetchJSON(`/api/journal?n=100`);
      setAllArticles(data.articles || []);
      setKafkaAvailable(data.kafka_available);
      setEnriched(data.enriched);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Client-side filtering
  const articles = useMemo(() => {
    let arts = allArticles;
    if (filterTypes.length > 0)
      arts = arts.filter(a => filterTypes.includes(getSourceCfg(a.source).type));
    if (filterSources.length > 0)
      arts = arts.filter(a => filterSources.some(s => a.source?.startsWith(s) || a.source === s));
    if (filterSentiments.length > 0)
      arts = arts.filter(a => filterSentiments.includes(a.sentiment_label));
    return arts;
  }, [allArticles, filterTypes, filterSources, filterSentiments]);

  const toggle = (setter) => (val) =>
    setter(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);

  useEffect(() => {
    fetchArticles();
    const interval = setInterval(fetchArticles, 30_000);
    return () => clearInterval(interval);
  }, [fetchArticles]);

  useEffect(() => {
    const apiBase = (process.env.REACT_APP_API_URL || "http://localhost:8000").replace(/^http/, "ws");
    let reconnectTimer = null;
    let dead = false;

    function connect() {
      if (dead) return;
      setWsStatus("connecting");
      const ws = new WebSocket(`${apiBase}/ws/stream`);
      wsRef.current = ws;
      ws.onopen    = () => setWsStatus("connected");
      ws.onmessage = () => fetchArticles();
      ws.onclose   = () => {
        if (!dead) {
          setWsStatus("disconnected");
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
      ws.onerror   = () => {
        ws.close();
      };
    }

    connect();
    return () => {
      dead = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchArticles]);

  const wsColor = { connected: "#2ecc71", connecting: "#f39c12", disconnected: "#e74c3c", error: "#e74c3c" }[wsStatus];

  const presseCount = allArticles.filter(a => getSourceCfg(a.source).type === "presse").length;
  const socialCount = allArticles.filter(a => getSourceCfg(a.source).type === "social").length;
  const hasFilters  = filterTypes.length > 0 || filterSources.length > 0 || filterSentiments.length > 0;

  return (
    <div style={{ padding: "1.5rem" }}>

      {/* Drawer modal */}
      {selectedArticle && (
        <ArticleDrawer
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
          kafkaAvailable={kafkaAvailable}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "0.3rem" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(135deg, #1a3a6e 60%, #c9a227 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, color: "#fff", fontWeight: 900, flexShrink: 0,
        }}>📰</div>
        <div>
          <h2 style={{ marginBottom: "0.1rem", color: "#1a2e5a" }}>Journal en direct</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: wsColor,
              display: "inline-block",
              animation: wsStatus === "connected" ? "pulse 2s infinite" : "none",
            }} />
            <span style={{ color: "#7a8aaa", fontSize: 13 }}>
              {wsStatus === "connected" ? "Flux en direct" : wsStatus === "connecting" ? "Connexion…" : "Hors ligne"}
              {enriched && " · Analyse NLP active (DistilBERT + Spark)"}
              {!enriched && kafkaAvailable && " · Articles bruts (Spark non encore actif)"}
              {!kafkaAvailable && " · RSS direct (Kafka non démarré)"}
            </span>
          </div>
        </div>
        <button onClick={fetchArticles} style={{
          marginLeft: "auto", padding: "6px 14px", background: "#f0f2f8",
          border: "1px solid #d4ddf7", borderRadius: 6, cursor: "pointer",
          fontSize: 12, fontWeight: 600, color: "#1a3a6e",
        }}>
          Actualiser
        </button>
      </div>

      <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden",
        marginBottom: "1.2rem", marginTop: "0.8rem" }}>
        <div style={{ flex: 1, background: "#002395" }} />
        <div style={{ flex: 1, background: "#fff", border: "1px solid #e0e0e0" }} />
        <div style={{ flex: 1, background: "#ED2939" }} />
      </div>

      {/* Filtres multi-sélection */}
      <div style={{
        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
        marginBottom: "1.2rem",
        background: "#fff", borderRadius: 10, padding: "0.9rem 1.1rem",
        border: "1px solid #e8ecf8", boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      }}>
        {/* Type */}
        <MultiSelectDropdown
          label="Type"
          selected={filterTypes}
          onToggle={toggle(setFilterTypes)}
          onClear={() => setFilterTypes([])}
          totalCount={allArticles.length}
          groups={[{
            label: null,
            options: [
              { value: "presse", label: `📰 Presse (${presseCount})` },
              { value: "social", label: `💬 Réseaux sociaux (${socialCount})` },
            ],
          }]}
        />

        <div style={{ width: 1, height: 32, background: "#e8ecf8", flexShrink: 0 }} />

        {/* Source */}
        <MultiSelectDropdown
          label="Source"
          selected={filterSources}
          onToggle={toggle(setFilterSources)}
          onClear={() => setFilterSources([])}
          groups={[
            {
              label: "Presse",
              options: PRESS_SOURCES.map(s => ({
                value: s,
                label: getSourceCfg(s).label,
                color: getSourceCfg(s).color,
              })),
            },
          ]}
        />

        <div style={{ width: 1, height: 32, background: "#e8ecf8", flexShrink: 0 }} />

        {/* Sentiment */}
        <div style={{ opacity: enriched ? 1 : 0.55 }}>
          <MultiSelectDropdown
            label={enriched ? "Sentiment" : "Sentiment (Kafka requis)"}
            selected={filterSentiments}
            onToggle={toggle(setFilterSentiments)}
            onClear={() => setFilterSentiments([])}
            groups={[{
              label: null,
              options: [
                { value: "POSITIVE", label: "↑ Ton favorable",  color: "#27ae60" },
                { value: "NEGATIVE", label: "↓ Ton critique",   color: "#c0392b" },
                { value: "NEUTRAL",  label: "= Équilibré",      color: "#7f8c8d" },
              ],
            }]}
          />
        </div>

        {/* Résumé des filtres actifs + reset */}
        {hasFilters && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#7a8aaa" }}>
              {articles.length} résultat{articles.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => { setFilterTypes([]); setFilterSources([]); setFilterSentiments([]); }}
              style={{
                padding: "6px 12px", background: "#fdecea",
                border: "1px solid #e74c3c44", borderRadius: 6, cursor: "pointer",
                fontSize: 12, fontWeight: 600, color: "#c0392b",
              }}>
              Réinitialiser ✕
            </button>
          </div>
        )}
      </div>

      {/* Liste articles */}
      {loading ? (
        <p style={{ color: "#aaa", textAlign: "center", padding: "3rem" }}>Chargement…</p>
      ) : articles.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#aaa",
          background: "#fafbff", borderRadius: 10 }}>
          <p style={{ fontSize: 15, marginBottom: 8 }}>Aucun article disponible</p>
          <p style={{ fontSize: 13, color: "#bbb" }}>
            Vérifiez que l'API est démarrée (<code>python api.py</code>).
          </p>
        </div>
      ) : (
        articles.map(a => (
          <ArticleCard
            key={a.id || a.url || Math.random()}
            article={a}
            onOpen={setSelectedArticle}
          />
        ))
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 #2ecc7155; }
          50%       { box-shadow: 0 0 0 5px #2ecc7100; }
        }
      `}</style>
    </div>
  );
};


export default JournalPage;
