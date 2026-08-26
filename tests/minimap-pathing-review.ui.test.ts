// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import JungleClearTimelineSummary from
  "../src/features/minimap-telemetry/JungleClearTimelineSummary.vue"
import type { CampClearEvent, CampKey } from "../src/shared/minimap/contracts"
import type { MinimapPathingReview } from "../src/shared/minimap/review"

function clear(
  campKey: CampKey,
  clearedAtMs: number,
  routeIndex: number,
  overrides: Partial<CampClearEvent> = {},
): CampClearEvent {
  return {
    gameId: 44,
    puuid: "owner",
    campKey,
    clearedAtMs,
    source: "minimap_cv",
    sourceConfidence: 0.9,
    attribution: "local",
    attributionConfidence: 0.8,
    evidence: {
      campTransition: true,
      localPositionObserved: true,
      transitionConfidence: 0.9,
    },
    routeIndex,
    algorithmVersion: 4,
    ...overrides,
  }
}

describe("compact jungle clear timeline summary", () => {
  it("reports loading and empty evidence without adding another playback surface", () => {
    const loading = mount(JungleClearTimelineSummary, {
      props: { timestamp: 0, loading: true },
    })

    expect(loading.text()).toContain("Loading minimap evidence")
    expect(loading.find("canvas").exists()).toBe(false)
    expect(loading.find("input").exists()).toBe(false)

    const empty = mount(JungleClearTimelineSummary, {
      props: {
        timestamp: 0,
        review: { segments: [], campClears: [] },
      },
    })

    expect(empty.text()).toContain("No local first-clear camps")
    expect(empty.findAll("button")).toHaveLength(0)
  })

  it("shows local first-clear facts and emits the selected split timestamp", async () => {
    const review: MinimapPathingReview = {
      segments: [],
      campClears: [
        clear("west_blue", 125_000, 0),
        clear("east_red", 130_000, 1, { attribution: "other" }),
        clear("west_gromp", 160_000, 1, {
          source: "live_client_inference",
          sourceConfidence: 0.7,
          attributionConfidence: 0.6,
        }),
      ],
    }
    const wrapper = mount(JungleClearTimelineSummary, {
      props: { review, timestamp: 130_000 },
    })

    expect(wrapper.get('[aria-label="Jungle clear timeline summary"]').text())
      .toContain("2 / 6 camps")
    expect(wrapper.text()).toContain("Incomplete")
    expect(wrapper.text()).toContain("70%")
    expect(wrapper.text()).toContain("West Blue → West Gromp")
    expect(wrapper.text()).not.toContain("East Red")

    const splits = wrapper.findAll(".clear-splits button")
    expect(splits).toHaveLength(2)
    expect(splits[0].classes()).toContain("reached")
    expect(splits[1].classes()).not.toContain("reached")
    expect(splits[1].text()).toContain("Live Client + position")

    await splits[1].trigger("click")

    expect(wrapper.emitted("seek")).toEqual([[160_000]])
  })
})
