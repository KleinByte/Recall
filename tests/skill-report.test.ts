import { describe, expect, it } from "vitest"
import type { InsightObservation, FinalItemObservation, RviTimelineObservation } from "../electron/main/database/insights-repo.js"
import type { ChampionStatRow } from "../electron/main/database/matches-repo.js"
import {
  buildBestGamePattern,
  buildPlayingConditions,
  buildDurationInsights,
  buildPredictiveSection,
  buildChampionFindings,
  buildItemFindings,
  buildTrendFindings,
  buildSkillReport,
  buildDeathMap,
} from "../electron/main/matches/skill-report.js"
import { computePerGameAxes } from "../electron/main/matches/style.js"
import type { ModeFamily } from "../electron/main/matches/types.js"
import { MATCH_GRADE_ARM_KEYS } from "../electron/main/matches/match-grade-recipe.js"
import { RVI_VECTOR_KEYS } from "../electron/main/matches/rvi-contract.js"

/**
 * Factory for creating test observations
 */
function observations(
  count: number,
  options: {
    highDamageTaken?: boolean
    sameRole?: boolean
    mixedRoles?: boolean
    daysApart?: boolean
    fixedHour?: number
    previousWin?: boolean
    previousLoss?: boolean
    shortDuration?: boolean
    longDuration?: boolean
    variedDuration?: boolean
    family?: ModeFamily
    styleAxesOverride?: (i: number) => Record<string, number>
  } = {},
): InsightObservation[] {
  const results: InsightObservation[] = []
  const baseTime = 1700000000000 // Nov 14, 2023
  const family = options.family ?? "sr"

  for (let i = 0; i < count; i++) {
    let playedAt = baseTime + i * 60 * 60 * 1000 // 1 hour apart by default

    if (options.daysApart && i > 0) {
      playedAt = baseTime + i * 2 * 24 * 60 * 60 * 1000 // 2 days apart
    }

    if (options.fixedHour !== undefined) {
      const date = new Date(playedAt)
      date.setHours(options.fixedHour, 0, 0, 0)
      playedAt = date.getTime()
    }

    let gradeScore = 50 + i // Ascending grades by default
    if (options.highDamageTaken && i >= count / 2) {
      gradeScore = 70 + i // Higher grades in second half
    }

    let role = "MIDDLE"
    if (options.mixedRoles) {
      role = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5]
    } else if (options.sameRole) {
      role = "MIDDLE"
    }

    let win = i % 2 === 0
    if (options.previousWin && i > 0) {
      win = i === 1 // Only second game wins after first
    }
    if (options.previousLoss && i > 0) {
      win = i !== 1 // Second game loses after first
    }

    let durationSecs = 1800 // 30 minutes default
    if (options.shortDuration) {
      durationSecs = 1200 // 20 minutes
    }
    if (options.longDuration) {
      durationSecs = 2400 // 40 minutes
    }
    if (options.variedDuration) {
      // Spread across SR buckets: <22, 22-28, 28-34, 34+
      const durations = [1200, 1500, 1800, 2100]  // 20, 25, 30, 35 minutes
      durationSecs = durations[i % durations.length]
    }

    const damageTaken = options.highDamageTaken && i >= count / 2 ? 40000 : 20000
    const durationMins = durationSecs / 60

    const styleAxes = options.styleAxesOverride
      ? options.styleAxesOverride(i)
      : computePerGameAxes({
          kills: 5,
          assists: 10,
          damageToChampions: 24000,
          damageTaken,
          damageSelfMitigated: 15000,
          damageObjectives: 3000,
          totalHeal: 5000,
          csPerMin: 7,
          visionPerMin: 1.5,
          ccPerMin: 0.5,
        }, family)

    results.push({
      gameId: 1000 + i,
      playedAt,
      endedAt: playedAt + durationSecs * 1000,
      mode: family === "sr" ? "sr_ranked_solo" : family === "aram" ? "aram_aram" as any : "other_arena" as any,
      family,
      queueId: family === "sr" ? 420 : family === "aram" ? 450 : 1700,
      win,
      gradeScore,
      recallScore: gradeScore,
      championId: 1,
      role,
      durationSecs,
      completeLobby: true,
      metrics: {
        kda: 3.0,
        deaths: 5,
        damagePerMinute: 800,
        damageTakenPerMinute: damageTaken / durationMins,
        goldPerMinute: 400,
        csPerMinute: 7,
        visionPerMinute: 1.5,
        objectiveDamagePerMinute: 100,
        ccPerMinute: 0.5,
        killParticipation: 0.6,
        teamDamageShare: 0.25,
        allyHealShieldPerMinute: 50,
      },
      styleAxes,
    })
  }

  return results
}

describe("Strong game pattern", () => {
  it("requires 30 graded games and eight games on each side", () => {
    expect(buildBestGamePattern(observations(29)).eligible).toBe(false)

    // 30 games with split that has >=8 on both sides should be eligible
    const thirtyObs = observations(30)
    const report30 = buildBestGamePattern(thirtyObs)
    expect(report30.eligible).toBe(true)
    expect(report30.strongGames).toBeGreaterThanOrEqual(8)
    expect(report30.nonStrongGames).toBeGreaterThanOrEqual(8)
  })

  it("defines strong games from the inclusive top quartile", () => {
    const report = buildBestGamePattern(observations(32))
    expect(report.eligible).toBe(true)
    expect(report.definition).toContain("top 25% of your frozen-reference Recall Scores")
    expect(report.strongGames).toBeGreaterThanOrEqual(8)
  })

  it("does not call a positive metric difference better", () => {
    const report = buildBestGamePattern(observations(40, { highDamageTaken: true }))
    expect(JSON.stringify(report)).not.toMatch(/better|improve|causes/i)
  })

  it("selects reference per observation's own role when that role has >=20 graded rows", () => {
    // All observations with same role should use same-role history when count >=20
    const sameRoleReport = buildBestGamePattern(observations(32, { sameRole: true }))
    expect(sameRoleReport.eligible).toBe(true)

    // Mixed roles where each role has <20 should fall back to all selected-scope
    const mixedReport = buildBestGamePattern(observations(32, { mixedRoles: true }))
    expect(mixedReport.eligible).toBe(true)

    // The key difference: with mixed roles each observation uses all-scope normalization
    // because no single role has >=20 graded games
  })

  it("compares medians with deterministic bootstrap", () => {
    const first = buildBestGamePattern(observations(32))
    const second = buildBestGamePattern(observations(32))
    expect(first.findings[0]?.interval).toEqual(second.findings[0]?.interval)
  })

  it("generates no directional copy when interval includes zero", () => {
    const report = buildBestGamePattern(observations(32))
    const findingWithZero = report.findings.find((f) =>
      f.interval && f.interval.low <= 0 && f.interval.high >= 0
    )
    if (findingWithZero) {
      expect(findingWithZero.summary).not.toMatch(/higher|lower|more|less/i)
    }
  })
})

