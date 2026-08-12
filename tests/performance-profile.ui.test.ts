// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it } from "vitest"
import PerformanceProfile from "../src/components/skill/PerformanceProfile.vue"
import RviContextBreakdown from "../src/components/skill/RviContextBreakdown.vue"
import type {
  PerformanceDimensionScore,
  PerformanceMetricScore,
  PerformanceProfile as PerformanceProfileType,
  PerformanceScopeSummary,
  RviCareerArmHeadlineAggregate,
  RviCoverage,
} from "../src/types/stats"

const coverage: RviCoverage = {
  eligibleGames: 24,
  observedGames: 24,
  gameRatio: 1,
  eligibleWeight: 24,
  observedWeight: 24,
  weightRatio: 1,
}

const headline: RviCareerArmHeadlineAggregate = {
  source: "career_arm_mean",
  score: 50,
  nEff: 24,
  confidence: "provisional",
  coverage,
  availableArms: 8,
  totalArms: 8,
  armCoverage: 1,
  evidenceCoverage: 1,
}

function metric(
  key: string,
  label: string,
  tier: PerformanceMetricScore["tier"],
  vectorWeight: number,
  evidenceState: PerformanceMetricScore["evidenceState"] = "observed",
): PerformanceMetricScore {
  const observed = evidenceState === "observed"
  return {
    key,
    label,
    score: observed ? 61 : null,
    rawValue: observed ? 0.58 : null,
    unit: "%",
    tier,
    weight: vectorWeight,
    vectorWeight,
    gradeInfluence: vectorWeight * 0.16,
    influence: vectorWeight,
    games: observed ? 24 : 0,
    eligibleGames: 24,
    coverage: observed ? 1 : 0,
    effectiveGames: observed ? 24 : 0,
    evidenceState,
    description: `${label} description`,
    formula: `${label} formula`,
    comparison: "Compared with similar recorded games",
    referenceMatchCount: 18,
  }
}

const armDefinitions = [
  ["combat", "Combat", "CO", 50],
  ["positioning_survival", "Survival", "SU", 52],
  ["control_utility", "Utility", "UT", 55],
  ["economy", "Economy", "EC", 43],
  ["objectives_macro", "Macro", "MA", 48],
  ["vision_setup", "Vision", "VI", 46],
  ["initiative_pressure", "Initiative", "IN", 51],
  ["consistency_versatility", "Range", "RA", 25],
] as const

function dimensions(): PerformanceDimensionScore[] {
  return armDefinitions.map(([key, label, shortLabel, score], index) => ({
    key,
    label,
    shortLabel,
    description: `${label} description`,
    score,
    recentScore: score + (index % 2 ? -1 : 1),
    delta: index === 4 ? 2 : index % 3 - 1,
    games: 24,
    eligibleGames: 24,
    coverage: 1,
    effectiveGames: 24,
    confidence: "provisional",
    responsibilityWeight: key === "consistency_versatility" ? 0 : 1 / 7,
    headlineEligible: key !== "consistency_versatility",
    careerOnly: key === "consistency_versatility",
    metrics: key === "control_utility"
      ? [
          metric("crowd_control", "Crowd control", "CORE", 0.7),
          metric("ally_protection", "Ally protection", "DIAGNOSTIC", 0),
          metric("peel_timing", "Peel timing", "N/A", 0, "unavailable"),
        ]
      : key === "consistency_versatility"
        ? []
        : [metric(`${key}_core`, `${label} core`, "CORE", 1)],
  }))
}

function scope(
  key: string,
  kind: PerformanceScopeSummary["kind"],
  score: number,
  extra: Partial<PerformanceScopeSummary> = {},
): PerformanceScopeSummary {
  return {
    key,
    kind,
    score,
    headline,
    games: 24,
    measuredGames: 24,
    coverage: 1,
    confidence: "provisional",
    ...extra,
  }
}

