import { computed, ref, type ComputedRef, type Ref } from "vue"
import { championIconUrl } from "../../helpers/format"
import {
  itemIconUrl,
  timelineObjectiveIconUrl,
  type GameAssetCatalog,
} from "../../helpers/game-assets"
import {
  sampleTimelineEvents,
  timelineChartDomain,
  timelineChartX,
  timelineChartY,
  timelineGoldDifferencePoints,
  timelineTeamGoldAt,
} from "../../helpers/timeline-chart"
import type { MatchReview, TimelineEvent } from "../../types/review"
import type { ParticipantRow } from "../../types/stats"

type TimelineMapView = "deaths" | "playback"
type TimelineFilter = "all" | "you" | "kills" | "objectives" | "items" | "levels" | "vision"

interface ReviewTimelineOptions {
  review: Ref<MatchReview | undefined>
  owner: ComputedRef<ParticipantRow | undefined>
  assets: Ref<GameAssetCatalog>
}

const timelineTrackMeta = [
  { id: "kill", label: "Deaths", maximum: 60 },
  { id: "level", label: "Levels", maximum: 36 },
  { id: "item", label: "Items", maximum: 42 },
  { id: "objective", label: "Objectives", maximum: 30 },
  { id: "vision", label: "Vision", maximum: 30 },
  { id: "game", label: "Match", maximum: 10 },
] as const

/**
 * Owns the timeline's presentation state, geometry, event labels, and pointer
 * controller. Match loading remains in useReviewPageData so this module stays
 * synchronous and deterministic for a supplied review.
 */