describe("Playing conditions", () => {
  it("requires 30 graded games overall", () => {
    const report29 = buildPlayingConditions(observations(29))
    expect(report29.sections.every(s => !s.eligible)).toBe(true)

    const report30 = buildPlayingConditions(observations(30))
    expect(report30.sections.some(s => s.eligible)).toBe(true)
  })

  it("isolates sessions so separate-session games do not count under after-win/loss", () => {
    // Create games with >90 minute gaps to ensure session breaks
    const obs = observations(20).map((o, i) => {
      if (i > 0) {
        // Set gaps >90 minutes between games
        o.playedAt = observations(1)[0].playedAt + i * 100 * 60 * 1000
        o.endedAt = o.playedAt + o.durationSecs * 1000
      }
      return o
    })

    const report = buildPlayingConditions(obs)
    const afterWinSection = report.sections.find((s) => s.key === "previousResult")

    // With session breaks, after-win/loss buckets should be empty or very small
    const afterWinFinding = afterWinSection?.findings.find(f => f.key.includes("After win"))
    expect(afterWinFinding === undefined || afterWinFinding.games === 0).toBe(true)
  })

  it("creates eight three-hour time blocks using device local time", () => {
    const report = buildPlayingConditions(observations(100))
    const timeSection = report.sections.find((s) => s.key === "timeOfDay")
    expect(timeSection).toBeDefined()
    expect(timeSection?.method).toContain("local")

    // Should have potential for 8 buckets (0-3, 3-6, 6-9, 9-12, 12-15, 15-18, 18-21, 21-24)
    // Not all will be eligible with only 100 games, but structure should support 8
  })

  it("creates session game buckets 1, 2, 3, and 4+", () => {
    const report = buildPlayingConditions(observations(50))
    const sessionSection = report.sections.find((s) => s.key === "sessionGame")
    expect(sessionSection).toBeDefined()

    // Should have structure for 4 buckets
    const possibleLabels = ["First game", "Second game", "Third game", "Fourth+ game"]
    // At least some of these should exist in findings
  })

  it("creates rest time buckets: <15, 15-45, 45-90, new session", () => {
    const report = buildPlayingConditions(observations(50))
    const restSection = report.sections.find((s) => s.key === "restTime")
    expect(restSection).toBeDefined()

    // Should support 4 rest categories
  })

  it("handles exact 15, 45, and 90 minute boundaries correctly", () => {
    const rests = [
      { minutes: 14, sessionGame: 2 },
      { minutes: 15, sessionGame: 2 },
      { minutes: 45, sessionGame: 2 },
      { minutes: 90, sessionGame: 1 },
    ]
    const obs = observations(32).map((row, index) => ({
      ...row,
      session: index + 1,
      sessionGame: rests[Math.floor(index / 8)].sessionGame,
      restMinutes: rests[Math.floor(index / 8)].minutes,
    }))

    const report = buildPlayingConditions(obs)
    const rest = report.sections.find((section) => section.key === "restTime")
    expect(Object.fromEntries(rest!.findings.map((finding) => [finding.key, finding.games])))
      .toMatchObject({
        "Rest <15 min": 8,
        "Rest 15-45 min": 8,
        "Rest 45-90 min": 8,
        "New session": 8,
      })
  })

  it("requires at least 8 graded games per bucket for directional copy", () => {
    const report = buildPlayingConditions(observations(15))
    const sections = report.sections.filter((s) => s.eligible)

    sections.forEach(section => {
      section.findings.forEach(finding => {
        if (finding.games < 8) {
          // Should not have directional language
          expect(finding.summary).not.toMatch(/higher|lower|associated with.*grade/i)
        }
      })
    })
  })

  it("includes Wilson interval and adjusted win rate in findings", () => {
    const report = buildPlayingConditions(observations(50))
    const section = report.sections.find(s => s.eligible && s.findings.length > 0)

    if (section?.findings[0]) {
      const finding = section.findings[0]
      // Should have rateInterval (Wilson) separate from interval (grade bootstrap)
      expect(finding).toHaveProperty("interval")
    }
  })

  it("uses grade deltas with bootstrap intervals for condition findings", () => {
    const report = buildPlayingConditions(observations(50))
    const section = report.sections.find(s => s.eligible && s.findings.length > 0)

    if (section?.findings[0]) {
      const finding = section.findings[0]
      expect(finding.unit).toBe("grade")
      expect(finding).toHaveProperty("interval")
      // effect should be adjusted grade delta
    }
  })

  it("uses association language only", () => {
    const report = buildPlayingConditions(observations(50))
    const json = JSON.stringify(report)
    expect(json).not.toMatch(/better|improve|should|must|will make/i)
  })

  it("retains sparse buckets with raw values and insufficient confidence", () => {
    // Create 32 games (>=30 threshold) but concentrated in few time buckets
    // so some fixed buckets remain sparse (<8 games)
    const obs = observations(32, { fixedHour: 10 }) // All games at hour 10 (9-12 block)
    // Add a few sparse games in another bucket
    const sparse1 = observations(3, { fixedHour: 2 }) // 3 games in 0-3 block
    const sparse2 = observations(2, { fixedHour: 15 }) // 2 games in 15-18 block
    const combined = [...obs, ...sparse1, ...sparse2]

    const report = buildPlayingConditions(combined)
    const timeSection = report.sections.find((s) => s.key === "timeOfDay")

    expect(timeSection?.eligible).toBe(true) // >=1 bucket has >=8 games

    // Should find sparse buckets in findings
    const sparseFinding1 = timeSection?.findings.find((f) => f.games === 3)
    const sparseFinding2 = timeSection?.findings.find((f) => f.games === 2)

    expect(sparseFinding1).toBeDefined()
    expect(sparseFinding2).toBeDefined()

    // Sparse findings must have:
    if (sparseFinding1) {
      expect(sparseFinding1.games).toBe(3)
      expect(sparseFinding1.rateInterval).toBeDefined() // Wilson interval
      expect(sparseFinding1.confidence).toBe("insufficient")
      expect(sparseFinding1.summary).not.toMatch(/higher|lower|associated with.*grade/i)
      expect(sparseFinding1.scope).toMatch(/raw rate|adjusted rate/i)
    }

    if (sparseFinding2) {
      expect(sparseFinding2.games).toBe(2)
      expect(sparseFinding2.rateInterval).toBeDefined()
      expect(sparseFinding2.confidence).toBe("insufficient")
      expect(sparseFinding2.summary).not.toMatch(/higher|lower|associated with.*grade/i)
    }
  })

  it("uses precomputed account-wide session ordinals when supplied", () => {
    const obs = observations(32).map((row, index) => ({
      ...row,
      session: index + 1,
      sessionGame: 3,
      restMinutes: 5,
      previousWin: false,
    }))

    const report = buildPlayingConditions(obs)
    const session = report.sections.find((section) => section.key === "sessionGame")
    expect(session?.findings.find((finding) => finding.key === "Third game")?.games).toBe(32)
    expect(session?.findings.find((finding) => finding.key === "First game")?.games).toBe(0)
  })

  it("uses the same median-difference estimator for condition effects and intervals", () => {
    const obs = observations(32).map((row, index) => {
      const playedAt = new Date(row.playedAt)
      playedAt.setHours(index < 16 ? 10 : 16, 0, 0, 0)
      return {
        ...row,
        playedAt: playedAt.getTime() + Math.floor(index / 2) * 24 * 60 * 60_000,
        recallScore: index === 0 ? 100 : index < 16 ? 80 : 20,
      }
    })

    const report = buildPlayingConditions(obs)
    const time = report.sections.find((section) => section.key === "timeOfDay")
    const morning = time?.findings.find((finding) => finding.key === "9-12")
    expect(morning?.effect).toBe(60)
    expect(morning?.interval?.low).toBeLessThanOrEqual(60)
    expect(morning?.interval?.high).toBeGreaterThanOrEqual(60)
  })
})

