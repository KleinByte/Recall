import { describe, expect, it } from "vitest"
import { CAMP_BY_KEY } from "../electron/main/jungle/camp-map.js"
import { LiveClientCampInference } from
  "../electron/main/jungle/live-client-camp-inference.js"
import type { ChampionTrackSnapshot } from
  "../src/shared/minimap/contracts.js"

const localAt = (campKey: "west_blue" | "west_gromp"): ChampionTrackSnapshot => ({
  participantKey: "ally:local",
  championName: "Nunu",
  team: "ally",
  state: "visible",
  position: CAMP_BY_KEY.get(campKey)!.center,
  confidence: 0.95,
})

const delta = (creepScoreDelta: number, goldResidual: number) => ({
  elapsedMs: 500,
  goldDelta: goldResidual,
  estimatedPassiveGold: 0,
  goldResidual,
  creepScoreDelta,
})

describe("LiveClientCampInference", () => {
  it("emits one conservative local clear after CS/gold evidence becomes quiet", () => {
    const inference = new LiveClientCampInference()
    const base = {
      gameId: 77,
      puuid: "owner",
      localParticipantKey: "ally:local",
      tracks: [localAt("west_blue")],
      routePlan: ["west_blue" as const],
      routeIndex: 0,
    }

    expect(inference.observe({
      ...base,
      gameTimeMs: 100_000,
      evidence: delta(4, 72),
    })).toBeUndefined()
    // The same camp event may arrive across adjacent 500 ms snapshots.
    expect(inference.observe({
      ...base,
      gameTimeMs: 100_500,
      evidence: delta(0, 0),
    })).toBeUndefined()
    expect(inference.observe({
      ...base,
      gameTimeMs: 101_000,
      evidence: delta(0, 0),
    })).toMatchObject({
      campKey: "west_blue",
      clearedAtMs: 100_000,
      source: "live_client_inference",
      attribution: "local",
      routeIndex: 0,
      evidence: {
        creepScoreDelta: 4,
        expectedNextCamp: true,
      },
    })
  })

  it("abstains without a visible local CV position or compatible gold", () => {
    const inference = new LiveClientCampInference()
    const hidden: ChampionTrackSnapshot = {
      ...localAt("west_blue"),
      state: "not_visible",
      position: undefined,
    }
    const base = {
      gameId: 77,
      puuid: "owner",
      localParticipantKey: "ally:local",
      routeIndex: 0,
    }
    inference.observe({
      ...base,
      gameTimeMs: 100_000,
      tracks: [hidden],
      evidence: delta(4, 70),
    })
    expect(inference.observe({
      ...base,
      gameTimeMs: 101_000,
      tracks: [hidden],
      evidence: delta(0, 0),
    })).toBeUndefined()

    inference.observe({
      ...base,
      gameTimeMs: 110_000,
      tracks: [localAt("west_gromp")],
      evidence: delta(4, 0),
    })
    expect(inference.observe({
      ...base,
      gameTimeMs: 111_000,
      tracks: [localAt("west_gromp")],
      evidence: delta(0, 0),
    })).toBeUndefined()
  })

  it("lets an observed camp transition suppress the fallback duplicate", () => {
    const inference = new LiveClientCampInference()
    inference.markObservedClear("west_blue", 100_000)
    const base = {
      gameId: 77,
      puuid: "owner",
      localParticipantKey: "ally:local",
      tracks: [localAt("west_blue")],
      routeIndex: 0,
    }
    inference.observe({
      ...base,
      gameTimeMs: 100_500,
      evidence: delta(4, 70),
    })
    expect(inference.observe({
      ...base,
      gameTimeMs: 102_000,
      evidence: delta(0, 0),
    })).toBeUndefined()
  })
})
