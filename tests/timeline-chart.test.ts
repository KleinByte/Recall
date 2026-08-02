import { describe, expect, it } from "vitest"
import {
  timelineChartDomain,
  timelineChartPoints,
  timelineChartX,
  timelineTeamGoldPoints,
  timelineTeamGoldY,
  sampleTimelineEvents,
} from "../src/helpers/timeline-chart.js"
import type { TimelineEvent, TimelineFrame } from "../src/types/review.js"

const frame = (timestamp: number, difference: number): TimelineFrame => ({
  timestamp,
  blueGold: 10_000 + difference,
  redGold: 10_000,
  ownerGold: 0,
  ownerLevel: 1,
  ownerXp: 0,
  ownerCs: 0,
  participants: [],
})

const event = (timestamp: number): TimelineEvent => ({
  eventId: String(timestamp),
  timestamp,
  type: "GAME_END",
  category: "game",
})

describe("timeline chart geometry", () => {
  it("uses timestamps for both the line and event markers", () => {
    const frames = [frame(0, 0), frame(60_000, 1_000), frame(180_000, 0)]
    const domain = timelineChartDomain(frames, [])
    const points = timelineChartPoints(frames, domain).split(" ")

    expect(Number(points[1].split(",")[0])).toBeCloseTo(
      timelineChartX(60_000, domain),
    )
    expect(Number(points[1].split(",")[0])).toBeCloseTo(34)
  })

  it("plots Blue and Red as independent absolute-gold series", () => {
    const frames = [frame(0, 0), frame(60_000, 1_500)]
    const domain = timelineChartDomain(frames, [])
    const blue = timelineTeamGoldPoints(frames, domain, "blue").split(" ")
    const red = timelineTeamGoldPoints(frames, domain, "red").split(" ")

    expect(blue[0]).toBe(red[0])
    expect(Number(blue[1].split(",")[1])).toBeLessThan(
      Number(red[1].split(",")[1]),
    )
    expect(timelineTeamGoldY(domain.maximumGold, domain)).toBeCloseTo(8)
  })

  it("includes end-of-game events in the time scale", () => {
    const frames = [frame(0, 0), frame(180_000, 0)]
    const domain = timelineChartDomain(frames, [event(240_000)])

    expect(timelineChartX(180_000, domain)).toBeCloseTo(74)
    expect(timelineChartX(240_000, domain)).toBeCloseTo(98)
  })

  it("samples busy matches across the full timeline instead of taking the opening events", () => {
    const events = Array.from({ length: 180 }, (_, index) => event(index * 10_000))
    const sampled = sampleTimelineEvents(events, 18)

    expect(sampled).toHaveLength(18)
    expect(sampled[0].timestamp).toBe(0)
    expect(sampled.at(-1)?.timestamp).toBe(1_790_000)
    expect(sampled.some((entry) => entry.timestamp > 1_000_000)).toBe(true)
  })
})
