import { useState, useEffect, useCallback } from "react";

const BASE_URL = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api/proxy";

// ============================================================
// Helpers API
// ============================================================
async function apiFetch(path, params = {}) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString();
  const res = await fetch(`${BASE_URL}/${path}${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ============================================================
// Composants utilitaires
// ============================================================
const PartyBadge = ({ party }) => {
  if (!party) return <span style={badge("#ccc", "#555")}>Indépendant</span>;
  const name  = party.shortName || party.name || "?";
  const color = party.color || "#1a3a6e";
  return <span style={badge(color + "22", color)}>{name}</span>;
};

const badge = (bg, color) => ({
  fontSize: 11, padding: "2px 7px", borderRadius: 4,
  background: bg, color, fontWeight: 700, whiteSpace: "nowrap",
});

const StatBox = ({ label, value, color = "#1a3a6e" }) => (
  <div style={{ textAlign: "center", padding: "10px 14px", background: "#f8f9ff",
    borderRadius: 8, minWidth: 80 }}>
    <div style={{ fontSize: 22, fontWeight: 700, color }}>{value ?? "—"}</div>
    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{label}</div>
  </div>
);

const Pager = ({ pagination, onPage }) => {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages } = pagination;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
      <button style={pgBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}>←</button>
      <span style={{ fontSize: 13 }}>Page {page} / {totalPages}</span>
      <button style={pgBtn} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>→</button>
    </div>
  );
};

// ============================================================
// Profil d'un élu
// ============================================================
const PTABS = ["Mandats", "Scandales", "Votes", "Relations"];

const PoliticianProfile = ({ slug, onBack, onNavigate, onSelectSlug }) => {
  const [profile,      setProfile]      = useState(null);
  const [tab,          setTab]          = useState("Mandats");
  const [affaires,     setAffaires]     = useState(null);
  const [votes,        setVotes]        = useState(null);
  const [votePage,     setVotePage]     = useState(1);
  const [relations,    setRelations]    = useState(null);
  const [partyMembers, setPartyMembers] = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  useEffect(() => {
    setLoading(true); setError(null);
    apiFetch(`politiques/${slug}`)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (tab === "Scandales" && !affaires)
      apiFetch(`politiques/${slug}/affaires`).then(setAffaires).catch(() => setAffaires({ affairs: [] }));
    if (tab === "Relations" && !relations) {
      apiFetch(`politiques/${slug}/relations`).then(setRelations).catch(() => setRelations({ clusters: [] }));
    }
    if (tab === "Relations" && !partyMembers && profile?.currentParty?.slug) {
      apiFetch(`partis/${profile.currentParty.slug}/membres`, { limit: 24, page: 1 })
        .then((res) => setPartyMembers(res?.data || []))
        .catch(() => setPartyMembers([]));
    }
  }, [tab, slug, affaires, relations, partyMembers, profile]);

  useEffect(() => {
    if (tab === "Votes")
      apiFetch(`politiques/${slug}/votes`, { limit: 15, page: votePage }).then(setVotes).catch(() => {});
  }, [tab, slug, votePage]);

  if (loading) return <p style={{ padding: "2rem", color: "#888" }}>Chargement...</p>;
  if (error)   return <p style={{ padding: "2rem", color: "red" }}>Erreur : {error}</p>;
  if (!profile) return null;

  const party = profile.currentParty;
  const partyColor = party?.color || "#1a3a6e";

  return (
    <div>
      {/* Header */}
      <button onClick={onBack} style={{ ...pgBtn, marginBottom: 16 }}>← Retour</button>
      <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 24,
        background: "#fff", padding: "1.2rem", borderRadius: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {profile.photoUrl
          ? <img src={profile.photoUrl} alt={profile.fullName}
              style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover",
                border: `3px solid ${partyColor}` }} />
          : <div style={{ width: 72, height: 72, borderRadius: "50%",
              background: partyColor + "22", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 28, color: partyColor, fontWeight: 700 }}>
              {profile.fullName?.[0]}
            </div>
        }
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{profile.fullName}</h2>
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <PartyBadge party={party} />
            {profile.birthDate && (
              <span style={{ fontSize: 12, color: "#888" }}>
                né(e) le {new Date(profile.birthDate).toLocaleDateString("fr-FR")}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <StatBox label="Mandats"   value={profile.mandates?.length} />
          <StatBox label="Scandales" value={profile.affairsCount} color="#e74c3c" />
          <StatBox label="Fact-checks" value={profile.factchecksCount} color="#f39c12" />
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {PTABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...tabBtn,
              background: tab === t ? "#1a3a6e" : "#f0f2f8",
              color: tab === t ? "#fff" : "#555",
              borderBottom: tab === t ? "2px solid #c9a227" : "2px solid transparent",
            }}>
            {t}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div style={card}>
        {/* Mandats */}
        {tab === "Mandats" && (
          profile.mandates?.length
            ? <table style={tbl}>
                <thead><tr>
                  {["Type", "Titre", "Institution", "Circonscription", "Début", "Fin", "Actif"].map((h) =>
                    <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {profile.mandates.map((m, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9faff" }}>
                      <td style={td}><span style={badge("#e8eeff","#1a3a6e")}>{m.type}</span></td>
                      <td style={td}>{m.title}</td>
                      <td style={td}>{m.institution}</td>
                      <td style={td}>{m.constituency || "—"}</td>
                      <td style={td}>{m.startDate ? new Date(m.startDate).toLocaleDateString("fr-FR") : "—"}</td>
                      <td style={td}>{m.endDate   ? new Date(m.endDate).toLocaleDateString("fr-FR")   : "—"}</td>
                      <td style={td}>{m.isCurrent ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            : <p style={{ color: "#888" }}>Aucun mandat recensé.</p>
        )}

        {/* Scandales */}
        {tab === "Scandales" && (
          !affaires ? <p style={{ color: "#888" }}>Chargement...</p>
          : affaires.affairs?.length
            ? affaires.affairs.map((a, i) => (
                <div key={i}
                  onClick={() => onNavigate("exploration", { tab: "scandales", q: a.title || profile.fullName })}
                  style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f7f9fd"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={badge("#ffe8e8","#e74c3c")}>{a.category?.replace(/_/g," ")}</span>
                    <span style={badge("#f0f0f0","#666")}>{a.status?.replace(/_/g," ")}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#1a3a6e", opacity: 0.7 }}>→ Explorer</span>
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{a.description?.slice(0, 200)}...</div>
                </div>
              ))
            : <p style={{ color: "#888" }}>Aucune affaire recensée.</p>
        )}

        {/* Votes */}
        {tab === "Votes" && (
          !votes ? <p style={{ color: "#888" }}>Chargement...</p>
          : <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                <StatBox label="Total votes"    value={votes.stats?.total} />
                <StatBox label="Pour"           value={votes.stats?.pour}           color="#2ecc71" />
                <StatBox label="Contre"         value={votes.stats?.contre}         color="#e74c3c" />
                <StatBox label="Abstention"     value={votes.stats?.abstention}     color="#f39c12" />
                <StatBox label="Participation"  value={votes.stats?.participationRate != null ? votes.stats.participationRate + "%" : null} />
              </div>
              {votes.votes?.length
                ? <table style={tbl}>
                    <thead><tr>
                      {["Position", "Titre du scrutin", "Date", "Résultat global"].map((h) =>
                        <th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {votes.votes.map((v, i) => (
                        <tr key={i}
                          style={{ background: i % 2 === 0 ? "#fff" : "#f9faff", cursor: "pointer" }}
                          onClick={() => onNavigate("exploration", { tab: "votes", q: v.scrutin?.title?.slice(0, 60) || "" })}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#eef2ff"}
                          onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#f9faff"}>
                          <td style={td}>
                            <span style={badge(
                              v.position === "POUR" ? "#e8fdf0" : v.position === "CONTRE" ? "#fde8e8" : "#fff8e8",
                              v.position === "POUR" ? "#2ecc71" : v.position === "CONTRE" ? "#e74c3c" : "#f39c12"
                            )}>{v.position}</span>
                          </td>
                          <td style={{ ...td, maxWidth: 360 }}>{v.scrutin?.title?.slice(0,80)}…</td>
                          <td style={td}>{v.scrutin?.votingDate ? new Date(v.scrutin.votingDate).toLocaleDateString("fr-FR") : "—"}</td>
                          <td style={td}>
                            <span style={{ color: v.scrutin?.result === "ADOPTED" ? "#2ecc71" : "#e74c3c", fontWeight:600 }}>
                              {v.scrutin?.result === "ADOPTED" ? "Adopté" : "Rejeté"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                : <p style={{ color: "#888" }}>Aucun vote individuel disponible.</p>
              }
              <Pager pagination={votes.pagination} onPage={setVotePage} />
            </>
        )}

        {/* Relations */}
        {tab === "Relations" && (
          <div>
            {/* Collègues de parti */}
            {partyMembers && partyMembers.filter(m => m.slug !== slug).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ margin: "0 0 4px", color: "#1a3a6e", fontSize: 13, fontWeight: 700 }}>
                  Collègues du même parti — {profile.currentParty?.shortName || profile.currentParty?.name}
                </h4>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "#aaa" }}>
                  Membres actifs du même groupe parlementaire
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {partyMembers.filter(m => m.slug !== slug).slice(0, 20).map((m, mi) => (
                    <div key={mi}
                      onClick={() => m.slug && onSelectSlug(m.slug)}
                      style={{ display:"flex", alignItems:"center", gap:6,
                        padding:"4px 10px", background:"#eef6ff", borderRadius:20,
                        fontSize:12, border:`1px solid ${profile.currentParty?.color || "#1a3a6e"}44`,
                        cursor: m.slug ? "pointer" : "default",
                        transition: "border 0.15s, background 0.15s" }}
                      onMouseEnter={(e) => { if (m.slug) { e.currentTarget.style.background="#ddeeff"; }}}
                      onMouseLeave={(e) => { e.currentTarget.style.background="#eef6ff"; }}>
                      {m.photoUrl && <img src={m.photoUrl} alt="" style={{ width:20, height:20, borderRadius:"50%", objectFit:"cover"}} />}
                      <span>{m.fullName}</span>
                      {m.slug && <span style={{ fontSize:10, color:"#1a3a6e", opacity:0.6 }}>→</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Relations issues de l'API */}
            {!relations ? <p style={{ color: "#888" }}>Chargement des relations...</p>
            : relations.clusters?.length
              ? relations.clusters.map((cluster, ci) => (
                  <div key={ci} style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: "0 0 8px", color: "#666", fontSize: 13 }}>
                      {cluster.label} — {cluster.type?.replace(/_/g," ")}
                    </h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {cluster.nodes?.slice(0,12).map((n, ni) => (
                        <div key={ni}
                          onClick={() => n.slug && onSelectSlug(n.slug)}
                          style={{ display:"flex", alignItems:"center", gap:6,
                            padding:"4px 10px", background:"#f8f9ff", borderRadius:20,
                            fontSize:12, border:"1px solid #e0e7ff",
                            cursor: n.slug ? "pointer" : "default",
                            transition: "border 0.15s, background 0.15s" }}
                          onMouseEnter={(e) => { if (n.slug) { e.currentTarget.style.border="1px solid #1a3a6e"; e.currentTarget.style.background="#eef2ff"; }}}
                          onMouseLeave={(e) => { e.currentTarget.style.border="1px solid #e0e7ff"; e.currentTarget.style.background="#f8f9ff"; }}>
                          {n.photoUrl && <img src={n.photoUrl} alt="" style={{ width:20, height:20, borderRadius:"50%", objectFit:"cover"}} />}
                          {n.fullName}
                          {n.slug && <span style={{ fontSize:10, color:"#1a3a6e", opacity:0.6 }}>→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              : (!partyMembers || partyMembers.length === 0) && (
                  <p style={{ color: "#888" }}>Aucune relation recensée.</p>
                )
            }
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Liste / recherche
// ============================================================
const PoliticianList = ({ onSelect }) => {
  const [q,      setQ]      = useState("");
  const [data,   setData]   = useState(null);
  const [page,   setPage]   = useState(1);
  const [loading, setLoad]  = useState(false);

  const search = useCallback(async (p = 1) => {
    setLoad(true);
    const res = await apiFetch("politiques", { limit: 24, page: p, ...(q ? { q } : {}) });
    setData(res);
    setPage(p);
    setLoad(false);
  }, [q]);

  useEffect(() => { search(1); }, [search]);

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <input style={{ ...inputS, flex:1 }} placeholder="Rechercher un élu (nom, prénom...)"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search(1)} />
        <button style={btnS} onClick={() => search(1)}>Rechercher</button>
      </div>

      {data && <p style={{ fontSize:13, color:"#888", marginBottom:12 }}>
        {data.pagination?.total?.toLocaleString()} représentants recensés
      </p>}

      {loading && <p style={{ color:"#888" }}>Chargement...</p>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:12 }}>
        {data?.data?.map((p) => (
          <div key={p.id} onClick={() => onSelect(p.slug)}
            style={{ background:"#fff", borderRadius:10, padding:"14px",
              boxShadow:"0 1px 4px rgba(0,0,0,0.07)", cursor:"pointer",
              border:"1px solid transparent", transition:"border 0.15s",
              display:"flex", flexDirection:"column", gap:8 }}
            onMouseEnter={(e) => e.currentTarget.style.border="1px solid #1a3a6e"}
            onMouseLeave={(e) => e.currentTarget.style.border="1px solid transparent"}>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              {p.photoUrl
                ? <img src={p.photoUrl} alt="" style={{ width:42,height:42,borderRadius:"50%",objectFit:"cover" }}/>
                : <div style={{ width:42,height:42,borderRadius:"50%",background:"#e8eeff",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:18,color:"#1a3a6e",fontWeight:700 }}>{p.fullName?.[0]}</div>
              }
              <div>
                <div style={{ fontWeight:600, fontSize:14 }}>{p.fullName}</div>
                <PartyBadge party={p.currentParty} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Pager pagination={data?.pagination} onPage={search} />
    </div>
  );
};

// ============================================================
// Page principale
// ============================================================
const AnnuairePage = ({ onNavigate }) => {
  const [selectedSlug, setSelectedSlug] = useState(null);

  return (
    <div style={{ padding:"1.5rem" }}>
      {!selectedSlug && <>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:"0.3rem" }}>
          <div style={{
            width:36, height:36, borderRadius:"50%",
            background:"linear-gradient(135deg, #1a3a6e 60%, #c9a227 100%)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:17, color:"#fff", fontWeight:900, flexShrink:0,
          }}>👤</div>
          <div>
            <h2 style={{ marginBottom:"0.1rem", color:"#1a2e5a" }}>Annuaire des représentants</h2>
            <p style={{ color:"#7a8aaa", margin:0, fontSize:13 }}>
              Cliquez sur un profil pour voir ses mandats, scandales et votes
            </p>
          </div>
        </div>
        <div style={{ display:"flex", height:3, borderRadius:2, overflow:"hidden", marginBottom:"1.4rem", marginTop:"0.8rem" }}>
          <div style={{ flex:1, background:"#002395" }} />
          <div style={{ flex:1, background:"#fff", border:"1px solid #e0e0e0" }} />
          <div style={{ flex:1, background:"#ED2939" }} />
        </div>
        <PoliticianList onSelect={setSelectedSlug} />
      </>}

      {selectedSlug && (
        <PoliticianProfile slug={selectedSlug} onBack={() => setSelectedSlug(null)}
          onNavigate={onNavigate} onSelectSlug={setSelectedSlug} />
      )}
    </div>
  );
};

const card    = { background:"#fff", borderRadius:10, padding:"1.2rem", boxShadow:"0 1px 4px rgba(26,58,110,0.08)", border:"1px solid #e8ecf8" };
const tbl     = { width:"100%", borderCollapse:"collapse", fontSize:13 };
const th      = { textAlign:"left", padding:"9px 10px", background:"#f0f3fa", fontWeight:700, color:"#1a3a6e", borderBottom:"2px solid #d4ddf7", fontSize:12, letterSpacing:"0.02em" };
const td      = { padding:"8px 10px", borderBottom:"1px solid #f0f2f8", verticalAlign:"top" };
const tabBtn  = { padding:"7px 18px", border:"none", borderRadius:"6px 6px 0 0", cursor:"pointer", fontWeight:600, fontSize:13 };
const pgBtn   = { padding:"5px 14px", border:"1px solid #d4ddf7", borderRadius:5, background:"#fff", cursor:"pointer", color:"#1a3a6e", fontWeight:600 };
const inputS  = { padding:"8px 12px", borderRadius:6, border:"1px solid #d4ddf7", fontSize:13 };
const btnS    = { padding:"8px 16px", background:"#1a3a6e", color:"#fff", border:"none", borderRadius:6, cursor:"pointer", fontWeight:600 };

export default AnnuairePage;