function profile(): PerformanceProfileType {
  return {
    algorithmVersion: 3,
    recipeId: "test-recipe",
    scoringContext: "profile",
    weighting: { kind: "equal" },
    score: 50,
    recallScoreAverage: 52,
    headline,
    scopes: {
      overall: scope("overall", "overall", 50),
      positions: [
        scope("top", "position", 44, { position: "TOP" }),
        scope("middle", "position", 53, { position: "MIDDLE" }),
        scope("jungle", "position", 49, { position: "JUNGLE" }),
      ],
      primaryArchetypes: [
        scope("specialist", "primary_archetype", 45, { primaryArchetype: "specialist" }),
        scope("marksman", "primary_archetype", 51, { primaryArchetype: "marksman" }),
      ],
    },
    games: 24,
    recentGames: 8,
    measuredGames: 24,
    coverage: 1,
    confidence: "provisional",
    comparison: "Similar games in this saved history",
    dimensions: dimensions(),
    strongestKey: "combat",
    growthKey: "objectives_macro",
  }
}

function renderProfile(
  width: number,
  detailsOpen = true,
  profileValue: PerformanceProfileType = profile(),
) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
  window.dispatchEvent(new Event("resize"))

  return mount(PerformanceProfile, {
    props: {
      profile: profileValue,
      identity: {
        label: "Vanguard",
        description: "You combine availability with control and utility.",
      },
      rviArmDetailsOpen: detailsOpen,
    },
    global: {
      stubs: {
        PerformanceRadar: {
          template: '<div class="performance-radar-stub" role="img" aria-label="RVI radar" />',
        },
      },
    },
  })
}