export function useReviewTimeline({ review, owner, assets }: ReviewTimelineOptions) {
  const timelineMapView = ref<TimelineMapView>("deaths")
  const timelineFilter = ref<TimelineFilter>("all")
  const timelineFilters = ["all", "you", "kills", "objectives", "items", "levels", "vision"] as const
  const timelineCursorTimestamp = ref(0)
  const timelineScrubbing = ref(false)
  const timelineMapViewOptions = [
    { value: "deaths", label: "Deaths" },
    { value: "playback", label: "Playback" },
  ]

  const timelineDomain = computed(() => {
    const summary = review.value?.timeline.summary
    return timelineChartDomain(summary?.frames ?? [], summary?.events ?? [])
  })
  const timelineDifferencePoints = computed(() => {
    const frames = review.value?.timeline.summary?.frames ?? []
    if (frames.length < 2) return ""
    return timelineGoldDifferencePoints(frames, timelineDomain.value)
  })
  const finalTimelineFrame = computed(() => review.value?.timeline.summary?.frames.at(-1))
  const finalGoldDifference = computed(() =>
    (finalTimelineFrame.value?.blueGold ?? 0) - (finalTimelineFrame.value?.redGold ?? 0),
  )
  const timelineGoldTicks = computed(() => [
    timelineDomain.value.maximumDifference,
    timelineDomain.value.maximumDifference / 2,
    0,
    -timelineDomain.value.maximumDifference / 2,
    -timelineDomain.value.maximumDifference,
  ].map((gold) => ({ gold, y: timelineChartY(gold, timelineDomain.value) })))
  const compactGold = (gold: number) => `${(gold / 1_000).toFixed(gold >= 10_000 ? 0 : 1)}k`
  const signedCompactGold = (gold: number) => gold === 0
    ? "0"
    : `${gold > 0 ? "+" : "−"}${compactGold(Math.abs(gold))}`

  const filteredTimelineEvents = computed(() => {
    const events = review.value?.timeline.summary?.events ?? []
    if (timelineFilter.value === "all") {
      return events.filter((event) =>
        event.category !== "level" || event.participantId === owner.value?.participantId,
      )
    }
    if (timelineFilter.value === "you") {
      return events.filter((event) =>
        event.participantId === owner.value?.participantId ||
        event.targetId === owner.value?.participantId ||
        event.assistingParticipantIds?.includes(owner.value?.participantId ?? -1),
      )
    }
    if (timelineFilter.value === "kills") {
      return events.filter((event) => event.category === "kill")
    }
    if (timelineFilter.value === "objectives") {
      return events.filter((event) =>
        event.category === "objective",
      )
    }
    if (timelineFilter.value === "items") return events.filter((event) => event.category === "item")
    if (timelineFilter.value === "levels") return events.filter((event) => event.category === "level")
    return events.filter((event) => event.category === "vision")
  })

  const timelineTrackSource = computed(() => {
    const summary = review.value?.timeline.summary
    if (!summary) return []
    if (timelineFilter.value !== "all") return filteredTimelineEvents.value
    const ownerId = owner.value?.participantId
    return summary.events.filter((event) =>
      event.category === "kill" ||
      event.category === "objective" ||
      event.category === "game" ||
      (event.category === "level" && event.participantId === ownerId) ||
      (
        event.category === "item" &&
        event.participantId === ownerId &&
        [
          "ITEM_PURCHASED",
          "ITEM_TRANSFORM",
          "ITEM_TRANSFORMED",
          "ITEM_ACQUIRED",
          "ITEM_OBSERVED",
        ].includes(event.type)
      ),
    )
  })

  const timelineEventTracks = computed(() => timelineTrackMeta.flatMap((track) => {
    const events = timelineTrackSource.value.filter((event) => event.category === track.id)
    if (events.length === 0) return []
    const laneByBucket = new Map<number, number>()
    const markers = sampleTimelineEvents(events, track.maximum).map((event) => {
      const x = timelineChartX(event.timestamp, timelineDomain.value)
      const bucket = Math.round(x / 3)
      const lane = laneByBucket.get(bucket) ?? 0
      laneByBucket.set(bucket, lane + 1)
      return { event, x, top: [21, 10, 32][lane % 3] }
    })
    return [{ ...track, markers }]
  }))
  const timelineEventCounts = computed(() => {
    const counts = { kills: 0, objectives: 0, items: 0, levels: 0, vision: 0 }
    for (const event of review.value?.timeline.summary?.events ?? []) {
      if (event.category === "kill") counts.kills += 1
      if (event.category === "objective") counts.objectives += 1
      if (event.category === "item") counts.items += 1
      if (event.category === "level") counts.levels += 1
      if (event.category === "vision") counts.vision += 1
    }
    return counts
  })
  const missingTimelineCategories = computed(() => [
    timelineEventCounts.value.items === 0 ? "item" : undefined,
    timelineEventCounts.value.vision === 0 ? "vision" : undefined,
  ].filter((category): category is string => Boolean(category)))
  const hasApproximateLevels = computed(() =>
    review.value?.timeline.summary?.events.some((event) =>
      event.category === "level" && event.approximate,
    ) ?? false,
  )

  function timelineFilterAvailable(filter: typeof timelineFilters[number]) {
    if (filter === "all" || filter === "you") return true
    return timelineEventCounts.value[filter] > 0
  }

  function timelineFilterTitle(filter: typeof timelineFilters[number]) {
    return timelineFilterAvailable(filter)
      ? `${timelineEventCounts.value[filter as keyof typeof timelineEventCounts.value] ?? ""} ${filter} events`.trim()
      : `The League Client did not include ${filter} events for this match.`
  }

  function participant(participantId?: number) {
    return review.value?.scoreboard.find((entry) => entry.participantId === participantId)
  }

  function participantByName(name?: string) {
    const normalized = name?.trim().toLocaleLowerCase()
    if (!normalized) return undefined
    return review.value?.scoreboard.find((entry) => {
      const candidate = entry.summonerName?.trim().toLocaleLowerCase()
      return candidate === normalized || candidate?.split("#")[0] === normalized.split("#")[0]
    })
  }

  function killActor(event: TimelineEvent) {
    return participant(event.participantId) ?? participantByName(event.actorName)
  }

  const killTarget = (event: TimelineEvent) => participant(event.targetId) ?? participantByName(event.targetName)
  const killActorName = (event: TimelineEvent) => killActor(event)?.summonerName ?? event.actorName ?? "Unknown killer"
  const killTargetName = (event: TimelineEvent) => killTarget(event)?.summonerName ?? event.targetName ?? `Player ${event.targetId ?? "unknown"}`

  function eventTime(timestamp: number) {
    return `${Math.floor(timestamp / 60_000)}:${String(Math.floor(timestamp / 1_000) % 60).padStart(2, "0")}`
  }

  function objectiveName(value?: string) {
    return (value ?? "Objective").replaceAll("_", " ").toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  }

  function itemId(event: TimelineEvent) {
    return event.itemId ?? event.afterId ?? event.beforeId
  }

  function itemName(event: TimelineEvent) {
    const id = itemId(event)
    return assets.value.items[id ?? 0]?.name ?? `Item ${id ?? "unknown"}`
  }

  function itemIcon(event: TimelineEvent) {
    const id = itemId(event)
    return assets.value.items[id ?? 0]?.icon ?? itemIconUrl(id, assets.value.version)
  }

  function abilityAsset(event: TimelineEvent) {
    if (event.type !== "SKILL_LEVEL_UP" || !event.skillSlot) return undefined
    const championId = participant(event.participantId)?.championId
    return championId ? assets.value.abilities[championId]?.[event.skillSlot - 1] : undefined
  }

  function abilityKey(skillSlot?: number) {
    return skillSlot && skillSlot >= 1 && skillSlot <= 4
      ? ["Q", "W", "E", "R"][skillSlot - 1]
      : "ability"
  }

  function timelineMarkerIcon(event: TimelineEvent) {
    if (event.category === "kill") {
      return championIconUrl(killTarget(event)?.championId || 0)
    }
    if (event.category === "item") return itemIcon(event)
    if (event.type === "SKILL_LEVEL_UP") return abilityAsset(event)?.icon
    if (event.category === "objective") {
      return timelineObjectiveIconUrl(event.type, event.objective, event.teamId)
    }
    return undefined
  }

  function timelineMarkerGlyph(event: TimelineEvent) {
    if (event.category === "objective") return "◆"
    if (event.type === "LEVEL_UP") return `${event.approximate ? "≈" : ""}${event.level ?? "↑"}`
    if (event.type === "SKILL_LEVEL_UP") return abilityKey(event.skillSlot).toUpperCase()
    if (event.category === "level") return "↑"
    if (event.category === "vision") return "◉"
    if (event.category === "game") return "■"
    return "•"
  }

  function timelineMarkerClasses(event: TimelineEvent) {
    const victim = event.category === "kill" ? killTarget(event) : undefined
    return [
      event.category,
      victim?.teamId === 100 ? "blue-team" : victim?.teamId === 200 ? "red-team" : undefined,
      event.targetId === owner.value?.participantId || event.participantId === owner.value?.participantId
        ? "owner-event"
        : undefined,
    ]
  }

  function timelineMarkerTitle(event: TimelineEvent) {
    const time = `${event.approximate ? "≈" : ""}${eventTime(event.timestamp)}`
    if (event.category === "kill") {
      const killer = killActorName(event)
      return `${time} · ${killTargetName(event)} died to ${killer}`
    }
    if (event.category === "item") {
      const player = participant(event.participantId)?.summonerName ?? `Player ${event.participantId}`
      return `${time} · ${player} · ${itemName(event)}`
    }
    if (event.type === "SKILL_LEVEL_UP") {
      const player = participant(event.participantId)?.summonerName ?? `Player ${event.participantId}`
      const ability = abilityAsset(event)?.name ?? abilityKey(event.skillSlot)
      return `${time} · ${player} ranked ${ability} (${abilityKey(event.skillSlot)})`
    }
    if (event.type === "LEVEL_UP") {
      const player = participant(event.participantId)?.summonerName ?? `Player ${event.participantId}`
      return `${time} · ${player} reached level ${event.level ?? "?"}`
    }
    return `${time} · ${objectiveName(event.objective || event.type)}`
  }

  function timelineEventDescription(event: TimelineEvent) {
    if (event.type === "SKILL_LEVEL_UP") {
      return `ranked ${abilityAsset(event)?.name ?? abilityKey(event.skillSlot)} (${abilityKey(event.skillSlot)})`
    }
    if (event.type === "LEVEL_UP") {
      return `reached level ${event.level ?? "?"}${event.approximate ? " by this snapshot" : ""}`
    }
    return objectiveName(event.objective || event.type)
  }

  const timelineCursor = computed(() => {
    const timestamp = timelineCursorTimestamp.value
    const summary = review.value?.timeline.summary
    if (timestamp === undefined || !summary) return undefined
    const blueGold = timelineTeamGoldAt(timestamp, summary.frames, 100)
    const redGold = timelineTeamGoldAt(timestamp, summary.frames, 200)
    const difference = blueGold - redGold
    let blueKills = 0
    let redKills = 0
    for (const event of summary.events) {
      if (event.timestamp > timestamp || event.type !== "CHAMPION_KILL") continue
      const teamId = event.teamId ?? killActor(event)?.teamId
      if (teamId === 100) blueKills += 1
      if (teamId === 200) redKills += 1
    }
    return {
      timestamp,
      x: timelineChartX(timestamp, timelineDomain.value),
      blueGold,
      redGold,
      difference,
      differenceY: timelineChartY(difference, timelineDomain.value),
      blueKills,
      redKills,
    }
  })

  function setTimelineCursor(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    timelineCursorTimestamp.value = ratio * timelineDomain.value.maximumTimestamp
  }

  function beginTimelineScrub(event: PointerEvent) {
    timelineScrubbing.value = true
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    setTimelineCursor(event)
  }

  function updateTimelineScrub(event: PointerEvent) {
    if (timelineScrubbing.value) setTimelineCursor(event)
  }

  function endTimelineScrub(event: PointerEvent) {
    if (!timelineScrubbing.value) return
    setTimelineCursor(event)
    timelineScrubbing.value = false
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }

  function selectTimelineTimestamp(timestamp: number) {
    timelineCursorTimestamp.value = Math.max(
      0,
      Math.min(timelineDomain.value.maximumTimestamp, timestamp),
    )
  }

  function moveTimelineCursor(direction: number) {
    const step = 60_000
    const current = timelineCursorTimestamp.value ?? 0
    timelineCursorTimestamp.value = Math.max(0, Math.min(timelineDomain.value.maximumTimestamp, current + direction * step))
  }

  function resetTimelineView() {
    timelineFilter.value = "all"
    timelineCursorTimestamp.value = 0
    timelineMapView.value = "deaths"
  }

  return {
    timelineMapView,
    timelineFilter,
    timelineFilters,
    timelineCursorTimestamp,
    timelineScrubbing,
    timelineMapViewOptions,
    timelineDomain,
    timelineDifferencePoints,
    finalTimelineFrame,
    finalGoldDifference,
    timelineGoldTicks,
    compactGold,
    signedCompactGold,
    filteredTimelineEvents,
    timelineEventTracks,
    missingTimelineCategories,
    hasApproximateLevels,
    timelineFilterAvailable,
    timelineFilterTitle,
    participant,
    killActor,
    killTarget,
    killActorName,
    killTargetName,
    eventTime,
    itemName,
    itemIcon,
    timelineMarkerIcon,
    timelineMarkerGlyph,
    timelineMarkerClasses,
    timelineMarkerTitle,
    timelineEventDescription,
    timelineCursor,
    beginTimelineScrub,
    updateTimelineScrub,
    endTimelineScrub,
    selectTimelineTimestamp,
    moveTimelineCursor,
    resetTimelineView,
  }
}
