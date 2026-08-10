import { describe, expect, it } from "vitest"
import {
  calendarDayKey,
  normalizeSourceTime,
  reconcileLcuDurations,
  subtractCalendarDays,
} from "../electron/main/matches/time-contract.js"
import {
  DURATION_BUCKETS_SECONDS,
  MAX_ANALYTIC_MATCH_DURATION_SECS,
  durationBucketFor,
  groupTimedGames,
} from "../src/helpers/time-contract-core.js"
import {
  evaluateMatchEligibility,
  type MatchEligibilityInput,
} from "../electron/main/matches/eligibility.js"

const asOfMs = Date.UTC(2026, 7, 5, 12)
const start = Date.UTC(2026, 7, 4, 12)

describe("duration buckets", () => {
  it.each([
    ["sr", DURATION_BUCKETS_SECONDS.sr],
    ["classic", DURATION_BUCKETS_SECONDS.classic],
    ["aram", DURATION_BUCKETS_SECONDS.aram],
  ] as const)("uses half-open %s boundaries", (family, buckets) => {
    buckets.forEach(([lower, upper], index) => {
      expect(durationBucketFor(family, lower)?.index).toBe(index)
      if (Number.isFinite(upper)) expect(durationBucketFor(family, upper)?.index).toBe(index + 1)
    })
  })

  it("maps Mayhem to ARAM and omits other", () => {
    expect(durationBucketFor("mayhem", 720)?.index).toBe(1)
    expect(durationBucketFor("other", 720)).toBeUndefined()
  })
})

describe("registered source time normalization", () => {
  it("normalizes LCU seconds and truncates fractions", () => {
    expect(normalizeSourceTime({
      source: "league_client", artifactKind: "history_summary", mapperVersion: 2,
      gameCreation: start, gameDuration: 1800.9, asOfMs,
    })).toMatchObject({ playedAt: start, durationSeconds: 1800, durationQuality: "source_reported" })
  })

  it("selects Match-V5 units by own end property, including null", () => {
    const modern = normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2, asOfMs,
      info: { gameStartTimestamp: start, gameEndTimestamp: null, gameDuration: 90_000 },
    })
    expect(modern).toMatchObject({ durationSeconds: null, durationQuality: "invalid" })

    const legacy = normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2, asOfMs,
      info: { gameStartTimestamp: start, gameDuration: 90_000 },
    })
    expect(legacy).toMatchObject({ durationSeconds: 90, durationQuality: "source_reported" })
    expect(normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2, asOfMs,
      info: { gameStartTimestamp: start, gameDuration: 100_000 },
    }).durationSeconds).toBe(100)
  })

  it("never substitutes gameCreation for Match-V5 start", () => {
    expect(normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2, asOfMs,
      info: { gameCreation: start, gameEndTimestamp: start + 1_800_000, gameDuration: 1800 },
    })).toMatchObject({ playedAt: null, durationSeconds: null, durationQuality: "invalid" })
  })

  it("accepts only declared already-normalized legacy seconds", () => {
    expect(normalizeSourceTime({
      source: "legacy", artifactKind: "normalized_row", schemaVersion: 19,
      playedAt: start, durationSecs: 1800, asOfMs,
    }).durationQuality).toBe("legacy")
    expect(normalizeSourceTime({
      source: "loose", artifactKind: "unknown", mapperVersion: 1,
      value: 90_000, asOfMs,
    })).toMatchObject({ durationSeconds: null, durationQuality: "invalid" })
  })

  it.each([0, Number.NaN, Infinity, 43_201])("rejects invalid seconds %s", (gameDuration) => {
    expect(normalizeSourceTime({
      source: "league_client", artifactKind: "history_summary", mapperVersion: 2,
      gameCreation: start, gameDuration, asOfMs,
    }).durationSeconds).toBeNull()
  })

  it("accepts exactly 43,200 seconds and rejects a future derived play end", () => {
    expect(normalizeSourceTime({
      source: "league_client", artifactKind: "history_summary", mapperVersion: 2,
      gameCreation: start, gameDuration: 43_200, asOfMs,
    }).durationSeconds).toBe(43_200)
    expect(normalizeSourceTime({
      source: "league_client", artifactKind: "history_summary", mapperVersion: 2,
      gameCreation: asOfMs + 23 * 60 * 60_000, gameDuration: 7200, asOfMs,
    }).durationSeconds).toBeNull()
  })

  it("verifies complete participant times and rejects mismatches over two seconds", () => {
    const info = {
      gameStartTimestamp: start,
      gameEndTimestamp: start + 2_000_000,
      gameDuration: 1800,
    }
    expect(normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2,
      info, participantTimePlayed: [1798, 1800], asOfMs,
    }).durationQuality).toBe("verified")
    expect(normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2,
      info, participantTimePlayed: [1797, 1797], asOfMs,
    }).durationQuality).toBe("inconsistent")
    expect(normalizeSourceTime({
      source: "match_v5", artifactKind: "match_detail", mapperVersion: 2,
      info, participantTimePlayed: [1800, null], asOfMs,
    }).durationQuality).toBe("source_reported")
  })

  it("reconciles LCU sources symmetrically", () => {
    const row = (duration: number) => normalizeSourceTime({
      source: "league_client" as const, artifactKind: "history_summary" as const,
      mapperVersion: 2 as const, gameCreation: start, gameDuration: duration, asOfMs,
    })
    expect(reconcileLcuDurations(row(1800), row(1802))).toMatchObject({
      durationSeconds: 1800, durationQuality: "verified",
    })
    expect(reconcileLcuDurations(row(1800), row(1803))).toMatchObject({
      durationSeconds: null, durationQuality: "inconsistent",
    })
  })
})

