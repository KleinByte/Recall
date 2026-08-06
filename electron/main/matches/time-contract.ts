import {
  MAX_ANALYTIC_MATCH_DURATION_SECS,
  durationBucketFor,
  type DurationBucketMode,
} from "../../../src/helpers/time-contract-core.js"

export { MAX_ANALYTIC_MATCH_DURATION_SECS, durationBucketFor }

export type DurationQuality =
  | "verified"
  | "source_reported"
  | "legacy"
  | "inconsistent"
  | "invalid"

export interface NormalizedTime {
  playedAt: number | null
  serverEndAt: number | null
  durationSeconds: number | null
  durationQuality: DurationQuality
  reason?: string
}

export type TimeNormalizationInput =
  | {
      source: "league_client"
      artifactKind: "history_summary" | "scoreboard_detail"
      mapperVersion: 2
      gameCreation?: unknown
      selectedStartMs?: unknown
      gameDuration: unknown
      asOfMs: number
    }
  | {
      source: "match_v5"
      artifactKind: "match_detail"
      mapperVersion: 2
      info: Record<string, unknown>
      participantTimePlayed?: readonly unknown[]
      asOfMs: number
    }
  | {
      source: "legacy"
      artifactKind: "normalized_row"
      schemaVersion: number
      playedAt: unknown
      durationSecs: unknown
      asOfMs: number
    }
  | {
      source: string
      artifactKind: string
      mapperVersion?: number
      asOfMs: number
      [key: string]: unknown
    }

const EARLIEST_EPOCH_MS = Date.UTC(2010, 0, 1)
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

export function isPlausibleEpochMs(value: unknown, asOfMs: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= EARLIEST_EPOCH_MS &&
    (value as number) <= asOfMs + FUTURE_TOLERANCE_MS
}

function sourceSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  const normalized = Math.trunc(value)
  return normalized > 0 && normalized <= MAX_ANALYTIC_MATCH_DURATION_SECS
    ? normalized
    : null
}

function sourceMilliseconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  const normalized = Math.trunc(value / 1000)
  return normalized > 0 && normalized <= MAX_ANALYTIC_MATCH_DURATION_SECS
    ? normalized
    : null
}

function derivedEndIsPlausible(start: number, duration: number, asOfMs: number) {
  const end = start + duration * 1000
  return Number.isSafeInteger(end) && end <= asOfMs + FUTURE_TOLERANCE_MS
}

export function normalizeSourceTime(input: TimeNormalizationInput): NormalizedTime {
  if (input.source === "league_client" && input.mapperVersion === 2 &&
      (input.artifactKind === "history_summary" || input.artifactKind === "scoreboard_detail")) {
    const rawStart = input.artifactKind === "history_summary"
      ? input.gameCreation
      : input.selectedStartMs
    const playedAt = isPlausibleEpochMs(rawStart, input.asOfMs) ? rawStart : null
    const duration = sourceSeconds(input.gameDuration)
    if (duration === null || playedAt === null ||
        !derivedEndIsPlausible(playedAt, duration, input.asOfMs)) {
      return { playedAt, serverEndAt: null, durationSeconds: null, durationQuality: "invalid" }
    }
    return {
      playedAt,
      serverEndAt: null,
      durationSeconds: duration,
      durationQuality: "source_reported",
    }
  }

  if (input.source === "match_v5" && input.mapperVersion === 2 &&
      input.artifactKind === "match_detail") {
    const info = input.info as Record<string, unknown>
    const playedAt = isPlausibleEpochMs(info.gameStartTimestamp, input.asOfMs)
      ? info.gameStartTimestamp
      : null
    const modern = Object.prototype.hasOwnProperty.call(info, "gameEndTimestamp")
    const serverEndAt = modern && isPlausibleEpochMs(info.gameEndTimestamp, input.asOfMs)
      ? info.gameEndTimestamp
      : null
    const duration = modern
      ? sourceSeconds(info.gameDuration)
      : sourceMilliseconds(info.gameDuration)
    if (playedAt === null || duration === null || (modern && (
      serverEndAt === null || serverEndAt <= playedAt
    )) || !derivedEndIsPlausible(playedAt ?? 0, duration ?? 0, input.asOfMs)) {
      return { playedAt, serverEndAt, durationSeconds: null, durationQuality: "invalid" }
    }

    const participantTimes = input.participantTimePlayed
    const completeTimes = Array.isArray(participantTimes) && participantTimes.length > 0 &&
      participantTimes.every((value: unknown) =>
        typeof value === "number" && Number.isFinite(value) && value > 0)
    if (completeTimes) {
      const maximum = Math.max(...participantTimes.map((value: unknown) => Math.trunc(value as number)))
      if (Math.abs(duration - maximum) > 2) {
        return {
          playedAt,
          serverEndAt,
          durationSeconds: null,
          durationQuality: "inconsistent",
          reason: "participant_time_played_mismatch",
        }
      }
      return { playedAt, serverEndAt, durationSeconds: duration, durationQuality: "verified" }
    }
    return { playedAt, serverEndAt, durationSeconds: duration, durationQuality: "source_reported" }
  }

  if (input.source === "legacy" && input.artifactKind === "normalized_row" &&
      typeof input.schemaVersion === "number" && input.schemaVersion <= 19) {
    const playedAt = isPlausibleEpochMs(input.playedAt, input.asOfMs) ? input.playedAt : null
    const duration = Number.isSafeInteger(input.durationSecs) && (input.durationSecs as number) > 0 &&
      (input.durationSecs as number) <= MAX_ANALYTIC_MATCH_DURATION_SECS
      ? input.durationSecs as number
      : null
    if (playedAt === null || duration === null ||
        !derivedEndIsPlausible(playedAt, duration, input.asOfMs)) {
      return { playedAt, serverEndAt: null, durationSeconds: null, durationQuality: "invalid" }
    }
    return { playedAt, serverEndAt: null, durationSeconds: duration, durationQuality: "legacy" }
  }

  return {
    playedAt: null,
    serverEndAt: null,
    durationSeconds: null,
    durationQuality: "invalid",
    reason: "unregistered_time_contract",
  }
}