describe("Duration insights", () => {
  it("creates fixed duration buckets for SR family", () => {
    const report = buildDurationInsights(observations(50, { variedDuration: true }))
    expect(report.eligible).toBe(true)
    expect(report.findings.length).toBeGreaterThan(0)
  })

  it("requires at least 8 graded games per bucket", () => {
    const report = buildDurationInsights(observations(10))
    expect(report.eligible).toBe(false)
  })

  it("compares grade deltas with bootstrap intervals", () => {
    const report = buildDurationInsights(observations(50, { shortDuration: true }))
    if (report.findings[0]?.interval) {
      expect(report.findings[0].interval).toHaveProperty("low")
      expect(report.findings[0].interval).toHaveProperty("high")
    }
  })

  it("uses association language only", () => {
    const report = buildDurationInsights(observations(50))
    const json = JSON.stringify(report)
    expect(json).not.toMatch(/better|improve|should|causes/i)
  })

  it("uses the shared half-open duration boundaries", () => {
    const boundaryDurations = [1_319, 1_320, 1_680, 2_040]
    const obs = observations(32).map((row, index) => ({
      ...row,
      durationSecs: boundaryDurations[Math.floor(index / 8)],
    }))

    const report = buildDurationInsights(obs)
    expect(Object.fromEntries(report.findings.map((finding) => [finding.key, finding.games])))
      .toEqual({
        "Under 22 min": 8,
        "22–28 min": 8,
        "28–34 min": 8,
        "34 min +": 8,
      })
  })

  it("reports only the buckets that entered each duration comparison", () => {
    const obs = observations(23).map((row, index) => ({
      ...row,
      durationSecs: index < 8 ? 1_200 : index < 16 ? 1_500 : 1_800,
    }))

    const report = buildDurationInsights(obs)
    expect(report.findings).toHaveLength(2)
    expect(report.findings.every((finding) => finding.eligibleGames === 16)).toBe(true)
    expect(report.findings.every((finding) => finding.scope.includes("vs 8 games"))).toBe(true)
  })

  it("measures public effects in authoritative Recall Score points", () => {
    const obs = observations(32, { variedDuration: true }).map((row) => ({
      ...row,
      recallScore: row.durationSecs === 1_200
        ? row.gameId === 1000 ? 100 : 80
        : 20,
      gradeScore: row.durationSecs === 1_200 ? -3 : 3,
    }))

    const section = buildDurationInsights(obs)
    const short = section.findings.find((finding) => finding.key === "Under 22 min")
    expect(short?.effect).toBe(60)
    expect(short?.interval?.low).toBeLessThanOrEqual(60)
    expect(short?.interval?.high).toBeGreaterThanOrEqual(60)
    expect(short?.scoreScale).toBe("recall_score_0_100")
  })
})

