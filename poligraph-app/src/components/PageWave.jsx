// Vague décorative de pied de page — même famille de teintes que les
// nuages dégradés du fond (rouge, or, bleu), pour une identité cohérente
// du haut au bas de chaque page.
export default function PageWave() {
  return (
    <div style={{ width: "100%", lineHeight: 0, marginTop: "2rem", pointerEvents: "none" }} aria-hidden="true">
      <svg
        viewBox="0 0 1440 160"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 110, display: "block" }}
      >
        <path
          d="M0,90 C240,140 480,40 720,70 C960,100 1200,150 1440,90 L1440,160 L0,160 Z"
          fill="color-mix(in srgb, var(--color-blue-400) 22%, transparent)"
        />
        <path
          d="M0,110 C280,60 520,150 780,110 C1040,70 1220,120 1440,80 L1440,160 L0,160 Z"
          fill="color-mix(in srgb, var(--pg-gold) 20%, transparent)"
        />
        <path
          d="M0,130 C300,100 620,160 900,120 C1140,86 1300,140 1440,120 L1440,160 L0,160 Z"
          fill="color-mix(in srgb, var(--color-red-400) 22%, transparent)"
        />
      </svg>
    </div>
  );
}