describe("eligibility", () => {
  const lobby = Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    owner: index === 0,
  }))
  const base: MatchEligibilityInput = {
    provenance: "current_source", normalizedDurationSeconds: 300,
    durationQuality: "source_reported", knownBotTutorial: false, matched: true,
    family: "sr", contextComplete: true, registeredCapability: true,
    eligibleForProgression: true, requiredSourceFactsComplete: true,
    lobby, coreMetricsComplete: true,
  }

  it("uses the exact multi-failure reason precedence", () => {
    expect(evaluateMatchEligibility({
      ...base, normalizedDurationSeconds: null, durationQuality: "invalid",
      knownBotTutorial: true, matched: false,
    }).reason).toBe("invalid_duration")
    expect(evaluateMatchEligibility({ ...base, knownBotTutorial: true, matched: false }).reason)
      .toBe("bot_or_tutorial")
    expect(evaluateMatchEligibility({ ...base, matched: false, family: "other" }).reason)
      .toBe("unmatched")
  })

  it("excludes short, terminated, and non-progression rows but accepts exactly 300", () => {
    expect(evaluateMatchEligibility({ ...base, normalizedDurationSeconds: 299 }).analyticsEligible).toBe(false)
    expect(evaluateMatchEligibility({ ...base, terminated: true }).reason).toBe("terminated")
    expect(evaluateMatchEligibility({ ...base, eligibleForProgression: false }).reason)
      .toBe("ineligible_for_progression")
    expect(evaluateMatchEligibility(base).analyticsEligible).toBe(true)
  })

  it("rejects durations beyond the analytic safety bound", () => {
    expect(evaluateMatchEligibility({
      ...base,
      normalizedDurationSeconds: MAX_ANALYTIC_MATCH_DURATION_SECS,
    }).gradeEligible).toBe(true)
    expect(evaluateMatchEligibility({
      ...base,
      normalizedDurationSeconds: MAX_ANALYTIC_MATCH_DURATION_SECS + 1,
    })).toMatchObject({ reason: "invalid_duration", gradeEligible: false })
  })

  it("distinguishes legacy-compatible absence from current-source absence", () => {
    const missing = {
      ...base,
      requiredSourceFactsComplete: false,
      missingOnlyLegacyCompatibleFacts: true,
    }
    expect(evaluateMatchEligibility({ ...missing, provenance: "legacy" })).toMatchObject({
      reason: "legacy_unknown", analyticsEligible: true, sourceFactsComplete: false,
    })
    expect(evaluateMatchEligibility(missing)).toMatchObject({
      reason: "missing_source_fact", analyticsEligible: false,
    })
  })

  it("uses missing source fact for unknown context and unsupported only for registered modes", () => {
    expect(evaluateMatchEligibility({ ...base, family: "other" }).reason).toBe("unsupported_mode")
    expect(evaluateMatchEligibility({ ...base, family: "unknown", registeredCapability: false }).reason)
      .toBe("missing_source_fact")
  })
})

describe("canonical sessions and calendars", () => {
  it("sorts, clamps overlaps, splits exact boundaries, and honors adjacent overrides", () => {
    const games = [
      { gameId: 3, playedAt: 12_600_000, durationSecs: 1800 },
      { gameId: 1, playedAt: 0, durationSecs: 1800 },
      { gameId: 2, playedAt: 1_700_000, durationSecs: 1800 },
    ]
    const groups = groupTimedGames(games)
    expect(groups[0].matches.map((game) => game.gameId)).toEqual([1, 2])
    expect(groups[1].matches.map((game) => game.gameId)).toEqual([3])
    expect(groupTimedGames(games, undefined, new Map([[3, "join"]]))).toHaveLength(1)
    expect(groupTimedGames(games, undefined, new Map([[2, "split"]]))).toHaveLength(3)
  })

  it("keeps invalid timing as a hard boundary and summarizes overlaps by max end", () => {
    const groups = groupTimedGames([
      { gameId: 1, playedAt: 0, durationSecs: 4000 },
      { gameId: 2, playedAt: 1000, durationSecs: 100 },
      { gameId: 3, playedAt: 2000, durationSecs: null },
      { gameId: 4, playedAt: 3000, durationSecs: 100 },
    ])
    expect(groups.map((group) => group.kind)).toEqual(["analytical", "unanalysable", "analytical"])
    expect(groups[0]).toMatchObject({ endAt: 4_000_000, playTimeMs: 4_100_000 })
  })

  it("requires an IANA zone and preserves local wall time across DST", () => {
    expect(() => calendarDayKey(asOfMs, "Not/A_Zone")).toThrow("invalid_iana_timezone")
    const springAsOf = Date.UTC(2026, 2, 8, 17) // noon Chicago after spring transition
    const springPrior = subtractCalendarDays(springAsOf, 1, "America/Chicago")
    expect(calendarDayKey(springPrior, "America/Chicago")).toBe("2026-03-07")
    expect(springAsOf - springPrior).toBe(23 * 60 * 60_000)
    const boundary = subtractCalendarDays(Date.UTC(2026, 10, 2, 18), 365, "America/Chicago")
    expect(calendarDayKey(boundary, "America/Chicago")).toBe("2025-11-02")
  })
})
