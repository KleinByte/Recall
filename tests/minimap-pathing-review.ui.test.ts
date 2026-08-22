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
  it("renders observed and estimated routes while keeping rejected gaps separate", async () => {
    apiMocks.getJunglePathingReview.mockResolvedValue({
      analysis: {
        analysisId: "playback",
        gameId: 44,
        puuid: "owner",
        inputHash: "2".repeat(64),
        graphVersion: 3,
        modelVersion: 3,
        status: "complete",
        coverage: {},
        createdAt: 1,
      },
      participants: [{
        participantKey: "ally:local",
        championName: "Nunu",
        team: "ally",
        isLocal: true,
      }],
      segments: [{
        gameId: 44,
        participantKey: "ally:local",
        startTimeMs: 1_000,
        endTimeMs: 3_000,
        kind: "observed",
        points: [{ x: 0.21, y: 0.71 }, { x: 0.28, y: 0.63 }],
        confidence: 0.91,
        modelVersion: 2,
      }, {
        gameId: 44,
        participantKey: "ally:local",
        startTimeMs: 3_000,
        endTimeMs: 4_500,
        kind: "inferred",
        points: [
          { x: 0.28, y: 0.63 },
          { x: 0.35, y: 0.56 },
          { x: 0.42, y: 0.51 },
        ],
        confidence: 0.72,
        inferenceMode: "smoothed_postgame",
        modelVersion: 3,
      }, {
        gameId: 44,
        participantKey: "ally:local",
        startTimeMs: 4_500,
        endTimeMs: 4_500,
        kind: "unknown",
        points: [{ x: 0.42, y: 0.51 }],
        confidence: 0.55,
        modelVersion: 2,
      }],
      campClears: [{
        gameId: 44,
        puuid: "owner",
        campKey: "west_blue",
        clearedAtMs: 4_000,
        respawnAtMs: 274_000,
        source: "minimap_cv",
        sourceConfidence: 0.9,
        attribution: "local",
        attributionConfidence: 0.88,
        evidence: {
          campTransition: true,
          localPositionObserved: true,
          transitionConfidence: 0.9,
        },
        routeIndex: 0,
        algorithmVersion: 4,
      }],
    })

    const wrapper = mount(JunglePathingReview, {
      props: { gameId: 44 },
    })
    await flushPromises()

    const scrubber = wrapper.get<HTMLInputElement>(
      'input[aria-label="Jungle path playback time"]',
    )
    await scrubber.setValue("5000")

    expect(wrapper.get(".playback-map").attributes("style")).toContain("map11.png")
    expect(wrapper.get("select").element.value).toBe("ally:local")
    expect(wrapper.text()).toContain("Nunu · You")
    expect(wrapper.findAll(".path-layer polyline")).toHaveLength(2)
    expect(wrapper.findAll(".path-layer polyline.estimated")).toHaveLength(1)
    expect(wrapper.findAll(".sighting-marker")).toHaveLength(1)
    expect(wrapper.findAll(".clear-tick")).toHaveLength(1)
    expect(wrapper.get(".first-clear-summary").text()).toContain("Incomplete")
    expect(wrapper.get(".first-clear-summary").text()).toContain("1 / 6 unique camps")
    expect(wrapper.text()).not.toContain("Live Client + position")
    expect(wrapper.text()).toContain("Minimap CV")
    expect(wrapper.text()).toContain("brief sighting reshapes the estimate")
    expect(wrapper.find("canvas").exists()).toBe(false)
  })

})
