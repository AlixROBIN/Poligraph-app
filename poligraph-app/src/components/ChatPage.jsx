import React, { useState, useRef, useEffect } from "react";
import "../styles/Chat.css";

const BASE_URL = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";

const TOOL_META = {
  search_scandales:        { label: "Base données · Scandales",  icon: "🗄️", color: "tool-db" },
  search_votes:            { label: "Base données · Votes",      icon: "🗳️", color: "tool-db" },
  get_statistics:          { label: "Statistiques agrégées",     icon: "📊", color: "tool-stat" },
  get_recent_articles:     { label: "Presse récente",            icon: "📰", color: "tool-press" },
  get_politician_profile:  { label: "Profil élu",                icon: "👤", color: "tool-elu" },
  analyze_political_figure:{ label: "Analyse croisée Presse×DB", icon: "🔬", color: "tool-cross" },
};

const SUGGESTIONS = [
  "Quels sont les scandales de corruption les plus récents ?",
  "Montre les statistiques des scandales par parti politique",
  "Qui sont les élus du RN impliqués dans des affaires ?",
  "Quelles lois ont été rejetées au parlement en 2023 ?",
  "Quelles sont les dernières actualités politiques françaises ?",
  "Compare les scandales entre LFI et LR depuis 2020",
];

function truncateJSON(obj, maxChars = 600) {
  const str = JSON.stringify(obj, null, 2);
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "\n… (tronqué)";
}

function StepCard({ step }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[step.outil] || { label: step.outil, icon: "🔧", color: "tool-db" };

  return (
    <div className="step-card">
      <div className="step-header" onClick={() => setOpen(!open)}>
        <div className="step-flow">
          <span className="step-pill think-pill">💭 Think</span>
          <span className="step-arrow">→</span>
          <span className={`step-pill act-pill ${meta.color}`}>
            {meta.icon} {meta.label}
          </span>
          <span className="step-arrow">→</span>
          <span className="step-pill observe-pill">👁 Observe</span>
        </div>
        <span className="step-toggle">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="step-body">
          <div className="step-section">
            <span className="step-section-label">Paramètres</span>
            <pre>{JSON.stringify(step.paramètres, null, 2)}</pre>
          </div>
          <div className="step-section">
            <span className="step-section-label">Résultat</span>
            <pre>{truncateJSON(step.résultat)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function UserBubble({ content }) {
  return (
    <div className="msg-row msg-user">
      <div className="bubble bubble-user">{content}</div>
    </div>
  );
}

function BotBubble({ content, steps }) {
  return (
    <div className="msg-row msg-bot">
      <div className="bot-column">
        {steps && steps.length > 0 && (
          <div className="steps-wrap">
            <p className="steps-meta">
              🔍 {steps.length} appel{steps.length > 1 ? "s" : ""} d'outil{steps.length > 1 ? "s" : ""}
            </p>
            {steps.map((s, i) => <StepCard key={i} step={s} />)}
          </div>
        )}
        <div className="bubble bubble-bot">
          <span className="bot-avatar">🤖</span>
          <span className="bot-text">{content}</span>
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="msg-row msg-bot">
      <div className="bubble bubble-bot thinking-bubble">
        <span className="bot-avatar">🤖</span>
        <span className="thinking-dots">
          <span /><span /><span />
        </span>
        <span className="thinking-label">PoliBot réfléchit…</span>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const bottomRef               = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const buildHistory = (msgs) =>
    msgs.flatMap((m) =>
      m.role === "user"
        ? [{ role: "user",      content: m.content }]
        : [{ role: "assistant", content: m.content }]
    );

  const send = async (text) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput("");
    setError(null);

    const history = buildHistory(messages);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setLoading(true);

    try {
      const res = await fetch(`${BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Erreur serveur ${res.status}`);
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response, steps: data.steps || [] },
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="chat-page">
      {/* En-tête avec schéma ReAct */}
      <div className="chat-header">
        <div className="chat-title">
          <h2>PoliBot <span className="badge-agent">Agent IA</span></h2>
          <p>Posez vos questions sur les scandales, votes et élus français. L'agent consulte la base de données et la presse en temps réel.</p>
        </div>
        <div className="react-schema">
          <div className="schema-step schema-think">
            <strong>1. Think</strong>
            <small>Quel outil ? Quels args ?</small>
          </div>
          <div className="schema-arrow-big">→</div>
          <div className="schema-step schema-act">
            <strong>2. Act</strong>
            <small>Appel DB / Presse / API</small>
          </div>
          <div className="schema-arrow-big">→</div>
          <div className="schema-step schema-observe">
            <strong>3. Observe</strong>
            <small>Résultat de l'outil</small>
          </div>
          <div className="schema-loop-badge">↺ si pas terminé</div>
        </div>
      </div>

      {/* Zone messages */}
      <div className="chat-body">
        {messages.length === 0 && !loading && (
          <div className="suggestions-area">
            <p className="suggestions-title">Questions suggérées</p>
            <div className="suggestions-grid">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="suggestion-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user"
            ? <UserBubble key={i} content={m.content} />
            : <BotBubble  key={i} content={m.content} steps={m.steps} />
        )}

        {loading && <ThinkingBubble />}

        {error && (
          <div className="chat-error">
            ⚠️ {error}
            {error.includes("ANTHROPIC_API_KEY") && (
              <span> — Définissez la variable d'environnement <code>ANTHROPIC_API_KEY</code> sur le serveur.</span>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Zone saisie */}
      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Posez votre question… (Entrée pour envoyer, Maj+Entrée pour sauter une ligne)"
          rows={2}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={() => send()}
          disabled={!input.trim() || loading}
        >
          {loading ? "⏳" : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
