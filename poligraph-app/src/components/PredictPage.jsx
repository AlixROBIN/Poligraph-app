import React, { useState } from "react";
import { predictVote, predictScandale, predictPolitician } from "../data/api";

const PARTIS = ["RN", "LR", "LFI", "RE", "PS", "MoDem", "NI", "PCF", "EELV", "UDI"];
const CATEGORIES = [
  "CORRUPTION", "DETOURNEMENT_FONDS_PUBLICS", "EMPLOI_FICTIF",
  "FINANCEMENT_ILLEGAL_CAMPAGNE", "FAVORITISME", "DIFFAMATION",
  "HARCELEMENT_MORAL", "VIOLENCE", "ABUS_CONFIANCE", "INCITATION_HAINE",
  "CONFLIT_INTERETS", "ABUS_BIENS_SOCIAUX", "AUTRE",
];
const STATUTS = [
  "ENQUETE_PRELIMINAIRE", "MISE_EN_EXAMEN", "RENVOI_TRIBUNAL",
  "CONDAMNATION_DEFINITIVE", "APPEL_EN_COURS", "CLASSEMENT_SANS_SUITE", "RELAXE",
];

const SENTIMENT_SRC_LABEL = {
  live_kafka: { text: "Sentiment live Kafka",   color: "#2ecc71", bg: "#eafaf1" },
  camembert:  { text: "Sentiment CamemBERT",    color: "#8e44ad", bg: "#f5eef8" },
  none:       { text: "Sentiment non disponible", color: "#bbb",  bg: "#f5f5f5" },
};