describe("rendered RVI profile behavior", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("keeps every arm usable and updates the inspector at a compact viewport", async () => {
    const wrapper = renderProfile(320)
    const arms = wrapper.get(".career-arm-grid").findAll("button")

    expect(arms).toHaveLength(8)
    expect(wrapper.get(".rvi-identity-title h2").text()).toBe("Vanguard")
    expect(wrapper.get(".rvi-overall").text()).toContain("50")
    expect(wrapper.get(".rvi-overall").text()).toContain("8 of 8 arms")
    expect(wrapper.get(".rvi-context").text()).not.toContain("All matches")
    expect(wrapper.get(".rvi-context-best").text()).toContain("Best position")
    expect(wrapper.get(".rvi-context-best").text()).toContain("Mid")
    expect(wrapper.get(".rvi-context-best").text()).not.toContain("Top")
    expect(wrapper.get(".rvi-context-best").text()).toContain("Best primary archetype")
    expect(wrapper.get(".rvi-context-best").text()).toContain("Marksman")
    expect(wrapper.get(".rvi-context-best").text()).not.toContain("Specialist")
    expect(wrapper.get(".rvi-context").text()).not.toContain("Jungle")
    expect(wrapper.get(".rvi-context").text()).not.toContain("Top")
    expect(
      wrapper.get(".rvi-context").element.compareDocumentPosition(wrapper.get(".rvi-stage").element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(arms[0].attributes("aria-pressed")).toBe("true")
    expect(wrapper.get("#career-arm-details h3").text()).toBe("Combat measurements")

    await arms[2].trigger("click")

    expect(arms[0].attributes("aria-pressed")).toBe("false")
    expect(arms[2].attributes("aria-pressed")).toBe("true")
    expect(wrapper.get("#career-arm-details h3").text()).toBe("Utility measurements")
    expect(wrapper.get('[role="region"]').attributes("aria-label")).toBe("Utility: Used in score")
    expect(wrapper.get('[role="region"]').text()).toContain("Crowd control")

    const groups = wrapper.get('[aria-label="Measurement groups"]').findAll("button")
    await groups.find((button) => button.text().includes("More signals"))!.trigger("click")
    expect(wrapper.get('[role="region"]').attributes("aria-label")).toBe("Utility: More signals")
    expect(wrapper.get('[role="region"]').text()).toContain("Ally protection")

    await groups.find((button) => button.text().includes("Unavailable"))!.trigger("click")
    expect(wrapper.get('[role="region"]').text()).toContain("Peel timing")
    expect(wrapper.get('[data-state="unavailable"]').text()).toBe("Unavailable")
  })

  it("keeps detailed context comparisons out of Overview", () => {
    const wrapper = renderProfile(752)

    expect(wrapper.find(".rvi-context-more").exists()).toBe(false)
    expect(wrapper.get(".rvi-context").findAll("li")).toHaveLength(2)
    expect(wrapper.get(".rvi-context").findAll(".rvi-context-name").map((item) => item.text()))
      .toEqual(["Mid", "Marksman"])
  })

  it("keeps positions visible and condenses the longer archetype ranking", () => {
    const profileValue = profile()
    profileValue.scopes.positions.push(
      scope("bottom", "position", 47, { position: "BOTTOM" }),
      scope("utility", "position", 42, { position: "UTILITY" }),
    )
    profileValue.scopes.primaryArchetypes = [
      scope("specialist", "primary_archetype", 45, { primaryArchetype: "specialist" }),
      scope("marksman", "primary_archetype", 61, { primaryArchetype: "marksman" }),
      scope("vanguard", "primary_archetype", 58, { primaryArchetype: "vanguard" }),
      scope("warden", "primary_archetype", 55, { primaryArchetype: "warden" }),
      scope("enchanter", "primary_archetype", 44, { primaryArchetype: "enchanter" }),
      scope("assassin", "primary_archetype", 41, { primaryArchetype: "assassin" }),
    ]

    const wrapper = mount(RviContextBreakdown, { props: { profile: profileValue } })
    const groups = wrapper.findAll(".context-group")

    expect(groups).toHaveLength(2)
    expect(groups[0].findAll(".context-name").map((item) => item.text()))
      .toEqual(["Mid", "Jungle", "Bot", "Top", "Support"])
    expect(groups[1].findAll(".archetype-grid")[0].findAll(".context-name").map((item) => item.text()))
      .toEqual(["Marksman", "Vanguard", "Warden", "Specialist"])

    const disclosure = wrapper.get(".more-archetypes")
    expect(disclosure.attributes("open")).toBeUndefined()
    expect(disclosure.get("summary").text()).toContain("Show 2 more archetypes")
    expect(disclosure.get(".remaining-grid").findAll(".context-name").map((item) => item.text()))
      .toEqual(["Enchanter", "Assassin"])
    expect(wrapper.findAll(".context-rank").map((item) => item.text()))
      .toEqual(["#1", "#2", "#3", "#4", "#5", "#1", "#2", "#3", "#4", "#5", "#6"])
    expect(wrapper.find("button").exists()).toBe(false)
  })

  it("omits context cleanly when the selected games have no position or archetype scopes", () => {
    const profileValue = profile()
    profileValue.scopes.positions = []
    profileValue.scopes.primaryArchetypes = []
    const wrapper = renderProfile(752, true, profileValue)

    expect(wrapper.find(".rvi-context").exists()).toBe(false)
    expect(wrapper.find(".rvi-context-more").exists()).toBe(false)
    expect(wrapper.get(".rvi-stage").exists()).toBe(true)
    expect(wrapper.get(".career-arm-grid").exists()).toBe(true)
    expect(wrapper.get('[aria-label="Career RVI summary"]').exists()).toBe(true)
  })

  it("exposes a controlled, accessible arm-details disclosure at wide and narrow widths", async () => {
    for (const width of [320, 1440]) {
      const wrapper = renderProfile(width, false)
      const toggle = wrapper.get(".career-inspector-toggle")

      expect(toggle.attributes("aria-expanded")).toBe("false")
      expect(toggle.attributes("aria-controls")).toBe("career-arm-details")
      expect(wrapper.get<HTMLElement>("#career-arm-details").element.style.display).toBe("none")

      await toggle.trigger("click")
      expect(wrapper.emitted("update:rviArmDetailsOpen")).toEqual([[true]])

      await wrapper.setProps({ rviArmDetailsOpen: true })
      expect(toggle.attributes("aria-expanded")).toBe("true")
      expect(wrapper.get<HTMLElement>("#career-arm-details").element.style.display).toBe("")
      wrapper.unmount()
    }
  })

  it("opens native metric evidence details without losing the selected measurement group", async () => {
    const wrapper = renderProfile(480)
    const arms = wrapper.get(".career-arm-grid").findAll("button")
    await arms[2].trigger("click")

    const summary = wrapper.get(".metric-row summary")
    await summary.trigger("click")

    expect(wrapper.get(".metric-row").attributes()).toHaveProperty("open")
    expect(wrapper.get(".metric-detail").text()).toContain("Crowd control formula")
    expect(wrapper.get('[aria-label="Measurement groups"] button[aria-pressed="true"]').text())
      .toContain("Used in score")
  })
})
