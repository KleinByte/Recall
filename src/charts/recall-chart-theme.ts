import { UI_THEME } from "../design/theme"

/**
 * Semantic colors for canvas/SVG charts. Feature charts should choose a role
 * from this object instead of copying palette values into their options.
 */
export const CHART_COLOURS = {
  accent: UI_THEME.accent,
  accentStrong: UI_THEME.accentStrong,
  live: UI_THEME.live,
  liveDim: UI_THEME.liveDim,
  positive: UI_THEME.positive,
  negative: UI_THEME.negative,
  text: UI_THEME.text,
  textSubtle: UI_THEME.textSubtle,
  textMuted: UI_THEME.textMuted,
  surfaceInset: UI_THEME.surfaceInset,
  grid: UI_THEME.grid,
  gridSoft: UI_THEME.gridSoft,
  neutral: UI_THEME.neutral,
  teamBlue: UI_THEME.teamBlue,
  teamRed: UI_THEME.teamRed,

  // Compatibility aliases for specialty charts that have not migrated yet.
  gold: UI_THEME.accent,
  goldBright: UI_THEME.accentStrong,
  cyan: UI_THEME.live,
  cyanDark: UI_THEME.liveDim,
  textSecondary: UI_THEME.textSubtle,
  surface: UI_THEME.surfaceInset,
} as const

function alpha(hex: string, opacity: number) {
  const value = hex.replace("#", "")
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
  return `rgba(${channels.join(", ")}, ${opacity})`
}

/** Reusable material and state treatments shared by feature chart options. */
export const CHART_STYLES = {
  grid: UI_THEME.grid,
  gridSoft: UI_THEME.gridSoft,
  gridStrong: alpha(UI_THEME.accent, .36),
  accentArea: alpha(UI_THEME.accent, .12),
  accentAreaStrong: alpha(UI_THEME.accent, .2),
  liveArea: alpha(UI_THEME.live, .12),
  liveFill: alpha(UI_THEME.live, .42),
  positiveFill: alpha(UI_THEME.positive, .58),
  negativeFill: alpha(UI_THEME.negative, .54),
  neutralFill: alpha(UI_THEME.neutral, .18),
  zeroLine: alpha(UI_THEME.text, .42),
  tooltipBorder: alpha(UI_THEME.accent, .55),
  labelBackdrop: "rgba(6, 14, 28, .78)",
  labelShadow: "rgba(0, 0, 0, .78)",
} as const

/** Ordered low-to-high score colors; never use for categorical series. */
export const CHART_SCORE_RAMP = [
  "#4a0717",
  "#8f1428",
  "#17608f",
  "#18a66e",
  "#e7bd55",
] as const

export const RECALL_CHART_THEME = {
  color: [
    CHART_COLOURS.accent,
    CHART_COLOURS.live,
    CHART_COLOURS.negative,
    CHART_COLOURS.positive,
    CHART_COLOURS.textSubtle,
    CHART_COLOURS.liveDim,
  ],
  textStyle: {
    color: CHART_COLOURS.textSubtle,
    fontFamily: "Spiegel, Arial, sans-serif",
    fontSize: 12,
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: CHART_STYLES.grid } },
    axisTick: { lineStyle: { color: CHART_STYLES.grid } },
    axisLabel: { color: CHART_COLOURS.textSubtle, fontSize: 11 },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: CHART_STYLES.grid } },
    axisTick: { lineStyle: { color: CHART_STYLES.grid } },
    axisLabel: { color: CHART_COLOURS.textSubtle, fontSize: 11 },
    splitLine: { lineStyle: { color: CHART_STYLES.grid } },
  },
  tooltip: {
    backgroundColor: CHART_COLOURS.surfaceInset,
    borderColor: CHART_STYLES.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: CHART_COLOURS.text, fontSize: 12 },
    padding: 10,
  },
} as const