const SentimentBadge = ({ source, score }) => {
  if (!source || source === "none") return null;
  const cfg = SENTIMENT_SRC_LABEL[source] || SENTIMENT_SRC_LABEL.none;
  const sign = score > 0 ? `+${score.toFixed(3)}` : score?.toFixed(3);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}44`,
    }}>
      <span style={{ fontSize: 9 }}>●</span>
      {cfg.text}{score != null && ` · ${sign}`}
    </span>
  );
};

const CONFIDENCE_CFG = {
  haute:   { text: "Confiance haute",   color: "#1e8449", bg: "#eafaf1", border: "#2ecc7155" },
  moyenne: { text: "Confiance moyenne", color: "#b7770d", bg: "#fff8e1", border: "#f0c04055" },
  faible:  { text: "Confiance faible",  color: "#c0392b", bg: "#fdedec", border: "#e74c3c55" },
};

const ConfidenceBadge = ({ level, nClasses }) => {
  if (!level) return null;
  const cfg = CONFIDENCE_CFG[level] || CONFIDENCE_CFG.faible;
  return (
    <span title={`1/${nClasses || "?"} attendu au hasard`} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      cursor: "help",
    }}>
      <span style={{ fontSize: 9 }}>
        {level === "haute" ? "▲" : level === "moyenne" ? "◆" : "▼"}
      </span>
      {cfg.text}
    </span>
  );
};

const ResultBar = ({ label, value, color = "#1a3a6e" }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
      <span>{label}</span>
      <strong>{(value * 100).toFixed(1)}%</strong>
    </div>
    <div style={{ background: "#eee", borderRadius: 4, height: 8 }}>
      <div style={{ width: `${value * 100}%`, background: color, borderRadius: 4, height: 8, transition: "width 0.4s" }} />
    </div>
  </div>
);

const InfoBox = ({ title, children, color = "#e8f0fe", border = "#4a6fa5" }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: color, border: `1px solid ${border}`, borderRadius: 8,
      padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
      <button onClick={() => setOpen(!open)}
        style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700,
          color: "#1a2e5a", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11 }}>{open ? "▼" : "▶"}</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 10, color: "#333", lineHeight: 1.6 }}>{children}</div>}
    </div>
  );
};

const WarningBox = ({ children }) => (
  <div style={{ background: "#fff8e1", border: "1px solid #f0c040", borderRadius: 8,
    padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#7a5500" }}>
    <strong>⚠ Limitation :</strong> {children}
  </div>
);

// ---- Onglet Vote ----
const VoteForm = () => {
  const [title, setTitle] = useState("");
  const [annee, setAnnee] = useState(2025);
  const [legislature, setLegislature] = useState(17);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await predictVote({ title, annee, legislature }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Prédire le résultat d'un vote</h3>

      <InfoBox title="Comment fonctionne ce modèle ?">
        <p style={{ margin: "0 0 8px" }}>
          Le modèle utilise un <strong>RandomForest</strong> entraîné sur l'historique des votes
          de l'Assemblée nationale. Chaque vote est représenté par :
        </p>
        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          <li><strong>TF-IDF sur le titre</strong> (200 tokens) — les mots-clés du projet de loi</li>
          <li><strong>Législature + année</strong> encodés en one-hot</li>
          <li><strong>Ratios de votes</strong> (pour/contre/abstention) si disponibles</li>
        </ul>
        <p style={{ margin: 0 }}>
          Résultat attendu : <strong>ADOPTÉ</strong> ou <strong>REJETÉ</strong> avec une probabilité associée.
        </p>
      </InfoBox>

      <WarningBox>
        Ce modèle prédit <strong>très souvent ADOPTÉ</strong> car ~70 % des votes historiques ont été
        adoptés (biais de classe). Sans le titre exact du texte de loi ni la composition du vote,
        la prédiction reflète principalement la tendance statistique générale, pas le contexte politique.
        Un titre vague ou fictif donnera un résultat peu fiable.
      </WarningBox>

      <form onSubmit={submit} style={formStyle}>
        <label style={labelStyle}>Titre du vote</label>
        <input style={inputStyle} value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ex: projet de loi sur les retraites" required />
        <label style={labelStyle}>Année</label>
        <input style={inputStyle} type="number" value={annee} min={2020} max={2030}
          onChange={(e) => setAnnee(Number(e.target.value))} />
        <label style={labelStyle}>Législature</label>
        <input style={inputStyle} type="number" value={legislature} min={14} max={20}
          onChange={(e) => setLegislature(Number(e.target.value))} />
        <button style={btnStyle} disabled={loading}>
          {loading ? "Analyse..." : "Prédire"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result && (
        <div style={resultStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <p style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>
              Résultat prédit :{" "}
              <span style={{ color: (result.prediction || result.result) === "ADOPTED" ? "#2ecc71" : "#e74c3c" }}>
                {(result.prediction || result.result) === "ADOPTED" ? "ADOPTÉ" : "REJETÉ"}
              </span>
            </p>
            <SentimentBadge source={result.sentiment_source} score={result.sentiment_used} />
          </div>
          <ResultBar label="Adopté"  value={result.proba_adopted}  color="#2ecc71" />
          <ResultBar label="Rejeté"  value={result.proba_rejected} color="#e74c3c" />
          <p style={{ fontSize: 12, color: "#888", marginTop: 10, marginBottom: 0 }}>
            La probabilité proche de 70/30 signifie que le modèle suit le biais de la base d'entraînement.
            Une forte conviction (&gt; 85 %) indique que le titre contient des mots fortement associés
            à un résultat historique.
          </p>
        </div>
      )}
    </div>
  );
};

// ---- Onglet Catégorie ----
const CategoryForm = () => {
  const [party, setParty] = useState("RN");
  const [annee, setAnnee] = useState(2024);
  const [status, setStatus] = useState("ENQUETE_PRELIMINAIRE");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await predictScandale({ party, annee, status, description, top_n: 5 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Prédire la catégorie d'un scandale</h3>

      <InfoBox title="Comment fonctionne ce modèle ?">
        <p style={{ margin: "0 0 8px" }}>
          Entraîné sur <strong>~258 scandales</strong> référencés dans la base PoliGraph.
          Le vecteur d'entrée combine :
        </p>
        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          <li><strong>Parti politique</strong> (one-hot encoding)</li>
          <li><strong>Année des faits</strong> (normalisée)</li>
          <li><strong>Institution</strong> (feature hashing, 128 dimensions)</li>
          <li><strong>Description libre</strong> (TF-IDF, 150 tokens)</li>
          <li><strong>Sentiment médiatique</strong> (CamemBERT ou Kafka live)</li>
        </ul>
        <p style={{ margin: 0 }}>
          Résultat : <strong>catégorie + élus les plus probables</strong>, enrichis par le
          contexte médiatique en temps réel.
        </p>
      </InfoBox>

      <WarningBox>
        Avec seulement ~258 exemples, certaines catégories rares (ex: INCITATION_HAINE) sont
        sous-représentées. Le modèle aura tendance à prédire les catégories les plus fréquentes
        (CORRUPTION, DETOURNEMENT_FONDS_PUBLICS) si la description est vague ou absente.
      </WarningBox>

      <form onSubmit={submit} style={formStyle}>
        <label style={labelStyle}>Parti</label>
        <select style={inputStyle} value={party} onChange={(e) => setParty(e.target.value)}>
          {PARTIS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <label style={labelStyle}>Année</label>
        <input style={inputStyle} type="number" value={annee} min={2000} max={2030}
          onChange={(e) => setAnnee(Number(e.target.value))} />
        <label style={labelStyle}>Statut judiciaire</label>
        <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label style={labelStyle}>Description (optionnel — améliore significativement la précision)</label>
        <textarea style={{ ...inputStyle, height: 80, resize: "vertical" }}
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="ex: détournement de fonds de la permanence parlementaire..." />
        <button style={btnStyle} disabled={loading}>
          {loading ? "Analyse..." : "Prédire"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result && (
        <div style={resultStyle}>

          {/* ── En-tête résultat ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
              Catégorie : <span style={{ color: "#1a3a6e" }}>{result.category?.replace(/_/g, " ")}</span>
            </p>
            <ConfidenceBadge level={result.confidence} nClasses={result.proba ? Object.keys(result.proba).length : 13} />
            <SentimentBadge source={result.sentiment_source} score={result.sentiment_used} />
          </div>

          {/* ── Distribution top-5 ── */}
          {result.proba && Object.entries(result.proba)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([cat, prob]) => (
              <ResultBar key={cat} label={cat.replace(/_/g, " ")} value={prob} />
            ))
          }

          {/* ── Evidence tokens ── */}
          {result.evidence && (
            <div style={{ marginTop: 16, padding: "12px 14px",
              background: "#f8f9ff", borderRadius: 8, border: "1px solid #e8ecf8" }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 12,
                color: "#7a8aaa", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Analyse de la description
              </p>

              {result.evidence.matched_tokens?.length > 0 ? (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#2ecc71", fontWeight: 600 }}>
                    ✓ Mots reconnus par le modèle ({result.evidence.matched_tokens.length}/{result.evidence.tfidf_vocab_size} vocab)
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {result.evidence.matched_tokens.map(([tok, w]) => (
                      <span key={tok} style={{
                        padding: "2px 8px", borderRadius: 10, fontSize: 11,
                        background: "#eafaf1", color: "#1e8449",
                        border: "1px solid #2ecc7133",
                      }}>
                        {tok} <span style={{ opacity: 0.6 }}>({w.toFixed(2)})</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "#e74c3c", margin: "0 0 8px" }}>
                  ✗ Aucun mot de la description n'est dans le vocabulaire du modèle
                </p>
              )}

              {result.evidence.ignored_tokens?.length > 0 && (
                <div>
                  <span style={{ fontSize: 11, color: "#e74c3c", fontWeight: 600 }}>
                    ✗ Mots ignorés (absents du corpus d'entraînement)
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {result.evidence.ignored_tokens.map(tok => (
                      <span key={tok} style={{
                        padding: "2px 8px", borderRadius: 10, fontSize: 11,
                        background: "#fdedec", color: "#c0392b",
                        border: "1px solid #e74c3c22",
                      }}>
                        {tok}
                      </span>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: "#aaa", margin: "6px 0 0" }}>
                    Ces mots n'apparaissent pas assez souvent dans les {result.evidence.tfidf_vocab_size} descriptions
                    d'entraînement pour être appris. La prédiction repose alors uniquement sur le parti et l'année.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Articles Kafka sources du sentiment ── */}
          {result.evidence?.kafka_articles?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 12, color: "#7a8aaa",
                textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 8px" }}>
                Articles ayant influencé le sentiment ({result.evidence.kafka_articles.length})
              </p>
              {result.evidence.kafka_articles.map((art, i) => {
                const slabel = art.sentiment_label;
                const scfg = { POSITIVE: { c: "#2ecc71", bg: "#eafaf1" },
                               NEGATIVE: { c: "#e74c3c", bg: "#fdedec" },
                               NEUTRAL:  { c: "#95a5a6", bg: "#f5f5f5" } }[slabel] || { c: "#bbb", bg: "#fafafa" };
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "8px 10px", borderRadius: 6, marginBottom: 5,
                    background: "#fafbff", border: "1px solid #e8ecf8",
                  }}>
                    <span style={{
                      padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                      background: scfg.bg, color: scfg.c, whiteSpace: "nowrap", marginTop: 1,
                    }}>
                      {slabel || "–"}
                      {art.sentiment != null && ` ${art.sentiment > 0 ? "+" : ""}${art.sentiment.toFixed(2)}`}
                    </span>
                    <div style={{ flex: 1 }}>
                      {art.url ? (
                        <a href={art.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 12, color: "#1a3a6e", textDecoration: "none", fontWeight: 500,
                            lineHeight: 1.4, display: "block" }}
                          onMouseEnter={e => e.target.style.textDecoration = "underline"}
                          onMouseLeave={e => e.target.style.textDecoration = "none"}>
                          {art.title}
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "#555" }}>{art.title}</span>
                      )}
                      <span style={{ fontSize: 10, color: "#aaa" }}>{art.source}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Élus M3 (seulement si confiance non-faible) ── */}
          {result.confidence === "faible" ? (
            <div style={{ marginTop: 14, padding: "10px 14px",
              background: "#fff8e1", borderRadius: 8, border: "1px solid #f0c040",
              fontSize: 12, color: "#7a5500" }}>
              <strong>Identification d'élu non affichée</strong> — la confiance est trop faible pour
              nommer un élu ({Math.round(Math.max(...Object.values(result.proba || {})) * 100)}% vs
              {Math.round(100 / Object.keys(result.proba || {a:1}).length)}% attendu au hasard).
              Ajoutez une description précise pour améliorer la prédiction.
            </div>
          ) : result.politicians?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: "#555", marginBottom: 8 }}>
                Élus les plus probables (M3)
              </p>
              {result.politicians.map((item, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "7px 12px",
                  background: i === 0 ? "#f0f4ff" : "#fafafa",
                  borderRadius: 6, marginBottom: 5,
                  border: i === 0 ? "1px solid #1a3a6e" : "1px solid #eee",
                }}>
                  <span style={{ fontWeight: i === 0 ? 700 : 400, fontSize: 13 }}>
                    {i + 1}. {item.name}
                  </span>
                  <span style={{ color: "#1a3a6e", fontWeight: 600, fontSize: 13 }}>
                    {(item.proba * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---- Onglet Élu ----
const PoliticianForm = () => {
  const [category, setCategory] = useState("CORRUPTION");
  const [party, setParty] = useState("LFI");
  const [status, setStatus] = useState("ENQUETE_PRELIMINAIRE");
  const [topN, setTopN] = useState(5);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await predictPolitician({ category, party, status, top_n: topN }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Identifier l'élu le plus probable</h3>

      <InfoBox title="Comment fonctionne ce modèle ?">
        <p style={{ margin: "0 0 8px" }}>
          Ce modèle cherche à associer un profil de scandale (catégorie + parti + statut judiciaire)
          à un élu connu dans notre base. Il compare le <strong>RandomForest</strong> et la
          <strong> Régression Logistique</strong> en cross-validation et conserve le meilleur.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          Le modèle sort un <strong>classement probabiliste</strong> parmi les élus présents
          dans la base : l'élu en tête est celui dont le profil de scandales passés ressemble
          le plus aux paramètres fournis.
        </p>
        <p style={{ margin: 0, fontStyle: "italic" }}>
          Ce n'est pas une prédiction de culpabilité — c'est une correspondance statistique
          avec des patterns historiques.
        </p>
      </InfoBox>

      <div style={{ background: "#fdecea", border: "1px solid #e74c3c", borderRadius: 8,
        padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#7a1a1a" }}>
        <strong>Avertissement éthique :</strong> Ce modèle est entraîné sur seulement ~258 scandales
        répertoriés. Les résultats reflètent la <strong>fréquence d'apparition dans les données</strong>,
        pas une probabilité réelle d'implication. Un élu cité souvent dans la base apparaîtra
        systématiquement en tête. À interpréter comme une <strong>exploration statistique</strong>,
        non comme une accusation.
      </div>

      <form onSubmit={submit} style={formStyle}>
        <label style={labelStyle}>Catégorie</label>
        <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label style={labelStyle}>Parti</label>
        <select style={inputStyle} value={party} onChange={(e) => setParty(e.target.value)}>
          {PARTIS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <label style={labelStyle}>Statut judiciaire</label>
        <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label style={labelStyle}>Nombre de résultats</label>
        <input style={inputStyle} type="number" value={topN} min={1} max={10}
          onChange={(e) => setTopN(Number(e.target.value))} />
        <button style={btnStyle} disabled={loading}>
          {loading ? "Analyse..." : "Prédire"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result && (
        <div style={resultStyle}>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Élus les plus probables :</p>
          {result.top.map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 12px", background: i === 0 ? "#f0f4ff" : "#fafafa",
              borderRadius: 6, marginBottom: 6, border: i === 0 ? "1px solid #1a3a6e" : "1px solid #eee" }}>
              <span style={{ fontWeight: i === 0 ? 700 : 400 }}>
                {i + 1}. {item.name}
              </span>
              <span style={{ color: "#1a3a6e", fontWeight: 600 }}>
                {(item.probability * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---- Section CamemBERT + Sources ----
const CamembertSection = () => {
  const sources = [
    { name: "Le Monde",      url: "lemonde.fr",      type: "Presse nationale", biais: "Centre-gauche" },
    { name: "Le Figaro",     url: "lefigaro.fr",     type: "Presse nationale", biais: "Centre-droite" },
    { name: "Libération",    url: "liberation.fr",   type: "Presse nationale", biais: "Gauche" },
    { name: "Mediapart",     url: "mediapart.fr",    type: "Presse d'investigation", biais: "Gauche" },
    { name: "BFM TV",        url: "bfmtv.com",       type: "TV/Web", biais: "Neutre" },
    { name: "LCI",           url: "lci.fr",          type: "TV/Web", biais: "Neutre" },
    { name: "Politico FR",   url: "politico.eu",     type: "Spécialisé politique", biais: "Neutre" },
    { name: "L'Obs",         url: "nouvelobs.com",   type: "Presse nationale", biais: "Centre-gauche" },
  ];

  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "1.5rem",
      boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg, #6c3483 60%, #a569bd 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, color: "#fff", fontWeight: 900 }}>
          NLP
        </div>
        <h3 style={{ margin: 0, color: "#1a2e5a" }}>Enrichissement par CamemBERT</h3>
      </div>
      <p style={{ fontSize: 13, color: "#555", lineHeight: 1.6, marginBottom: 12 }}>
        Les modèles ML ci-dessus sont enrichis en temps réel par une couche <strong>NLP</strong>
        basée sur <strong>DistilBERT multilingue</strong> (compatible français). Elle analyse le
        sentiment des articles de presse parsés via Kafka/Spark et l'injecte comme feature dans
        chaque prédiction.
      </p>

      <div style={{ background: "#eafaf1", borderRadius: 8, padding: "12px 14px", marginBottom: 14,
        border: "1px solid #2ecc7133" }}>
        <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#1e8449" }}>
          Pipeline actif
        </p>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#444", lineHeight: 1.8 }}>
          <li>Scraping continu des articles via <strong>Kafka Producer</strong> (streaming)</li>
          <li>Traitement par <strong>Spark Structured Streaming</strong> — passage dans DistilBERT</li>
          <li>Score de sentiment <strong>[-1 (négatif) → +1 (positif)]</strong> dans le topic <code>features</code></li>
          <li>Lookup live depuis les features Kafka au moment de la prédiction</li>
          <li>Fallback CamemBERT offline si Kafka non disponible</li>
        </ol>
      </div>

      <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e5a", marginBottom: 8 }}>
        Sources de scraping prévues
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f0f2f8" }}>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Orientation éditoriale</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafbff" }}>
                <td style={tdStyle}><strong>{s.name}</strong></td>
                <td style={tdStyle}>{s.type}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 12, fontSize: 11,
                    background: s.biais === "Gauche" ? "#fdecea" :
                                s.biais === "Centre-gauche" ? "#fff3e0" :
                                s.biais === "Centre-droite" ? "#e8f5e9" :
                                s.biais === "Droite" ? "#e3f2fd" : "#f5f5f5",
                    color: "#333",
                  }}>
                    {s.biais}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "#888", marginTop: 10, marginBottom: 0 }}>
        La diversité éditoriale est intentionnelle : croiser les sentiments de sources opposées
        permet de détecter les signaux forts (couverts partout) vs les signaux faibles (un seul bord médiatique).
      </p>
    </div>
  );
};

// ---- Page principale ----
const TABS = [
  { id: "vote",       label: "Résultat vote" },
  { id: "category",  label: "Catégorie scandale" },
  { id: "politician", label: "Identification élu" },
];

const PredictPage = () => {
  const [tab, setTab] = useState("vote");

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "0.3rem" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(135deg, #1a3a6e 60%, #c9a227 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, color: "#fff", fontWeight: 900, flexShrink: 0,
        }}>🔮</div>
        <div>
          <h2 style={{ marginBottom: "0.1rem", color: "#1a2e5a" }}>Prédictions ML</h2>
          <p style={{ color: "#7a8aaa", margin: 0, fontSize: 13 }}>
            3 modèles entraînés sur les données PoliGraph · Enrichissement NLP DistilBERT actif
          </p>
        </div>
      </div>
      <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", marginBottom: "1.4rem", marginTop: "0.8rem" }}>
        <div style={{ flex: 1, background: "#002395" }} />
        <div style={{ flex: 1, background: "#fff", border: "1px solid #e0e0e0" }} />
        <div style={{ flex: 1, background: "#ED2939" }} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...tabStyle,
              background: tab === t.id ? "#1a3a6e" : "#f0f2f8",
              color: tab === t.id ? "#fff" : "#555",
              borderBottom: tab === t.id ? "2px solid #c9a227" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 10, padding: "1.5rem",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {tab === "vote"       && <VoteForm />}
        {tab === "category"   && <CategoryForm />}
        {tab === "politician" && <PoliticianForm />}
      </div>

      <CamembertSection />
    </div>
  );
};

const formStyle   = { display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 };
const labelStyle  = { fontSize: 13, fontWeight: 600, color: "#1a2e5a" };
const inputStyle  = { padding: "8px 12px", borderRadius: 6, border: "1px solid #d4ddf7", fontSize: 14 };
const btnStyle    = { padding: "10px 20px", background: "#1a3a6e", color: "#fff", border: "none",
  borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14, marginTop: 4 };
const resultStyle = { marginTop: "1.5rem", padding: "1rem", background: "#f7f9fd",
  borderRadius: 8, border: "1px solid #d4ddf7" };
const tabStyle    = { padding: "8px 18px", borderRadius: "6px 6px 0 0", border: "none", cursor: "pointer",
  fontWeight: 600, fontSize: 13 };
const thStyle     = { padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#1a2e5a", fontSize: 12 };
const tdStyle     = { padding: "7px 12px", borderTop: "1px solid #eee" };

export default PredictPage;