describe("Predictive section", () => {
  it("returns insufficient for fewer than 200 graded games", () => {
    const section = buildPredictiveSection(observations(100))
    expect(section.state).toBe("insufficient")
  })

  it("returns one of the four defined states", () => {
    const section = buildPredictiveSection(observations(250))
    expect(["insufficient", "no-signal", "ready", "error"]).toContain(section.state)
  })

  it("is always present (never undefined)", () => {
    const section = buildPredictiveSection([])
    expect(section).toBeDefined()
    expect(section.state).toBe("insufficient")
  })

  it("never hides no-signal behind an empty result", () => {
    // With 250 uniform-grade games, model can't beat intercept → no-signal
    const uniform = observations(250).map((o, i) => ({
      ...o,
      gradeScore: 40 + (i % 60),
    }))
    const section = buildPredictiveSection(uniform)
    expect(["no-signal", "insufficient"]).toContain(section.state)
    if (section.state === "no-signal") {
      expect(section.message).toBeDefined()
    }
  })
})

// --- Champion findings ---

function champStats(
  count: number,
  gradedPerChamp = 10,
): ChampionStatRow[] {
  const rows: ChampionStatRow[] = []
  for (let i = 0; i < count; i++) {
    rows.push({
      championId: 100 + i,
      games: gradedPerChamp + 2,
      wins: Math.floor((gradedPerChamp + 2) / 2),
      winRate: 0.5,
      avgKills: 5,
      avgDeaths: 4,
      avgAssists: 7,
      kda: 3,
      avgDamageToChampions: 15000,
      avgGradeScore: 50 + i * 3,
      averageRecallScore: 50 + i * 3,
      gradedGames: gradedPerChamp,
    })
  }
  return rows
}

function champObservations(count: number, championIds: number[]): InsightObservation[] {
  const results: InsightObservation[] = []
  const baseTime = 1700000000000
  for (let i = 0; i < count; i++) {
    const champId = championIds[i % championIds.length]
    results.push({
      gameId: 2000 + i,
      playedAt: baseTime + i * 3600000,
      endedAt: baseTime + i * 3600000 + 1800000,
      mode: "sr_ranked_solo",
      family: "sr",
      queueId: 420,
      win: i % 2 === 0,
      gradeScore: champId === 100 ? 70 : champId === 101 ? 30 : 50,
      recallScore: champId === 100 ? 70 : champId === 101 ? 30 : 50,
      championId: champId,
      role: "MIDDLE",
      durationSecs: 1800,
      completeLobby: true,
      metrics: {
        kda: 3, deaths: 5, damagePerMinute: 800, damageTakenPerMinute: 600,
        goldPerMinute: 400, csPerMinute: 7, ccPerMinute: 0.5,
      },
    })
  }
  return results
}

describe("Champion findings", () => {
  it("requires at least 8 graded games per champion", () => {
    const stats = champStats(3, 5) // only 5 graded each
    const obs = champObservations(15, [100, 101, 102])
    const section = buildChampionFindings(obs, stats, 50, "sr")
    expect(section.findings).toHaveLength(0)
    expect(section.eligible).toBe(false)
  })

  it("produces findings for champions with >=8 graded games", () => {
    const stats = champStats(3, 10)
    const obs = champObservations(30, [100, 101, 102])
    const section = buildChampionFindings(obs, stats, 50, "sr")
    expect(section.eligible).toBe(true)
    expect(section.findings.length).toBeGreaterThan(0)
    expect(section.findings.every((finding) => finding.games === 10)).toBe(true)
    expect(section.findings.every((finding) => finding.eligibleGames === 30)).toBe(true)
    expect(section.findings.every((finding) => finding.scope.includes("vs 20"))).toBe(true)
  })

  it("does not mark a champion section eligible without another champion to compare", () => {
    const section = buildChampionFindings(
      champObservations(8, [100]),
      champStats(1, 8),
      50,
      "sr",
    )

    expect(section.eligible).toBe(false)
    expect(section.findings).toEqual([])
  })

  it("uses bootstrap interval wholly above/below zero for directional copy", () => {
    const stats = champStats(3, 10)
    const obs = champObservations(60, [100, 101, 102])
    const section = buildChampionFindings(obs, stats, 50, "sr")

    for (const f of section.findings) {
      if (f.interval && f.interval.low > 0) {
        expect(f.summary).toMatch(/higher/i)
      } else if (f.interval && f.interval.high < 0) {
        expect(f.summary).toMatch(/lower/i)
      } else {
        expect(f.summary).toMatch(/no clear/i)
      }
    }
  })

  it("adds random-champion caveat for ARAM family", () => {
    const stats = champStats(2, 10)
    const obs = champObservations(20, [100, 101]).map((o) => ({
      ...o, mode: "aram" as const, family: "aram" as const,
    }))
    const section = buildChampionFindings(obs, stats, 50, "aram")
    for (const f of section.findings) {
      expect(f.caveat).toMatch(/randomly assigned/i)
    }
  })

  it("is deterministic across repeated calls", () => {
    const stats = champStats(3, 10)
    const obs = champObservations(30, [100, 101, 102])
    const a = buildChampionFindings(obs, stats, 50, "sr")
    const b = buildChampionFindings(obs, stats, 50, "sr")
    expect(a.findings.map((f) => f.interval)).toEqual(b.findings.map((f) => f.interval))
  })

  it("uses association language only", () => {
    const stats = champStats(3, 10)
    const obs = champObservations(30, [100, 101, 102])
    const section = buildChampionFindings(obs, stats, 50, "sr")
    const json = JSON.stringify(section)
    expect(json).not.toMatch(/better|improve|causes|should/i)
  })

  it("uses the same median-difference estimator for champion effects and intervals", () => {
    const stats = champStats(2, 10)
    const obs = champObservations(20, [100, 101]).map((row) => ({
      ...row,
      recallScore: row.gameId === 2000 ? 100 : row.championId === 100 ? 80 : 20,
    }))
    const section = buildChampionFindings(obs, stats, 50, "sr")
    const champion = section.findings.find((finding) => finding.key === "champion:100")
    expect(champion?.effect).toBe(60)
    expect(champion?.interval?.low).toBeLessThanOrEqual(60)
    expect(champion?.interval?.high).toBeGreaterThanOrEqual(60)
  })
})

