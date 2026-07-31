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

export function escapeTooltip(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}
