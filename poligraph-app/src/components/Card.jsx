import { useState } from "react";

// Carte de base réutilisable — fond blanc, bordure fine, radius 12px,
// ombre très subtile qui n'apparaît qu'au survol (si hoverable).
export default function Card({ children, title, subtitle, hoverable, onClick, style, padding = "1.4rem" }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hoverable && setHover(true)}
      onMouseLeave={() => hoverable && setHover(false)}
      style={{
        background: "var(--pg-surface)",
        border: "1px solid var(--pg-line)",
        borderRadius: "var(--pg-r-md)",
        padding,
        boxShadow: hover ? "var(--pg-sh-sm)" : "none",
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow 0.15s, transform 0.15s",
        transform: hover ? "translateY(-1px)" : "none",
        ...style,
      }}
    >
      {title && <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 500, color: "var(--pg-ink)" }}>{title}</h3>}
      {subtitle && <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--pg-muted)" }}>{subtitle}</p>}
      {children}
    </div>
  );
}
