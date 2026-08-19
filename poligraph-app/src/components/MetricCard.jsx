import Card from "./Card";

// Format "métrique" pour les chiffres clés : label discret au-dessus,
// chiffre en gros en dessous — pas de bloc coloré encadré à part.
export default function MetricCard({ label, value, sub, icon, onClick }) {
  return (
    <Card onClick={onClick} hoverable={!!onClick} padding="1.25rem">
      {icon && (
        <div style={{
          width: 36, height: 36, borderRadius: 10, marginBottom: 10,
          background: "var(--color-blue-50)", color: "var(--color-blue-800)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        }}>{icon}</div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--pg-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, color: "var(--pg-ink)", letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--pg-muted)", marginTop: 2 }}>{sub}</div>}
      {onClick && <div style={{ fontSize: 10.5, color: "var(--color-blue-600)", marginTop: 6 }}>→ Explorer</div>}
    </Card>
  );
}