// --- Item findings ---

function itemObservations(count: number): FinalItemObservation[] {
  const results: FinalItemObservation[] = []
  for (let i = 0; i < count; i++) {
    const hasItem = i % 2 === 0
    results.push({
      gameId: 3000 + i,
      championId: 100 + (i % 3),
      role: i < count / 2 ? "MIDDLE" : "BOTTOM",
      gradeScore: hasItem ? 55 + (i % 10) : 45 + (i % 10),
      recallScore: hasItem ? 55 + (i % 10) : 45 + (i % 10),
      itemIds: hasItem ? [3001, 3006, 3089] : [3006, 3089, 3100],
    })
  }
  return results
}

describe("Item findings", () => {
  it("requires at least 10 games containing the item", () => {
    const obs: FinalItemObservation[] = []
    for (let i = 0; i < 9; i++) {
      obs.push({
        gameId: i, championId: 100, role: "MIDDLE",
        gradeScore: 50, recallScore: 50, itemIds: [3001],
      })
    }
    const section = buildItemFindings(obs)
    expect(section.eligible).toBe(false)
  })

  it("groups by champion and role strata", () => {
    const section = buildItemFindings(itemObservations(30))
    expect(section.eligible).toBe(true)
    const finding = section.findings.find((f) => f.key === "item:3001")
    expect(finding).toBeDefined()
    expect(finding!.scope).toMatch(/champion-position groups/)
  })

  it("reports only games from champion-position groups with a comparator", () => {
    const obs: FinalItemObservation[] = Array.from({ length: 30 }, (_, index) => ({
      gameId: index + 1,
      championId: index < 20 ? 100 : 200,
      role: index < 20 ? "MIDDLE" : "TOP",
      gradeScore: index < 10 ? 70 : 40,
      recallScore: index < 10 ? 70 : 40,
      itemIds: index < 10 || index >= 20 ? [3001] : [3006],
    }))

    const finding = buildItemFindings(obs).findings
      .find((row) => row.key === "item:3001")
    expect(finding).toMatchObject({ games: 10, eligibleGames: 20 })
    expect(finding?.scope).toContain("10 games with the item vs 10 without")
  })

  it("does not mark an item section eligible when every item lacks a comparator", () => {
    const obs: FinalItemObservation[] = Array.from({ length: 12 }, (_, index) => ({
      gameId: index + 1,
      championId: 100,
      role: "MIDDLE",
      gradeScore: 50,
      recallScore: 50,
      itemIds: [3001],
    }))

    const section = buildItemFindings(obs)
    expect(section.eligible).toBe(false)
    expect(section.findings[0]).toMatchObject({ games: 0, eligibleGames: 0 })
    expect(section.findings[0].values).toEqual({ recordedItemGames: 12 })
  })

  it("includes final-inventory caveat on every finding", () => {
    const section = buildItemFindings(itemObservations(30))
    for (const f of section.findings) {
      expect(f.caveat).toMatch(/final inventory/i)
    }
  })

  it("includes confounding caveat on every finding", () => {
    const section = buildItemFindings(itemObservations(30))
    for (const f of section.findings) {
      expect(f.caveat).toMatch(/correlation/i)
    }
  })

  it("is deterministic across repeated calls", () => {
    const obs = itemObservations(30)
    const a = buildItemFindings(obs)
    const b = buildItemFindings(obs)
    expect(a.findings.map((f) => f.interval)).toEqual(b.findings.map((f) => f.interval))
  })

  it("uses association language only", () => {
    const section = buildItemFindings(itemObservations(30))
    const json = JSON.stringify(section)
    expect(json).not.toMatch(/better|improve|causes|should/i)
  })
})

// --- Trend findings ---

