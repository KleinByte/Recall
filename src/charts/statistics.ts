export function quantile(values: number[], percentile: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const fraction = index - lower
  return sorted[lower] + (sorted[lower + 1] - sorted[lower] || 0) * fraction
}

export function boxplot(values: number[]): [number, number, number, number, number] {
  return [
    Math.min(...values),
    quantile(values, 0.25),
    quantile(values, 0.5),
    quantile(values, 0.75),
    Math.max(...values),
  ]
}
