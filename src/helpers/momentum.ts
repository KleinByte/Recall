import type { MatchRow } from "../types/stats"

export interface PerformanceMomentum {
  score: number
  label: "Lock the F in" | "Under pressure" | "Ready" | "Steady" | "Building" | "Surging" | "Dialed In" | "Flow State"
  streak: number
  wins: number
  losses: number
  averageGradeScore?: number
  overdriveTier?: "gold" | "emerald" | "diamond" | "master"
  sessionExpiresAt?: number
}

export const MOMENTUM_SESSION_GAP_MS = 30 * 60 * 1000

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

function currentStreak(matches: MatchRow[]) {
  if (!matches.length) return 0
  const won = matches[0].win === 1
  let length = 0
  for (const match of matches) {
    if ((match.win === 1) !== won) break
    length += 1
  }
  return won ? length : -length
}

function currentSession(matches: MatchRow[], now: number) {
  if (!matches.length) return { matches: [] as MatchRow[] }
  const latest = matches[0]
  const latestPlayedAt = Number(latest.playedAt)
  const latestDuration = Number(latest.durationSecs)
  const hasTiming = Number.isFinite(latestPlayedAt) && latestPlayedAt > 0
  const latestEnd = hasTiming
    ? latestPlayedAt + (Number.isFinite(latestDuration) ? latestDuration : 0) * 1000
    : undefined

  // Partial rows used by callers/tests have no timing. Preserve the historical
  // behavior for those rows; production match rows always carry playedAt.
  if (latestEnd !== undefined && now >= latestEnd + MOMENTUM_SESSION_GAP_MS) {
    return { matches: [] as MatchRow[] }
  }

  const sessionMatches = [latest]
  for (let index = 1; index < matches.length; index += 1) {
    const newer = matches[index - 1]
    const older = matches[index]
    const newerStart = Number(newer.playedAt)
    const olderStart = Number(older.playedAt)
    const olderDuration = Number(older.durationSecs)
    if (
      Number.isFinite(newerStart) && newerStart > 0 &&
      Number.isFinite(olderStart) && olderStart > 0
    ) {
      const olderEnd = olderStart + (Number.isFinite(olderDuration) ? olderDuration : 0) * 1000
      if (newerStart - olderEnd >= MOMENTUM_SESSION_GAP_MS) break
    }
    sessionMatches.push(older)
  }

  return {
    matches: sessionMatches,
    sessionExpiresAt: latestEnd === undefined
      ? undefined
      : latestEnd + MOMENTUM_SESSION_GAP_MS,
  }
}

function tierFor(streak: number): PerformanceMomentum["overdriveTier"] {
  if (streak >= 6) return "master"
  if (streak === 5) return "diamond"
  if (streak === 4) return "emerald"
  if (streak === 3) return "gold"
  return undefined
}

function labelFor(score: number, streak: number): PerformanceMomentum["label"] {
  if (score >= 100) return streak >= 5 ? "Flow State" : "Dialed In"
  if (score >= 80) return "Surging"
  if (score >= 60) return "Building"
  if (score >= 40) return "Steady"
  if (score >= 20) return "Under pressure"
  return "Lock the F in"
}

/**
 * A short-horizon meter: grades carry most of the signal, while weighted
 * results and the live streak add context. Three straight wins paired with
 * S+ performance reaches the 100-point redline by design.
 */
export function performanceMomentum(source: MatchRow[], now = Date.now()): PerformanceMomentum {
  const recentMatches = source.slice(0, 10)
  if (!recentMatches.length) {
    return { score: 50, label: "Ready", streak: 0, wins: 0, losses: 0 }
  }

  const session = currentSession(recentMatches, now)
  if (!session.matches.length) {
    return {
      score: 50,
      label: "Ready",
      streak: 0,
      wins: 0,
      losses: 0,
    }
  }

  // The Dial describes the current session, not a blended ten-game history.
  // Exponential recency makes the newest result decisive while still letting a
  // sustained run build into Overdrive.
  const matches = session.matches.slice(0, 8)

  let resultTotal = 0
  let resultWeight = 0
  let gradeTotal = 0
  let gradeWeight = 0
  for (const [index, match] of matches.entries()) {
    const weight = .55 ** index
    resultTotal += (match.win === 1 ? 1 : -1) * weight
    resultWeight += weight
    if (typeof match.gradeScore === "number" && Number.isFinite(match.gradeScore)) {
      gradeTotal += clamp(match.gradeScore / 1.2, -1, 1) * weight
      gradeWeight += weight
    }
  }

  const outcomeSignal = resultTotal / resultWeight
  const gradeSignal = gradeWeight > 0 ? gradeTotal / gradeWeight : 0
  const wins = matches.filter((match) => match.win === 1).length
  const streak = currentStreak(matches)
  const streakSignal = clamp(streak / 3, -1, 1)
  const extendedStreak = streak >= 4
    ? Math.min(8, (streak - 3) * 4)
    : streak <= -4
      ? -Math.min(8, (Math.abs(streak) - 3) * 4)
      : 0
  const calculatedScore = Math.round(clamp(
    50 + gradeSignal * 26 + outcomeSignal * 16 + streakSignal * 18 + extendedStreak,
    0,
    100,
  ))
  // A perfect meter is reserved for an active three-win session streak. This
  // prevents yesterday's great form from reopening in Overdrive on startup.
  const score = streak >= 3 ? calculatedScore : Math.min(99, calculatedScore)
  const overdriveTier = score >= 100 ? tierFor(streak) : undefined
  const graded = matches.filter((match) =>
    typeof match.gradeScore === "number" && Number.isFinite(match.gradeScore))
  const averageGradeScore = graded.length
    ? graded.reduce((sum, match) => sum + match.gradeScore!, 0) / graded.length
    : undefined
  return {
    score,
    label: labelFor(score, streak),
    streak,
    wins,
    losses: matches.length - wins,
    averageGradeScore,
    overdriveTier,
    sessionExpiresAt: session.sessionExpiresAt,
  }
}