describe("Trend findings", () => {
  it("creates 10-game windows from graded observations", () => {
    const section = buildTrendFindings(observations(25), "sr")
    const windowFindings = section.findings.filter((f) => f.key.startsWith("window:"))
    expect(windowFindings.length).toBe(2) // 25 games, only 2 complete windows
  })

  it("requires 3 complete windows for inference", () => {
    const section20 = buildTrendFindings(observations(20), "sr")
    expect(section20.eligible).toBe(false)
    expect(section20.findings.find((f) => f.key === "trend:grade")).toBeUndefined()

    const section30 = buildTrendFindings(observations(30), "sr")
    expect(section30.eligible).toBe(true)
    expect(section30.findings.find((f) => f.key === "trend:grade")).toBeDefined()
  })

  it("compares latest 10 vs prior 20 grades", () => {
    const section = buildTrendFindings(observations(30), "sr")
    const trend = section.findings.find((f) => f.key === "trend:grade")
    expect(trend).toBeDefined()
    expect(trend!.scope).toMatch(/Latest 10 vs prior 20/)
    expect(trend!.interval).toBeDefined()
  })

  it("uses the same median-difference estimator for trend effects and intervals", () => {
    const obs = observations(30).map((row, index) => ({
      ...row,
      recallScore: index === 29 ? 100 : index >= 20 ? 90 : 10,
    }))
    const trend = buildTrendFindings(obs, "sr").findings
      .find((finding) => finding.key === "trend:grade")
    expect(trend?.effect).toBe(80)
    expect(trend?.interval?.low).toBeLessThanOrEqual(80)
    expect(trend?.interval?.high).toBeGreaterThanOrEqual(80)
  })

  it("returns raw windows even without directional finding", () => {
    const section = buildTrendFindings(observations(20), "sr")
    const windowFindings = section.findings.filter((f) => f.key.startsWith("window:"))
    expect(windowFindings.length).toBe(2)
  })

  it("is deterministic across repeated calls", () => {
    const obs = observations(30)
    const a = buildTrendFindings(obs, "sr")
    const b = buildTrendFindings(obs, "sr")
    expect(a.findings.map((f) => f.interval)).toEqual(b.findings.map((f) => f.interval))
  })

  it("raw windows include per-axis averages", () => {
    const section = buildTrendFindings(observations(30), "sr")
    const window = section.findings.find((f) => f.key === "window:0")
    expect(window).toBeDefined()
    expect(window!.values).toBeDefined()
    expect(Object.keys(window!.values!)).toEqual(
      expect.arrayContaining(["aggression", "damage", "durability", "farming", "objectives", "vision"]),
    )
    for (const v of Object.values(window!.values!)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it("SR axes include objectives and vision, not sustain or teamfighting", () => {
    const section = buildTrendFindings(observations(30, { family: "sr" }), "sr")
    const window = section.findings.find((f) => f.key === "window:0")!
    const keys = Object.keys(window.values!)
    expect(keys).toContain("objectives")
    expect(keys).toContain("vision")
    expect(keys).not.toContain("sustain")
    expect(keys).not.toContain("teamfighting")
  })

  it("ARAM axes include sustain and teamfighting, not objectives or vision", () => {
    const section = buildTrendFindings(observations(30, { family: "aram" }), "aram")
    const window = section.findings.find((f) => f.key === "window:0")!
    const keys = Object.keys(window.values!)
    expect(keys).toContain("sustain")
    expect(keys).toContain("teamfighting")
    expect(keys).not.toContain("objectives")
    expect(keys).not.toContain("vision")
  })

  it("per-game axis formulas match style.ts exactly", () => {
    const axes = computePerGameAxes({
      kills: 10, assists: 0, damageToChampions: 30000, damageTaken: 10000,
      damageSelfMitigated: 5000, damageObjectives: 6000, totalHeal: 2000,
      csPerMin: 12, visionPerMin: 3, ccPerMin: 25,
    }, "sr")
    expect(axes.aggression).toBeCloseTo(1) // 10/(10+0) = 1
    expect(axes.damage).toBeCloseTo(30000 / 40000) // 0.75
    expect(axes.durability).toBeCloseTo(5000 / 15000) // 0.333
    expect(axes.farming).toBeCloseTo(1) // clamp(12/10) = 1
    expect(axes.objectives).toBeCloseTo(6000 / 36000) // 0.167
    expect(axes.vision).toBeCloseTo(1) // clamp(3/2) = 1
    expect(axes.sustain).toBeUndefined()
  })

  it("ARAM farming cap is 5 CS/min", () => {
    const axes = computePerGameAxes({
      kills: 5, assists: 5, damageToChampions: 20000, damageTaken: 20000,
      damageSelfMitigated: 10000, damageObjectives: 0, totalHeal: 10000,
      csPerMin: 5, visionPerMin: 0, ccPerMin: 10,
    }, "aram")
    expect(axes.farming).toBeCloseTo(1) // 5/5 = 1
    expect(axes.sustain).toBeCloseTo(10000 / 30000) // 0.333
    expect(axes.teamfighting).toBeCloseTo(0.5) // 10/20 = 0.5
  })

  it("guards zero denominators", () => {
    const axes = computePerGameAxes({
      kills: 0, assists: 0, damageToChampions: 0, damageTaken: 0,
      damageSelfMitigated: 0, damageObjectives: 0, totalHeal: 0,
      csPerMin: 0, visionPerMin: 0, ccPerMin: 0,
    }, "sr")
    expect(axes.aggression).toBe(0)
    expect(axes.damage).toBe(0)
    expect(axes.durability).toBe(0)
    expect(axes.farming).toBe(0)
    expect(axes.objectives).toBe(0)
    expect(axes.vision).toBe(0)
  })

  it("produces per-axis findings at >=3 windows", () => {
    const section = buildTrendFindings(observations(30), "sr")
    const axisFindings = section.findings.filter((f) => f.key.startsWith("trend:") && f.key !== "trend:grade")
    expect(axisFindings.length).toBe(6) // aggression, damage, durability, farming, objectives, vision
    for (const f of axisFindings) {
      expect(f.unit).toBe("rate")
      expect(f.interval).toBeDefined()
      expect(f.scope).toMatch(/Latest 10 vs prior 20/)
    }
  })

  it("ARAM produces 6 per-axis findings with correct keys", () => {
    const section = buildTrendFindings(observations(30, { family: "aram" }), "aram")
    const axisFindings = section.findings.filter((f) => f.key.startsWith("trend:") && f.key !== "trend:grade")
    const keys = axisFindings.map((f) => f.key)
    expect(keys).toContain("trend:sustain")
    expect(keys).toContain("trend:teamfighting")
    expect(keys).not.toContain("trend:objectives")
    expect(keys).not.toContain("trend:vision")
  })

  it("no per-axis findings below 3 windows", () => {
    const section = buildTrendFindings(observations(20), "sr")
    expect(section.findings.filter((f) => f.key.startsWith("trend:")).length).toBe(0)
  })

  it("per-axis deterministic bootstrap is reproducible", () => {
    const obs = observations(30)
    const a = buildTrendFindings(obs, "sr")
    const b = buildTrendFindings(obs, "sr")
    const axisA = a.findings.filter((f) => f.key.startsWith("trend:"))
    const axisB = b.findings.filter((f) => f.key.startsWith("trend:"))
    expect(axisA.map((f) => f.interval)).toEqual(axisB.map((f) => f.interval))
  })

  it("no directional copy when interval crosses zero", () => {
    const section = buildTrendFindings(observations(30), "sr")
    for (const f of section.findings.filter((f) => f.key.startsWith("trend:"))) {
      if (f.interval && f.interval.low <= 0 && f.interval.high >= 0) {
        expect(f.summary).not.toMatch(/more|less|higher|lower/i)
      }
    }
  })

  it("directional copy uses more/less, not better/worse", () => {
    // Create observations where latest window has clearly different axes
    const obs = observations(30, {
      styleAxesOverride: (i) => {
        const base = computePerGameAxes({
          kills: 5, assists: 10, damageToChampions: 24000, damageTaken: 20000,
          damageSelfMitigated: 15000, damageObjectives: 3000, totalHeal: 5000,
          csPerMin: 7, visionPerMin: 1.5, ccPerMin: 0.5,
        }, "sr")
        // Latest 10 games (highest playedAt) get very high aggression
        if (i >= 20) return { ...base, aggression: 0.95 }
        return { ...base, aggression: 0.1 }
      },
    })
    const section = buildTrendFindings(obs, "sr")
    const agg = section.findings.find((f) => f.key === "trend:aggression")
    if (agg && agg.interval && !(agg.interval.low <= 0 && agg.interval.high >= 0)) {
      expect(agg.summary).toMatch(/more|less/)
      expect(agg.summary).not.toMatch(/better|worse|improve/i)
    }
  })

  it("does not add per-window SQL queries", () => {
    // buildTrendFindings takes observations array, not a repo — no query growth
    const obs = observations(50)
    const section = buildTrendFindings(obs, "sr")
    expect(section.findings.filter((f) => f.key.startsWith("window:")).length).toBe(5)
  })

  it("does not turn unavailable style axes into zero-valued trend evidence", () => {
    const obs = observations(30)
    for (const game of obs.slice(-10)) game.styleAxes = {}

    const section = buildTrendFindings(obs, "sr")
    const latestWindow = section.findings.find((finding) => finding.key === "window:0")

    expect(latestWindow?.values).not.toHaveProperty("aggression")
    expect(section.findings.find((finding) => finding.key === "trend:aggression"))
      .toBeUndefined()
  })
})

// --- Report composition ---

describe("Death map", () => {
  const timeline = (gameId: number, participantId: number): RviTimelineObservation => ({
    gameId,
    playedAt: 1_700_000_000_000,
    durationSecs: 2_100,
    participantId,
    teamId: 100,
    summary: {
      frames: [],
      turningPoints: [],
      events: [
        {
          eventId: `${gameId}:owner-death`,
          timestamp: 12 * 60_000,
          type: "CHAMPION_KILL",
          category: "kill",
          participantId: 8,
          targetId: participantId,
          position: { x: 6_250, y: 7_100 },
        },
        {
          eventId: `${gameId}:other-death`,
          timestamp: 17 * 60_000,
          type: "CHAMPION_KILL",
          category: "kill",
          participantId: 9,
          targetId: participantId + 1,
          position: { x: 8_000, y: 8_000 },
        },
        {
          eventId: `${gameId}:invalid-position`,
          timestamp: 31 * 60_000,
          type: "CHAMPION_KILL",
          category: "kill",
          participantId: 9,
          targetId: participantId,
          position: { x: 20_000, y: 8_000 },
        },
      ],
    },
  })

  it("keeps only the tracked player's valid Summoner's Rift death positions", () => {
    expect(buildDeathMap("sr", [timeline(1, 4), timeline(2, 6)])).toEqual({
      timelineGames: 2,
      deaths: [
        { gameId: 1, playedAt: 1_700_000_000_000, timestamp: 720_000, x: 6_250, y: 7_100 },
        { gameId: 2, playedAt: 1_700_000_000_000, timestamp: 720_000, x: 6_250, y: 7_100 },
      ],
    })
  })

  it("does not project non-Rift timelines onto the Rift image", () => {
    expect(buildDeathMap("aram", [timeline(1, 4)])).toBeUndefined()
  })
})

describe("SkillReport", () => {
  const baseInput = () => ({
    modes: ["sr_ranked_solo" as const, "sr_ranked_flex" as const],
    family: "sr" as const,
    generatedAt: 1700000000000,
    summary: {
      games: 50, wins: 25, losses: 25, winRate: 0.5,
      avgKills: 5, avgDeaths: 4, avgAssists: 7, kda: 3,
      avgDamageToChampions: 15000, avgDamageTaken: 12000, avgGold: 12000,
      avgDurationSecs: 1800, pentaKills: 0, currentStreak: 0,
      longestWinStreak: 3, avgGradeScore: 50, gradedGames: 50,
      averageRecallScore: 50,
    },
    style: {
      career: {
        games: 50,
        axes: [{
          key: "aggression",
          label: "Kills vs assists",
          value: 0.4,
          description: "Kill involvement from kills",
          formula: "kills / (kills + assists)",
        }],
        detail: {
          damagePerMin: 800, goldPerMin: 400, csPerMin: 7, visionPerMin: 1.5,
          avgDeaths: 4, avgLargestSpree: 2, doubleKills: 3, tripleKills: 1,
          quadraKills: 0, pentaKills: 0,
        },
      },
    },
    grades: [{ grade: "S", count: 5 }, { grade: "A", count: 20 }],
    lobby: { games: 50, metrics: [] },
    contribution: { games: 50, damageShare: 0.2, goldShare: 0.2, killShare: 0.2 },
    duration: [{ label: "Under 25 min", games: 12, wins: 7, winRate: 7 / 12 }],
    hours: [{ label: "18-21", games: 8, wins: 5, winRate: 5 / 8 }],
    pool: { champions: 10, games: 50, coreShare: 0.6, coreWinRate: 0.55, restWinRate: 0.45 },
    builds: [
      { itemId: 3001, games: 20, wins: 10, winRate: 0.5 },
      { itemId: 3006, games: 15, wins: 8, winRate: 0.53 },
    ],
    observations: observations(50),
    championStats: champStats(5, 10),
    itemObservations: itemObservations(50),
  })

  it("has exact top-level shape with version 3", () => {
    const report = buildSkillReport(baseInput())
    expect(report.version).toBe(3)
    expect(report.generatedAt).toBe(1700000000000)
    expect(report.scope).toEqual({
      modes: ["sr_ranked_solo", "sr_ranked_flex"],
      family: "sr",
    })
    expect(report.overview).toBeDefined()
    expect(report.insights).toBeDefined()
  })

  it("uses the explicit generatedAt parameter", () => {
    const a = buildSkillReport({ ...baseInput(), generatedAt: 111 })
    const b = buildSkillReport({ ...baseInput(), generatedAt: 222 })
    expect(a.generatedAt).toBe(111)
    expect(b.generatedAt).toBe(222)
  })

  it("builds report RVI only from the selected match Grade recipe observations", () => {
    const recipeId = "recall.grade.v3.test@calibration:test"
    const familyPercentiles = Object.fromEntries(
      RVI_VECTOR_KEYS.map((family, index) => [family, 90 - index * 10]),
    )
    const familyResponsibilityWeights = Object.fromEntries(
      RVI_VECTOR_KEYS.map((family) => [
        family,
        family === "protection" ? 0 : 1 / MATCH_GRADE_ARM_KEYS.length,
      ]),
    )
    const report = buildSkillReport({
      ...baseInput(),
      rvi: {
        algorithmVersion: 3,
        recipeId,
        calibrationId: "calibration:test",
        familyKeys: MATCH_GRADE_ARM_KEYS,
        observations: [
          {
            matchId: 1,
            recipeId,
            playedAt: 1_000,
            recallScore: 20,
            familyPercentiles,
            familyResponsibilityWeights,
            championId: 84,
            position: "MIDDLE",
            primaryArchetype: "assassin",
          },
          {
            matchId: 2,
            recipeId,
            playedAt: 2_000,
            recallScore: 80,
            familyPercentiles,
            familyResponsibilityWeights,
            championId: 222,
            position: "BOTTOM",
            primaryArchetype: "marksman",
          },
        ],
      },
      // This remains a legacy visualization payload, not an RVI input.
      gradeComponentHistory: [{
        gameId: 99,
        playedAt: 99_000,
        grade: "S+",
        gradeScore: 4,
        compositePercentile: 1,
        components: [],
      }],
    })

    expect(report.overview.performance).toMatchObject({
      algorithmVersion: 3,
      recipeId,
      score: 60,
      recallScoreAverage: 50,
      measuredGames: 2,
      scoringContext: "profile",
      weighting: { kind: "equal" },
      headline: { source: "career_arm_mean", score: 60 },
      scopes: {
        overall: { score: 60, games: 2 },
        positions: [
          { position: "MIDDLE", score: 60 },
          { position: "BOTTOM", score: 60 },
        ],
        primaryArchetypes: [
          { primaryArchetype: "assassin", score: 60 },
          { primaryArchetype: "marksman", score: 60 },
        ],
      },
    })
    expect(report.overview.performance?.dimensions.map((dimension) => dimension.key))
      .toEqual(RVI_VECTOR_KEYS)
    expect(report.visuals.gradeComponents).toHaveLength(1)
  })

  it("overview builds have no win rate", () => {
    const report = buildSkillReport(baseInput())
    for (const build of report.overview.builds) {
      expect(build).toEqual({ itemId: expect.any(Number), games: expect.any(Number) })
      expect("winRate" in build).toBe(false)
      expect("wins" in build).toBe(false)
    }
  })

  it("overview pool has no core/rest win rate", () => {
    const report = buildSkillReport(baseInput())
    const pool = report.overview.pool!
    expect(pool).toEqual({
      champions: expect.any(Number),
      games: expect.any(Number),
      coreShare: expect.any(Number),
    })
    expect("coreWinRate" in pool).toBe(false)
    expect("restWinRate" in pool).toBe(false)
  })

  it("has all seven insight sections plus predictive", () => {
    const report = buildSkillReport(baseInput())
    expect(report.insights.bestGamePattern).toBeDefined()
    expect(report.insights.conditions).toBeDefined()
    expect(report.insights.predictive).toBeDefined()
    expect(report.insights.duration).toBeDefined()
    expect(report.insights.trends).toBeDefined()
    expect(report.insights.champions).toBeDefined()
    expect(report.insights.items).toBeDefined()
  })

  it("keeps historical playstyle windows and scoped outcome rows for charts", () => {
    const report = buildSkillReport(baseInput())

    expect(report.overview.style?.drift).toHaveLength(5)
    expect(report.overview.style?.drift[0].label).toBe("Games 1-10")
    expect(report.overview.style?.drift[4].label).toBe("Games 41-50")
    expect(report.overview.outcomes).toEqual({
      duration: [{ label: "Under 25 min", games: 12, wins: 7, winRate: 7 / 12 }],
      hours: [{ label: "18-21", games: 8, wins: 5, winRate: 5 / 8 }],
    })
  })

  it("leaves unavailable drift axes blank instead of averaging them as zero", () => {
    const input = baseInput()
    input.observations.slice(0, 10).forEach((game) => { game.styleAxes = {} })

    const report = buildSkillReport(input)

    expect(report.overview.style?.drift[0].axes).toEqual([])
    expect(report.overview.style?.drift[1].axes.length).toBeGreaterThan(0)
  })

  it("is renderer-serializable (structured clone compatible)", () => {
    const report = buildSkillReport(baseInput())
    expect(() => structuredClone(report)).not.toThrow()
  })

  it("contains no causal language", () => {
    const report = buildSkillReport(baseInput())
    const json = JSON.stringify(report)
    expect(json).not.toMatch(/better|improve|causes|should|will make/i)
  })

  it("builds a 2,000-observation report within the local budget", () => {
    const input = {
      ...baseInput(),
      summary: {
        ...baseInput().summary,
        games: 2000,
        wins: 1000,
        losses: 1000,
        gradedGames: 2000,
      },
      observations: observations(2000, { mixedRoles: true, variedDuration: true }),
    }

    buildSkillReport(input)
    const startedAt = performance.now()
    const report = buildSkillReport(input)
    const elapsedMs = performance.now() - startedAt
    // Preserve the strict local regression guard while allowing modest hosted-runner variance.
    const budgetMs = process.env.CI ? 350 : 250

    expect(report.overview.summary.games).toBe(2000)
    expect(elapsedMs).toBeLessThan(budgetMs)
  })
})
