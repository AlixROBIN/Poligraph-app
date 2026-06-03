import React, { useState, useEffect, useRef, useCallback } from "react";
import { fetchJSON } from "../data/api";

// ── Config sources ────────────────────────────────────────────────────────────

const SOURCES_CONFIG = {
  lemonde:              { label: "Le Monde",            type: "presse",  color: "#0066CC", bg: "#e8f0fb" },
  lefigaro:             { label: "Le Figaro",           type: "presse",  color: "#C00000", bg: "#fdecea" },
  liberation:           { label: "Libération",          type: "presse",  color: "#E4002B", bg: "#fff0f0" },
  franceinfo:           { label: "France Info",         type: "presse",  color: "#003189", bg: "#e8eaf6" },
  lepoint:              { label: "Le Point",            type: "presse",  color: "#2c2c2c", bg: "#f5f5f5" },
  "reddit/r/france":    { label: "Reddit · r/france",   type: "social",  color: "#FF4500", bg: "#fff3ee" },
  "reddit/r/politique": { label: "Reddit · r/politique", type: "social", color: "#FF4500", bg: "#fff3ee" },
};

const TYPE_ICON = { presse: "📰", social: "💬" };

const SENTIMENT_CFG = {
  POSITIVE: { color: "#2ecc71", bg: "#eafaf1", label: "Positif",  bar: "#2ecc71" },
  NEGATIVE: { color: "#e74c3c", bg: "#fdedec", label: "Négatif",  bar: "#e74c3c" },
  NEUTRAL:  { color: "#95a5a6", bg: "#f2f3f4", label: "Neutre",   bar: "#bbb"    },
  UNKNOWN:  { color: "#bbb",    bg: "#f5f5f5", label: "–",        bar: "#eee"    },
};

const PRESS_SOURCES  = ["lemonde","lefigaro","liberation","franceinfo","lepoint"];
const SOCIAL_SOURCES = ["reddit/r/france","reddit/r/politique"];

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
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33`,
      textTransform: "uppercase", letterSpacing: "0.4px",
    }}>
      <span>{TYPE_ICON[cfg.type]}</span>
      {cfg.label}
    </span>
  );
}

function SentimentBadge({ label, score }) {
  if (!label) return null;
  const cfg = SENTIMENT_CFG[label] || SENTIMENT_CFG.NEUTRAL;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color,
    }}>
      <span style={{ fontSize: 8 }}>●</span>
      {cfg.label}
      {score != null && (
        <span style={{ opacity: 0.7, fontWeight: 400 }}>
          {score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)}
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

function ArticleDrawer({ article, onClose }) {
  const cfg      = getSourceCfg(article.source);
  const isSocial = cfg.type === "social";

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
            {article.sentiment_label && article.sentiment_label !== "UNKNOWN" ? (
              <SentimentGauge label={article.sentiment_label} score={article.sentiment} />
            ) : (
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
                  <span>Kafka → Spark → DistilBERT → features</span>
                </>
              )}
            </div>
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
              {isSocial ? "Voir le post sur Reddit →" : "Lire l'article complet →"}
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
  const isSocial = cfg.type === "social";

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
          <SentimentBadge label={article.sentiment_label} score={article.sentiment} />
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

// ── Page principale ───────────────────────────────────────────────────────────

const JournalPage = () => {
  const [articles, setArticles]             = useState([]);
  const [loading, setLoading]               = useState(true);
  const [wsStatus, setWsStatus]             = useState("connecting");
  const [filterSource, setFilterSource]     = useState("");
  const [filterType, setFilterType]         = useState("");
  const [filterSentiment, setFilterSentiment] = useState("");
  const [kafkaAvailable, setKafkaAvailable] = useState(false);
  const [enriched, setEnriched]             = useState(false);
  const [sentimentFilterWarning, setSentimentFilterWarning] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const wsRef = useRef(null);

  const fetchArticles = useCallback(async () => {
    try {
      const params = new URLSearchParams({ n: 100 });
      if (filterSource)    params.append("source",    filterSource);
      if (filterSentiment) params.append("sentiment", filterSentiment);
      const data = await fetchJSON(`/api/journal?${params}`);
      let arts = data.articles || [];
      if (filterType) arts = arts.filter(a => getSourceCfg(a.source).type === filterType);
      setArticles(arts);
      setKafkaAvailable(data.kafka_available);
      setEnriched(data.enriched);
      setSentimentFilterWarning(!!filterSentiment && !data.enriched);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterSource, filterSentiment, filterType]);

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

  const presseCount = articles.filter(a => getSourceCfg(a.source).type === "presse").length;
  const socialCount = articles.filter(a => getSourceCfg(a.source).type === "social").length;

  return (
    <div style={{ padding: "1.5rem" }}>

      {/* Drawer modal */}
      {selectedArticle && (
        <ArticleDrawer
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
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

      {/* Filtres type */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          ["", `Tout (${articles.length})`],
          ["presse", `📰 Presse (${presseCount})`],
          ["social", `💬 Réseaux sociaux (${socialCount})`],
        ].map(([val, lbl]) => (
          <button key={val} onClick={() => setFilterType(val)}
            style={{ ...fBtn, ...(filterType === val ? fActive : {}) }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Filtres sources */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[...PRESS_SOURCES, ...SOCIAL_SOURCES].map(s => {
          const cfg    = getSourceCfg(s);
          const active = filterSource === s;
          return (
            <button key={s} onClick={() => setFilterSource(active ? "" : s)}
              style={{ ...fBtn, fontSize: 11,
                background: active ? cfg.color : "#f5f5f5",
                color: active ? "#fff" : cfg.color,
                border: `1px solid ${cfg.color}44`,
              }}>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Filtres sentiment */}
      <div style={{
        display: "flex", gap: 6, flexWrap: "wrap",
        marginBottom: enriched ? 6 : "1.2rem",
        opacity: enriched ? 1 : 0.5,
        pointerEvents: "auto",
      }}>
        {[["", "Tous sentiments"], ["POSITIVE", "Positif"], ["NEGATIVE", "Négatif"], ["NEUTRAL", "Neutre"]].map(([val, lbl]) => (
          <button key={val} onClick={() => setFilterSentiment(val)}
            style={{ ...fBtn, fontSize: 11,
              background: filterSentiment === val
                ? (SENTIMENT_CFG[val]?.color || "#1a3a6e") : "#f5f5f5",
              color: filterSentiment === val ? "#fff" : "#555",
            }}>
            {lbl}
          </button>
        ))}
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

const fBtn    = { padding: "5px 12px", borderRadius: 20, border: "1px solid #d4ddf7",
  cursor: "pointer", fontSize: 12, fontWeight: 600, background: "#f5f5f5", color: "#555" };
const fActive = { background: "#1a3a6e", color: "#fff", border: "1px solid #1a3a6e" };

export default JournalPage;
