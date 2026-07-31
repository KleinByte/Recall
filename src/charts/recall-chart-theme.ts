export const CHART_COLOURS = {
  gold: "#c8aa6d",
  goldBright: "#f0e6d2",
  cyan: "#0acbe6",
  cyanDark: "#0397ab",
  positive: "#1cbf8a",
  negative: "#e84057",
  text: "#f0e6d2",
  textSecondary: "#a09b8c",
  textMuted: "#6b6863",
  surface: "#0f1c33",
  grid: "rgba(200, 170, 109, 0.14)",
  gridSoft: "rgba(200, 170, 109, 0.10)",
  neutral: "#7f8798",
} as const
export const RECALL_CHART_THEME = {
  color: [
    CHART_COLOURS.gold,
    CHART_COLOURS.cyan,
    CHART_COLOURS.negative,
    CHART_COLOURS.positive,
    CHART_COLOURS.textSecondary,
    CHART_COLOURS.cyanDark,
  ],
  textStyle: {
    color: CHART_COLOURS.textSecondary,
    fontFamily: "Spiegel, Arial, sans-serif",
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: CHART_COLOURS.grid } },
    axisTick: { lineStyle: { color: CHART_COLOURS.grid } },
    axisLabel: { color: CHART_COLOURS.textSecondary },
    splitLine: { lineStyle: { color: CHART_COLOURS.gridSoft } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: CHART_COLOURS.grid } },
    axisTick: { lineStyle: { color: CHART_COLOURS.grid } },
    axisLabel: { color: CHART_COLOURS.textSecondary },
    splitLine: { lineStyle: { color: CHART_COLOURS.grid } },
  },
  tooltip: {
    backgroundColor: CHART_COLOURS.surface,
    borderColor: "rgba(200, 170, 109, 0.55)",
    borderWidth: 1,
    textStyle: { color: CHART_COLOURS.text },
    padding: 10,
  },
} as const

