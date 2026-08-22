// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import MatchPlaybackMap from "../src/components/MatchPlaybackMap.vue"
import type { MinimapPathingReview } from "../src/shared/minimap/review"
import type { TimelineFrame } from "../src/types/review"
import type { MatchRow, ParticipantRow } from "../src/types/stats"

const match = {
  gameId: 42,
  playedAt: 1_725_000_000_000,
  durationSecs: 600,
  mode: "sr_normal",
  modeFamily: "sr",
  gameVersion: "16.14.1",
} as MatchRow

const owner = {
  gameId: 42,
  participantPuuid: "owner-puuid",
  puuid: "owner-puuid",
  participantId: 1,
  teamId: 100,
  isPlayer: 1,
  championId: 20,
  summonerName: "Owner#NA1",
  items: [],
  perks: [],
} as ParticipantRow

function frame(timestamp: number, position: { x: number; y: number }): TimelineFrame {
  return {
    timestamp,
    blueGold: 0,
    redGold: 0,
    ownerGold: 0,
    ownerLevel: 1,
    ownerXp: 0,
    ownerCs: 0,
    participants: [{
      participantId: 1,
      teamId: 100,
      currentGold: 0,
      totalGold: 0,
      level: 1,
      xp: 0,
      minionsKilled: 0,
      jungleMinionsKilled: 0,
      position,
    }],
  }
}

const minimapReview: MinimapPathingReview = {
  participants: [{
    participantKey: "ally:riot:owner#na1",
    championName: "Nunu & Willump",
    team: "ally",
    isLocal: true,
  }],
  segments: [{
    gameId: 42,
    participantKey: "ally:riot:owner#na1",
    startTimeMs: 59_000,
    endTimeMs: 61_000,
    kind: "observed",
    points: [{ x: .2, y: .7 }, { x: .3, y: .6 }],
    confidence: .94,
    modelVersion: 2,
  }, {
    gameId: 42,
    participantKey: "ally:riot:owner#na1",
    startTimeMs: 61_001,
    endTimeMs: 119_000,
    kind: "unknown",
    points: [],
    confidence: 0,
    modelVersion: 2,
  }],
  campClears: [{
    gameId: 42,
    puuid: "owner-puuid",
    campKey: "west_blue",
    clearedAtMs: 45_000,
    respawnAtMs: 315_000,
    source: "minimap_cv",
    sourceConfidence: .93,
    attribution: "local",
    attributionConfidence: .91,
    evidence: {
      campTransition: true,
      localPositionObserved: true,
      transitionConfidence: .93,
    },
    routeIndex: 0,
    algorithmVersion: 4,
  }],
}

describe("unified match timeline playback", () => {
  it("renders CV evidence and jungle clears on the primary shared clock", async () => {
    const wrapper = mount(MatchPlaybackMap, {
      props: {
        match,
        participants: [owner],
        frames: [
          frame(30_000, { x: 1_000, y: 1_000 }),
          frame(120_000, { x: 7_000, y: 7_000 }),
        ],
        events: [],
        timestamp: 60_000,
        minimapReview,
      },
    })

    const token = wrapper.get(".champion-token")
    expect(token.classes()).toContain("cv-observed")
    expect(token.classes()).toContain("cv-origin")
    expect(token.attributes("title")).toContain("Observed CV")
    expect(token.attributes("title")).toContain("94% confidence")
    expect(wrapper.findAll(".trail-layer .origin-minimap_cv")).toHaveLength(1)
    const trailElement = wrapper.get(".trail-layer .origin-minimap_cv").element
    expect(wrapper.findAll(".camp-clear-tick")).toHaveLength(1)
    expect(wrapper.findAll(".camp-state-marker.local")).toHaveLength(1)
    expect(wrapper.text()).toContain("1 / 1 clears reached")

    await wrapper.get(".camp-clear-tick").trigger("click")
    expect(wrapper.emitted("update:timestamp")?.at(-1)).toEqual([45_000])

    await wrapper.setProps({ timestamp: 90_000 })
    expect(wrapper.get(".trail-layer .origin-minimap_cv").element).toBe(trailElement)
    const fallback = wrapper.get(".champion-token")
    expect(fallback.classes()).toContain("estimated")
    expect(fallback.classes()).toContain("cv-origin")
    expect(fallback.attributes("title")).toContain("CV reconstructed")

    wrapper.unmount()
  })

  it("does not render camp availability markers without recorded camp evidence", () => {
    const wrapper = mount(MatchPlaybackMap, {
      props: {
        match,
        participants: [owner],
        frames: [
          frame(30_000, { x: 1_000, y: 1_000 }),
          frame(120_000, { x: 7_000, y: 7_000 }),
        ],
        events: [],
        timestamp: 60_000,
        minimapReview: { participants: [], segments: [], campClears: [] },
      },
    })

    expect(wrapper.findAll(".camp-state-marker")).toHaveLength(0)
    wrapper.unmount()
  })
})