export function reconcileLcuDurations(
  summary: NormalizedTime,
  detail: NormalizedTime,
): NormalizedTime {
  const start = summary.playedAt ?? detail.playedAt
  const left = summary.durationSeconds
  const right = detail.durationSeconds
  if (left !== null && right !== null) {
    if (Math.abs(left - right) > 2) {
      return {
        playedAt: start,
        serverEndAt: null,
        durationSeconds: null,
        durationQuality: "inconsistent",
        reason: "lcu_duration_conflict",
      }
    }
    return { playedAt: start, serverEndAt: null, durationSeconds: left, durationQuality: "verified" }
  }
  const duration = left ?? right
  return duration === null
    ? { playedAt: start, serverEndAt: null, durationSeconds: null, durationQuality: "invalid" }
    : { playedAt: start, serverEndAt: null, durationSeconds: duration, durationQuality: "source_reported" }
}

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false
  try {
    return Boolean(new Intl.DateTimeFormat("en-US", { timeZone: value })
      .resolvedOptions().timeZone)
  } catch {
    return false
  }
}

export function resolveDisplayTimezone(
  stored?: unknown,
  systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  if (isValidIanaTimezone(stored)) return stored
  return isValidIanaTimezone(systemTimezone) ? systemTimezone : "UTC"
}

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

function localParts(epochMs: number, timeZone: string): LocalParts {
  if (!isValidIanaTimezone(timeZone)) throw new Error("invalid_iana_timezone")
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epochMs)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour"), minute: get("minute"), second: get("second"),
    millisecond: ((epochMs % 1000) + 1000) % 1000,
  }
}

function naiveEpoch(parts: LocalParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour,
    parts.minute, parts.second, parts.millisecond)
}

function sameLocal(left: LocalParts, right: LocalParts) {
  return naiveEpoch(left) === naiveEpoch(right)
}

/** Intl-only implementation of Temporal's compatible local-time resolution. */
function localToEpochCompatible(target: LocalParts, timeZone: string): number {
  const naive = naiveEpoch(target)
  const offsets = new Set<number>()
  for (let delta = -36 * 60; delta <= 36 * 60; delta += 30) {
    const sample = naive + delta * 60_000
    const shown = localParts(sample, timeZone)
    offsets.add(naiveEpoch(shown) - sample)
  }
  const candidates = [...offsets].map((offset) => naive - offset)
  const exact = candidates.filter((candidate) => sameLocal(localParts(candidate, timeZone), target))
  if (exact.length) return Math.min(...exact)

  const compatible = candidates.map((candidate) => ({
    candidate,
    wallDelta: naiveEpoch(localParts(candidate, timeZone)) - naive,
  })).filter(({ wallDelta }) => wallDelta >= 0)
    .sort((left, right) => left.wallDelta - right.wallDelta || left.candidate - right.candidate)[0]
  if (!compatible) throw new Error("timezone_round_trip_failed")
  return compatible.candidate
}

export function calendarDayKey(epochMs: number, timeZone: string): string {
  const value = localParts(epochMs, timeZone)
  return `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}-${value.day.toString().padStart(2, "0")}`
}

export function subtractCalendarDays(epochMs: number, days: number, timeZone: string): number {
  if (!Number.isSafeInteger(epochMs) || !Number.isSafeInteger(days) || days < 0) {
    throw new Error("invalid_calendar_boundary")
  }
  const source = localParts(epochMs, timeZone)
  const shifted = new Date(Date.UTC(
    source.year, source.month - 1, source.day - days,
    source.hour, source.minute, source.second, source.millisecond,
  ))
  return localToEpochCompatible({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  }, timeZone)
}

export function calendarWindowBoundary(
  asOfMs: number,
  days: 90 | 365,
  timeZone: string,
) {
  return { fromMs: subtractCalendarDays(asOfMs, days, timeZone), throughMs: asOfMs, timeZone }
}

export function durationBucket(mode: DurationBucketMode, seconds: number) {
  return durationBucketFor(mode, seconds)
}
