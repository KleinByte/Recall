import { describe, expect, it } from "vitest"
import { escapeTooltip, formatSigned, numericChartValue } from "../src/charts/formatters"

describe("chart formatters", () => {
  it("extracts values from primitive and styled ECharts data entries", () => {
    expect(numericChartValue(12)).toBe(12)
    expect(numericChartValue({ value: -4, itemStyle: { color: "red" } })).toBe(-4)
    expect(numericChartValue({ value: { value: 3 } })).toBe(3)
  })

  it("rejects missing and non-finite values instead of reaching toFixed", () => {
    expect(numericChartValue({ itemStyle: {} })).toBeUndefined()
    expect(numericChartValue(Number.NaN)).toBeUndefined()
    expect(numericChartValue("4")).toBeUndefined()
  })

  it("formats extracted signed values", () => {
    expect(formatSigned(numericChartValue({ value: 4 })!, 0)).toBe("+4")
    expect(formatSigned(numericChartValue({ value: -2 })!, 0)).toBe("-2")
  })

  it("escapes missing and unsafe tooltip labels without throwing", () => {
    expect(escapeTooltip(undefined)).toBe("")
    expect(escapeTooltip('<A & "B">')).toBe("&lt;A &amp; &quot;B&quot;&gt;")
  })
})
