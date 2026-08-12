// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import EvidenceForestPlot, {
  type EvidenceForestGroup,
} from "../src/components/skill/EvidenceForestPlot.vue"
import type { InsightFinding } from "../src/types/stats"

function finding(overrides: Partial<InsightFinding> = {}): InsightFinding {
  return {
    key: "after-loss",
    title: "After loss",
    summary: "Games after a loss were usually lower scoring.",
    evidenceLevel: "comparative",
    confidence: "medium",
    games: 12,
    eligibleGames: 40,
    effect: -4.5,
    unit: "grade",
    interval: { low: -7.8, high: -1.5, level: 0.95 },
    scope: "12 games after a loss vs 28 other games",
    caveat: "This is an association, not proof of cause.",
    ...overrides,
  }
}

function groups(): EvidenceForestGroup[] {
  return [
    {
      key: "conditions",
      title: "Playing Conditions",
      method: "Compare the matching games with the rest",
      findings: [
        finding(),
        finding({
          key: "late-night",
          title: "Late night",
          summary: "Late-night games were usually higher scoring.",
          confidence: "low",
          effect: 3,
          interval: { low: 0.5, high: 7, level: 0.95 },
        }),
        finding({
          key: "weekday",
          title: "Wednesday",
          summary: "Wednesday games do not show a dependable difference yet.",
          effect: 1,
          interval: { low: -3, high: 5, level: 0.95 },
          caveat: undefined,
        }),
      ],
    },
    {
      key: "duration",
      title: "Game Duration",
      method: "Compare each duration band with other measured bands",
      findings: [finding({
        key: "25-30",
        title: "25–30 minutes",
        summary: "25–30 minute games were usually higher scoring.",
        confidence: "high",
        games: 18,
        effect: 5.2,
        interval: { low: 2, high: 8, level: 0.95 },
      })],
    },
  ]
}

function renderQueue() {
  return mount(EvidenceForestPlot, {
    props: { groups: groups(), champions: null },
    global: {
      stubs: {
        FontAwesomeIcon: { template: '<span class="icon-stub" aria-hidden="true" />' },
      },
    },
  })
}

describe("Patterns review queue", () => {
  it("shows one standout per category by default and reveals the rest on request", async () => {
    const wrapper = renderQueue()

    expect(wrapper.text()).toContain("3 patterns stand out")
    expect(wrapper.get('button[aria-pressed="true"]').text()).toContain("Worth reviewing")

    const conditionRows = wrapper.get(".review-group").findAll(".pattern-row")
    expect(conditionRows).toHaveLength(2)
    expect((conditionRows[0].element as HTMLElement).style.display).not.toBe("none")
    expect((conditionRows[1].element as HTMLElement).style.display).toBe("none")

    const more = wrapper.get(".more-patterns")
    expect(more.attributes("aria-expanded")).toBe("false")
    await more.trigger("click")
    expect(more.attributes("aria-expanded")).toBe("true")
    expect((conditionRows[1].element as HTMLElement).style.display).not.toBe("none")
  })

  it("switches to inconclusive results with explicit, non-color-only language", async () => {
    const wrapper = renderQueue()
    const learning = wrapper.findAll(".review-filters button")[1]

    await learning.trigger("click")

    expect(learning.attributes("aria-pressed")).toBe("true")
    expect(wrapper.get(".pattern-row.learning").text()).toContain("No clear difference yet")
    expect(wrapper.text()).toContain("Wednesday games do not show a dependable difference yet")
  })

  it("reveals the summary, comparison scope, method, range, and caveat in native details", async () => {
    const wrapper = renderQueue()
    const row = wrapper.get<HTMLDetailsElement>(".pattern-row")

    expect(row.element.open).toBe(false)
    await row.get("summary").trigger("click")

    expect(row.element.open).toBe(true)
    expect(row.text()).toContain("12 games after a loss vs 28 other games")
    expect(row.text()).toContain("Compare the matching games with the rest")
    expect(row.text()).toContain("-7.8 pts to -1.5 pts")
    expect(row.text()).toContain("This is an association, not proof of cause")
  })

  it("keeps the all-estimates comparison closed until requested", async () => {
    const wrapper = renderQueue()
    const comparison = wrapper.get<HTMLDetailsElement>(".compare-evidence")

    expect(comparison.element.open).toBe(false)
    expect(comparison.get("summary").text()).toContain("Compare every measured estimate")
    await comparison.get("summary").trigger("click")
    expect(comparison.element.open).toBe(true)
    expect(comparison.findAll(".comparison-row")).toHaveLength(4)
  })
})
