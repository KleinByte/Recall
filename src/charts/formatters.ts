export function formatRate(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`
}

export function formatPercentagePoints(value: number, digits = 1) {
  const amount = value * 100
  return `${amount > 0 ? "+" : ""}${amount.toFixed(digits)} pp`
}

export function formatGradeShift(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)} Recall score`
}

export function formatSigned(value: number, digits = 1) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`
}

/**
 * ECharts exposes a primitive through `value`, but exposes the original
 * series entry through `data`. Series entries with per-point styling are
 * objects, so tooltip formatters must unwrap their numeric value first.
 */
export function numericChartValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (!value || typeof value !== "object" || !("value" in value)) return undefined
  return numericChartValue((value as { value?: unknown }).value)
}

export function escapeTooltip(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}
