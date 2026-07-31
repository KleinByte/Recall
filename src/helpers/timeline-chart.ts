import type { TimelineEvent, TimelineFrame } from "../types/review"

const X_INSET = 2
const Y_AMPLITUDE = 42

export interface TimelineChartDomain {
  maximumTimestamp: number
  maximumDifference: number
}

export function timelineChartDomain(
  frames: TimelineFrame[],
  events: TimelineEvent[],
): TimelineChartDomain {
  return {
    maximumTimestamp: Math.max(
      1,
      ...frames.map((frame) => frame.timestamp),
      ...events.map((event) => event.timestamp),
    ),
    maximumDifference: Math.max(
      1_000,
      ...frames.map((frame) => Math.abs(frame.blueGold - frame.redGold)),
    ),
  }
}

export function timelineChartX(
  timestamp: number,
  domain: TimelineChartDomain,
): number {
  const progress = Math.max(0, Math.min(1, timestamp / domain.maximumTimestamp))
  return X_INSET + progress * (100 - X_INSET * 2)
}

export function timelineChartY(
  difference: number,
  domain: TimelineChartDomain,
): number {
  return 50 - difference * Y_AMPLITUDE / domain.maximumDifference
}

export function timelineChartPoints(
  frames: TimelineFrame[],
  domain: TimelineChartDomain,
): string {
  return frames
    .map((frame) => {
      const difference = frame.blueGold - frame.redGold
      const x = timelineChartX(frame.timestamp, domain)
      const y = timelineChartY(difference, domain)
      return `${x},${y}`
    })
    .join(" ")
}

export function timelineGoldDifferenceAt(
  timestamp: number,
  frames: TimelineFrame[],
): number {
  if (frames.length === 0) return 0
  const closest = frames.reduce((best, frame) =>
    Math.abs(frame.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
      ? frame
      : best,
  )
  return closest.blueGold - closest.redGold
}

/**
 * Keeps marker density bounded without throwing away the end of busy matches.
 * Taking the first N events made high-action games look as though everything
 * happened in the opening minutes.
 */
export function sampleTimelineEvents(
  events: TimelineEvent[],
  maximum = 90,
): TimelineEvent[] {
  if (maximum <= 0 || events.length === 0) return []
  if (events.length <= maximum) return events
  if (maximum === 1) return [events.at(-1)!]

  return Array.from({ length: maximum }, (_, index) =>
    events[Math.round(index * (events.length - 1) / (maximum - 1))],
  )
}
