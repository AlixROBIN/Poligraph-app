import { useState } from "react";
import candidatsData from "../data/candidats.json";

const CANDIDATS = candidatsData.candidats;
const PROPOSITIONS = candidatsData.quiz.map(q => ({
  ...q,
  topic: q.theme,
  parties: q.positions,
}));

export default function MatchPage() {
  const [idx,        setIdx]        = useState(0);
  const [votes,      setVotes]      = useState({});
  const [done,       setDone]       = useState(false);
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

  const Header = () => (
    <div style={{
      background: "linear-gradient(135deg, #1a3a6e 0%, #2c5282 60%, #c9a227 140%)",
      borderRadius: 14, padding: "1.8rem 2rem", marginBottom: "1.5rem", color: "#fff",
    }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🗳️ Mon programme</h2>
      <p style={{ margin: "6px 0 0", opacity: 0.85, fontSize: 13 }}>
        Répondez à {total} questions pour voir quel parti est le plus proche de vos positions.
      </p>
    </div>
  );

  if (done) {
    const ranked = computeScores();
    const best = ranked[0];
    return (
      <div style={{ padding: "1.5rem", background: "#f5f6fa", minHeight: "100vh" }}>
        <Header />
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
    <div style={{ padding: "1.5rem", background: "var(--pg-bg)", minHeight: "100vh" }}>
      <Header />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "1rem 0" }}>
        {/* Progress */}
        <div style={{ marginBottom: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--pg-muted)", marginBottom: 6 }}>
            <span>Question {idx + 1} / {total}</span>
            <span>{current.topic} {current.emoji}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "var(--color-gray-100)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${((idx) / total) * 100}%`, background: "var(--pg-navy)", transition: "width 0.3s ease", borderRadius: 3 }} />
          </div>
        </div>

        {/* Card */}
        <div style={{ ...cardStyle, background: "var(--pg-surface)", borderRadius: "var(--pg-r-lg)", padding: "2.25rem 2rem", boxShadow: "var(--pg-sh-sm)", border: "1px solid var(--pg-line)", minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>{current.emoji}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--pg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{current.topic}</div>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--pg-ink)", lineHeight: 1.55, letterSpacing: "-0.2px" }}>
            « {current.texte} »
          </div>
          {current.detail && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => setShowDetail(v => !v)}
                style={{ background: "none", border: "1px solid var(--pg-line)", borderRadius: 8, padding: "4px 12px", fontSize: 12, color: "var(--color-blue-600)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                ℹ️ {showDetail ? "Masquer le contexte" : "En savoir plus"}
              </button>
              {showDetail && (
                <div style={{ marginTop: 10, padding: "12px 14px", background: "var(--color-gray-50)", borderRadius: 10, fontSize: 12, color: "var(--pg-ink)", lineHeight: 1.6, textAlign: "left" }}>
                  {current.detail}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Boutons — pastel avec bordure de la couleur pleine, plus de gros encadré plat */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => vote("contre")}
            style={{ flex: 1, padding: "14px 8px", borderRadius: 14, border: "1.5px solid var(--color-red-400)", background: "var(--color-red-50)", cursor: "pointer", fontSize: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--color-red-100)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--color-red-50)"}
          >
            ❌
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-red-800)" }}>Contre</span>
          </button>
          <button
            onClick={() => vote("neutre")}
            style={{ flex: 0.7, padding: "14px 8px", borderRadius: 14, border: "1.5px solid var(--color-gray-400)", background: "var(--color-gray-50)", cursor: "pointer", fontSize: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--color-gray-100)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--color-gray-50)"}
          >
            😐
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-gray-800)" }}>Neutre</span>
          </button>
          <button
            onClick={() => vote("pour")}
            style={{ flex: 1, padding: "14px 8px", borderRadius: 14, border: "1.5px solid var(--color-green-400)", background: "var(--color-green-50)", cursor: "pointer", fontSize: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--color-green-100)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--color-green-50)"}
          >
            ✅
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-green-800)" }}>Pour</span>
          </button>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginTop: "1.2rem" }}>
          Positions basées sur les programmes publics des partis — à titre indicatif
        </p>
      </div>
    </div>
  );
}
