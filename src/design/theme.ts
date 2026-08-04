/**
 * Canvas and SVG renderers cannot reliably resolve CSS custom properties.
 * Keep this small bridge aligned with the semantic roles in tokens.css.
 */
export const UI_THEME = {
  accent: "#c8aa6d",
  accentStrong: "#e8d29a",
  live: "#35d4f0",
  liveDim: "#087ea4",
  positive: "#2ec4a6",
  negative: "#e45868",
  text: "#e8d29a",
  textSubtle: "#aaa493",
  textMuted: "#718198",
  surfaceInset: "#070f1b",
  grid: "rgba(200, 170, 109, 0.18)",
  gridSoft: "rgba(200, 170, 109, 0.10)",
  neutral: "#7f8798",
  teamBlue: "#35b9dd",
  teamRed: "#e45868",
} as const
