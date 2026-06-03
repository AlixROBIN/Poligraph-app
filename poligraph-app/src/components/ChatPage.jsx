import React, { useState, useRef, useEffect } from "react";
import "../styles/Chat.css";

const BASE_URL = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";

const TOOL_META = {
  search_scandales:         { label: "Scandales DB",      icon: "🗄️", color: "tool-db" },
  search_votes:             { label: "Votes DB",           icon: "🗳️", color: "tool-db" },
  get_statistics:           { label: "Statistiques",       icon: "📊", color: "tool-stat" },
  get_recent_articles:      { label: "Presse récente",     icon: "📰", color: "tool-press" },
  get_politician_profile:   { label: "Profil élu",         icon: "👤", color: "tool-elu" },
  analyze_political_figure: { label: "Analyse Presse×DB", icon: "🔬", color: "tool-cross" },
};

const SUGGESTIONS = [
  "Quels sont les scandales de corruption récents ?",
  "Statistiques des scandales par parti",
  "Élus RN impliqués dans des affaires ?",
  "Quelles lois rejetées en 2023 ?",
  "Actualités politiques françaises ?",
  "Compare scandales RN et LFI depuis 2020",
];

function truncateJSON(obj, maxChars = 500) {
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
          <span className="step-pill think-pill">💭</span>
          <span className="step-arrow">→</span>
          <span className={`step-pill act-pill ${meta.color}`}>{meta.icon} {meta.label}</span>
          <span className="step-arrow">→</span>
          <span className="step-pill observe-pill">👁</span>
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
            <p className="steps-meta">🔍 {steps.length} appel{steps.length > 1 ? "s" : ""}</p>
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

// Bulle "thinking" avec les étapes déjà reçues en temps réel
function ThinkingBubble({ liveSteps }) {
  return (
    <div className="msg-row msg-bot">
      <div className="bot-column">
        {liveSteps && liveSteps.length > 0 && (
          <div className="steps-wrap">
            <p className="steps-meta">🔍 {liveSteps.length} appel{liveSteps.length > 1 ? "s" : ""}…</p>
            {liveSteps.map((s, i) => <StepCard key={i} step={s} />)}
          </div>
        )}
        <div className="bubble bubble-bot thinking-bubble">
          <span className="bot-avatar">🤖</span>
          <span className="thinking-dots"><span /><span /><span /></span>
          <span className="thinking-label">PoliBot réfléchit…</span>
        </div>
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [liveSteps, setLiveSteps] = useState([]); // étapes reçues en streaming
  const [error, setError]       = useState(null);
  const bottomRef               = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, liveSteps, open]);

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
    setLiveSteps([]);

    const history = buildHistory(messages);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setLoading(true);

    try {
      const res = await fetch(`${BASE_URL}/chat/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: userText, history }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Erreur serveur ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // conserver la ligne incomplète

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.type === "step") {
            setLiveSteps((prev) => [...prev, data.step]);
          } else if (data.type === "done") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: data.response, steps: data.steps || [] },
            ]);
            setLiveSteps([]);
          } else if (data.type === "error") {
            throw new Error(data.message);
          }
        }
      }
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
    <div className="chat-widget">
      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <div className="chat-panel-title">
              <span>🤖</span>
              <span>PoliBot</span>
              <span className="badge-agent">Agent IA</span>
            </div>
            <button className="chat-panel-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chat-body">
            {messages.length === 0 && !loading && (
              <div className="suggestions-area">
                <p className="suggestions-title">Questions suggérées</p>
                <div className="suggestions-grid">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} className="suggestion-chip" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user"
                ? <UserBubble key={i} content={m.content} />
                : <BotBubble  key={i} content={m.content} steps={m.steps} />
            )}

            {loading && <ThinkingBubble liveSteps={liveSteps} />}

            {error && <div className="chat-error">⚠️ {error}</div>}

            <div ref={bottomRef} />
          </div>

          <div className="chat-input-bar">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Posez votre question… (Entrée pour envoyer)"
              rows={2}
              disabled={loading}
            />
            <button
              className="chat-send-btn"
              onClick={() => send()}
              disabled={!input.trim() || loading}
            >
              {loading ? "⏳" : "↑"}
            </button>
          </div>
        </div>
      )}

      <button
        className={`chat-bubble-btn ${open ? "chat-bubble-open" : ""}`}
        onClick={() => setOpen(!open)}
        title="PoliBot — Assistant IA"
      >
        {open ? "✕" : "🤖"}
      </button>
    </div>
  );
}
