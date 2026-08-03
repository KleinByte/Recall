import type { TimelineEvent, TimelineFrame, TimelineSummary } from "../types/review"

export interface ReviewWinProbabilityPoint {
  timestamp: number
  blue: number
  red: number
  goldDifference: number
  killDifference: number
  objectiveDifference: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

function objectiveWeight(event: TimelineEvent) {
  if (event.category !== "objective") return 0
  const name = `${event.objective ?? ""} ${event.type}`.toUpperCase()
  if (name.includes("BARON")) return 2.5
  if (name.includes("INHIBITOR")) return 1.5
  if (name.includes("DRAGON")) return 1.2
  if (name.includes("TOWER")) return 1
  if (name.includes("HERALD")) return .8
  if (name.includes("HORDE") || name.includes("GRUB")) return .45
  return 0
}

/**
 * A retrospective, timestamp-safe estimate. Each point only sees events that
 * have completed by that frame; the recorded winner is deliberately ignored.
 */
export function reviewWinProbability(summary: TimelineSummary) {
  const events = [...summary.events].sort((left, right) =>
    left.timestamp - right.timestamp || left.eventId.localeCompare(right.eventId),
  )
  let cursor = 0
  let blueKills = 0
  let redKills = 0
  let blueObjectives = 0
  let redObjectives = 0

  return [...summary.frames]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((frame) => {
      while (events[cursor] && events[cursor].timestamp <= frame.timestamp) {
        const event = events[cursor]
        if (event.type === "CHAMPION_KILL") {
          if (event.teamId === 100) blueKills += 1
          if (event.teamId === 200) redKills += 1
        }
        const weight = objectiveWeight(event)
        if (event.teamId === 100) blueObjectives += weight
        if (event.teamId === 200) redObjectives += weight
        cursor += 1
      }

      return probabilityAt(
        frame,
        blueKills - redKills,
        blueObjectives - redObjectives,
      )
    })
}

function probabilityAt(
  frame: TimelineFrame,
  killDifference: number,
  objectiveDifference: number,
): ReviewWinProbabilityPoint {
  const goldDifference = frame.blueGold - frame.redGold
  const averageGold = (frame.blueGold + frame.redGold) / 2
  const goldScale = Math.max(2_200, averageGold * .14)
  const signal =
    goldDifference / goldScale +
    killDifference * .12 +
    objectiveDifference * .22
  const raw = 1 / (1 + Math.exp(-signal))
  const maturity = .35 + .65 * clamp((frame.timestamp / 1_000 - 120) / 1_500, 0, 1)
  const blue = clamp(Math.round((.5 + (raw - .5) * maturity) * 100), 8, 92)
  return {
    timestamp: frame.timestamp,
    blue,
    red: 100 - blue,
    goldDifference,
    killDifference,
    objectiveDifference,
  }
}

export function winProbabilityLabel(percent: number) {
  if (percent >= 68) return "Strongly favored"
  if (percent >= 56) return "Favored"
  if (percent >= 45) return "Even"
  if (percent >= 32) return "Under pressure"
  return "Long shot"
}
