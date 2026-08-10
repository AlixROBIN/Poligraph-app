import { useState, useEffect } from "react";
import { fetchPartis } from "../data/api";

let _byShortName = null;

export function useParties() {
  const [ready, setReady] = useState(!!_byShortName);
  useEffect(() => {
    if (_byShortName) return;
    fetchPartis().then((list) => {
      _byShortName = {};
      list.forEach((p) => { if (p.shortName) _byShortName[p.shortName] = p; });
      setReady(true);
    }).catch(() => setReady(true));
  }, []);
  return ready ? _byShortName : null;
}

// Badge parti avec logo réel (repli en monogramme coloré si absent).
export default function PartyLogo({ code, size = 16, showCode = true }) {
  const byShortName = useParties();
  const party = byShortName?.[code];
  const logo  = party?.logoUrl;
  const color = party?.color || "#5b6b85";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {logo
        ? <img src={logo} alt={code} style={{ height: size, maxWidth: size * 1.4, objectFit: "contain" }} />
        : <span style={{
            width: size, height: size, borderRadius: "50%", background: color,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: size * 0.42, fontWeight: 800, flexShrink: 0,
          }}>{code?.slice(0, 2)}</span>}
      {showCode && <span>{code}</span>}
    </span>
  );
}
