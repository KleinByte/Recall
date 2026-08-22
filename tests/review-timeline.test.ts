import { computed, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import { useReviewTimeline } from "../src/features/review/use-review-timeline"
import type { GameAssetCatalog } from "../src/helpers/game-assets"
import type { MatchReview, TimelineEvent, TimelineFrame } from "../src/types/review"
import type { ParticipantRow } from "../src/types/stats"

const owner = {
  participantId: 1,
  teamId: 100,
  isPlayer: 1,
  championId: 22,
  summonerName: "Owner#NA1",
} as ParticipantRow

const enemy = {
  participantId: 6,
  teamId: 200,
  isPlayer: 0,
  championId: 67,
  summonerName: "Enemy#NA1",
} as ParticipantRow

function frame(timestamp: number, blueGold: number, redGold: number): TimelineFrame {
  return {
    timestamp,
    blueGold,
    redGold,
    ownerGold: blueGold / 5,
    ownerLevel: 1,
    ownerXp: 0,
    ownerCs: 0,
    participants: [],
  }
}

const events: TimelineEvent[] = [
  {
    eventId: "kill-owner",
    timestamp: 30_000,
    type: "CHAMPION_KILL",
    category: "kill",
    participantId: 6,
    targetId: 1,
    teamId: 200,
  },
  {
    eventId: "owner-item",
    timestamp: 45_000,
    type: "ITEM_PURCHASED",
    category: "item",
    participantId: 1,
    itemId: 3006,
  },
  {
    eventId: "owner-level",
    timestamp: 60_000,
    type: "LEVEL_UP",
    category: "level",
    participantId: 1,
    level: 6,
    approximate: true,
  },
  {
    eventId: "enemy-level",
    timestamp: 61_000,
    type: "LEVEL_UP",
    category: "level",
    participantId: 6,
    level: 6,
  },
  {
    eventId: "baron",
    timestamp: 120_000,
    type: "ELITE_MONSTER_KILL",
    category: "objective",
    teamId: 100,
    objective: "BARON_NASHOR",
  },
]

function reviewFixture(): MatchReview {
  return {
    match: { gameId: 42 },
    scoreboard: [owner, enemy],
    teams: [],
    records: [],
    labels: [],
    highlights: [],
    annotation: {
      gameId: 42,
      note: "",
      bookmarked: false,
      tags: [],
    },
    timeline: {
      status: "ready",
      summary: {
        frames: [frame(0, 2_500, 2_500), frame(120_000, 7_500, 5_000)],
        events,
        turningPoints: [],
      },
    },
  } as MatchReview
}

function timelineController(playbackMaximumTimestamp = 0) {
  const review = ref<MatchReview | undefined>(reviewFixture())
  const assets = ref<GameAssetCatalog>({
    version: "14.1.1",
    items: { 3006: { name: "Berserker's Greaves", icon: "boots.png" } },
    augments: {},
    abilities: {},
  })
  const selectedOwner = computed(() =>
    review.value?.scoreboard.find((participant) => participant.isPlayer === 1),
  )
  return useReviewTimeline({
    review,
    owner: selectedOwner,
    assets,
    playbackMaximumTimestamp: computed(() => playbackMaximumTimestamp),
  })
}

describe("useReviewTimeline", () => {
  it("derives filters, tracks, labels, and gold geometry from one review", () => {
    const timeline = timelineController()

    expect(timeline.timelineDomain.value).toMatchObject({
      maximumTimestamp: 120_000,
      maximumDifference: 3_000,
    })
    expect(timeline.timelineDifferencePoints.value.split(" ")).toHaveLength(2)
    expect(timeline.filteredTimelineEvents.value.map((event) => event.eventId)).toEqual([
      "kill-owner",
      "owner-item",
      "owner-level",
      "baron",
    ])
    expect(timeline.timelineEventTracks.value.map((track) => track.label)).toEqual([
      "Deaths",
      "Levels",
      "Items",
      "Objectives",
    ])
    expect(timeline.timelineFilterAvailable("vision")).toBe(false)
    expect(timeline.timelineFilterTitle("vision")).toBe(
      "The League Client did not include vision events for this match.",
    )
    expect(timeline.missingTimelineCategories.value).toEqual(["vision"])
    expect(timeline.hasApproximateLevels.value).toBe(true)
    expect(timeline.timelineMarkerTitle(events[0])).toBe("0:30 · Owner#NA1 died to Enemy#NA1")
    expect(timeline.itemName(events[1])).toBe("Berserker's Greaves")
    expect(timeline.timelineEventDescription(events[2])).toBe("reached level 6 by this snapshot")

    timeline.timelineFilter.value = "you"
    expect(timeline.filteredTimelineEvents.value.map((event) => event.eventId)).toEqual([
      "kill-owner",
      "owner-item",
      "owner-level",
    ])
  })

  it("clamps keyboard selection and translates pointer scrubs into timestamps", () => {
    const timeline = timelineController()

    timeline.selectTimelineTimestamp(999_999)
    expect(timeline.timelineCursorTimestamp.value).toBe(120_000)
    expect(timeline.timelineCursor.value).toMatchObject({
      timestamp: 120_000,
      blueGold: 7_500,
      redGold: 5_000,
      difference: 2_500,
      redKills: 1,
    })
    timeline.moveTimelineCursor(-1)
    expect(timeline.timelineCursorTimestamp.value).toBe(60_000)

    const target = {
      getBoundingClientRect: () => ({ left: 20, width: 200 }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement
    timeline.beginTimelineScrub({
      currentTarget: target,
      clientX: 70,
      pointerId: 9,
    } as unknown as PointerEvent)
    expect(timeline.timelineScrubbing.value).toBe(true)
    expect(timeline.timelineCursorTimestamp.value).toBe(30_000)
    expect(target.setPointerCapture).toHaveBeenCalledWith(9)

    timeline.endTimelineScrub({
      currentTarget: target,
      clientX: 220,
      pointerId: 9,
    } as unknown as PointerEvent)
    expect(timeline.timelineScrubbing.value).toBe(false)
    expect(timeline.timelineCursorTimestamp.value).toBe(120_000)
    expect(target.releasePointerCapture).toHaveBeenCalledWith(9)

    timeline.timelineFilter.value = "objectives"
    timeline.timelineMapView.value = "playback"
    timeline.resetTimelineView()
    expect(timeline.timelineFilter.value).toBe("all")
    expect(timeline.timelineMapView.value).toBe("deaths")
    expect(timeline.timelineCursorTimestamp.value).toBe(0)
  })

  it("extends selection and chart geometry to the shared CV playback clock", () => {
    const timeline = timelineController(180_000)

    expect(timeline.timelineDomain.value.maximumTimestamp).toBe(180_000)
    timeline.selectTimelineTimestamp(150_000)
    expect(timeline.timelineCursorTimestamp.value).toBe(150_000)
    expect(timeline.timelineCursor.value?.x).toBeCloseTo(82)
  })
})
