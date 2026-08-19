// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import JunglePathingReview from
  "../src/features/minimap-telemetry/JunglePathingReview.vue"

const apiMocks = vi.hoisted(() => ({
  getJunglePathingReview: vi.fn(),
}))

vi.mock("../src/helpers/api.js", () => ({ api: apiMocks }))

describe("minimap pathing review fallback", () => {
  it("shows no telemetry when an analysis exists but has no usable evidence", async () => {
    apiMocks.getJunglePathingReview.mockResolvedValue({
      analysis: {
        analysisId: "empty",
        gameId: 42,
        puuid: "owner",
        inputHash: "0".repeat(64),
        graphVersion: 1,
        modelVersion: 2,
        status: "complete",
        coverage: {},
        createdAt: 1,
      },
      segments: [],
      campClears: [],
    })

    const wrapper = mount(JunglePathingReview, {
      props: { gameId: 42 },
    })
    await flushPromises()

    expect(wrapper.text()).toContain(
      "No minimap telemetry was captured for this match.",
    )
    expect(wrapper.find("canvas").exists()).toBe(false)
  })

  it("does not revive legacy model-one path evidence", async () => {
    apiMocks.getJunglePathingReview.mockResolvedValue({
      analysis: {
        analysisId: "legacy",
        gameId: 43,
        puuid: "owner",
        inputHash: "1".repeat(64),
        graphVersion: 1,
        modelVersion: 1,
        status: "complete",
        coverage: {},
        createdAt: 1,
      },
      segments: [{
        gameId: 43,
        participantKey: "enemy:legacy",
        startTimeMs: 1_000,
        endTimeMs: 1_100,
        kind: "observed",
        points: [{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.95 }],
        confidence: 1,
        modelVersion: 1,
      }],
      campClears: [],
    })

    const wrapper = mount(JunglePathingReview, {
      props: { gameId: 43 },
    })
    await flushPromises()

    expect(wrapper.text()).toContain(
      "No minimap telemetry was captured for this match.",
    )
    expect(wrapper.find("canvas").exists()).toBe(false)
  })
})
