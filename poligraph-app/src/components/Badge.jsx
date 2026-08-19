import { useParties } from "./PartyLogo";

// Pilule colorée réutilisable — fond pastel + texte foncé de la même teinte,
// jamais de fond saturé avec texte blanc (réservé aux boutons d'action).
//
// Deux modes :
//   - <Badge tone="success" text="Vrai" />           → palette sémantique (statuts/verdicts)
//   - <Badge party="RN" text="RN" />                  → couleur officielle du parti (désaturée)
const TONES = {
  success: { bg: "var(--color-green-100)",  fg: "var(--color-green-800)"  },
  danger:  { bg: "var(--color-red-100)",    fg: "var(--color-red-800)"    },
  warning: { bg: "var(--color-amber-100)",  fg: "var(--color-amber-800)"  },
  info:    { bg: "var(--color-blue-100)",   fg: "var(--color-blue-800)"   },
  purple:  { bg: "var(--color-purple-100)", fg: "var(--color-purple-800)" },
  neutral: { bg: "var(--color-gray-100)",   fg: "var(--color-gray-800)"   },
};

export default function Badge({ tone = "neutral", party, text, size = "md" }) {
  const byShortName = useParties();

  let bg, fg;
  if (party) {
    const official = byShortName?.[party]?.color;
    if (official) {
      // Désature la couleur officielle du parti : fond très clair, texte foncé,
      // dérivés de la même teinte via color-mix (garde la couleur "attendue"
      // par le public tout en restant dans l'esprit sobre du reste de l'appli).
      bg = `color-mix(in srgb, ${official} 14%, white)`;
      fg = `color-mix(in srgb, ${official} 65%, black)`;
    } else {
      bg = TONES.neutral.bg; fg = TONES.neutral.fg;
    }
  } else {
    const t = TONES[tone] || TONES.neutral;
    bg = t.bg; fg = t.fg;
  }

  const pad = size === "sm" ? "2px 9px" : "3px 11px";
  const fontSize = size === "sm" ? 10.5 : 11.5;

  return (
    <span style={{
      display: "inline-block",
      background: bg,
      color: fg,
      borderRadius: 999,
      padding: pad,
      fontSize,
      fontWeight: 500,
      whiteSpace: "nowrap",
      lineHeight: 1.5,
    }}>
      {text ?? party}
    </span>
  );
}
