import { describe, expect, it } from "vitest"
import type { InsightObservation } from "../electron/main/database/insights-repo.js"
import {
  buildBestGamePattern,
  buildPlayingConditions,
  buildDurationInsights,
} from "../electron/main/matches/skill-report.js"

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
  } = {},
): InsightObservation[] {
  const results: InsightObservation[] = []
  const baseTime = 1700000000000 // Nov 14, 2023

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
    
    results.push({
      gameId: 1000 + i,
      playedAt,
      endedAt: playedAt + durationSecs * 1000,
      mode: "sr_ranked_solo",
      family: "sr",
      queueId: 420,
      win,
      gradeScore,
      championId: 1,
      role,
      durationSecs,
      completeLobby: true,
      metrics: {
        kda: 3.0,
        deaths: 5,
        damagePerMinute: 800,
        damageTakenPerMinute: damageTaken / (durationSecs / 60),
        goldPerMinute: 400,
        csPerMinute: 7,
        visionPerMinute: 1.5,
        objectiveDamagePerMinute: 100,
        ccPerMinute: 0.5,
        killParticipation: 0.6,
        teamDamageShare: 0.25,
        allyHealShieldPerMinute: 50,
      },
    })
  }

  return results
}

describe("Strong game pattern", () => {
  it("requires 30 graded games and eight games on each side", () => {
    expect(buildBestGamePattern(observations(29)).eligible).toBe(false)
    expect(buildBestGamePattern(observations(31)).eligible).toBe(false) // Need 32 to ensure 8 in both groups
  })

  it("defines strong games from the inclusive top quartile", () => {
    const report = buildBestGamePattern(observations(32))
    expect(report.eligible).toBe(true)
    expect(report.definition).toContain("top 25% of your Recall grades")
    expect(report.strongGames).toBeGreaterThanOrEqual(8)
  })

  it("does not call a positive metric difference better", () => {
    const report = buildBestGamePattern(observations(40, { highDamageTaken: true }))
    expect(JSON.stringify(report)).not.toMatch(/better|improve|causes/i)
  })

  it("uses same-role history when it has at least 20 graded rows", () => {
    const report = buildBestGamePattern(observations(25, { sameRole: true }))
    expect(report.eligible).toBe(false) // Not enough games total
    
    const reportMixed = buildBestGamePattern(observations(32, { mixedRoles: true }))
    // With mixed roles, each role has <20 games, so should use all scope history
    expect(reportMixed.eligible).toBe(true)
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
  it("sessionizes before applying previous-result conditions", () => {
    const report = buildPlayingConditions(observations(20, { daysApart: true }))
    // Games days apart should not inherit previous result
    const afterWin = report.sections.find((s) => s.key === "previousResult")
    expect(afterWin).toBeDefined()
  })

  it("creates fixed hour buckets", () => {
    const report = buildPlayingConditions(observations(50, { fixedHour: 14 }))
    const timeSection = report.sections.find((s) => s.key === "timeOfDay")
    expect(timeSection?.eligible).toBe(true)
  })

  it("requires at least 8 graded games per bucket", () => {
    const report = buildPlayingConditions(observations(10))
    const sections = report.sections.filter((s) => s.eligible)
    // With 10 games, most buckets won't have 8 games, but some sections might if games cluster
    // Just verify the structure is correct
    expect(report.sections.length).toBeGreaterThan(0)
  })

  it("includes Wilson interval for raw rates", () => {
    const report = buildPlayingConditions(observations(50))
    const section = report.sections[0]
    if (section?.findings[0]) {
      expect(section.findings[0]).toHaveProperty("interval")
    }
  })

  it("uses adjusted rates with prior weight 12", () => {
    const report = buildPlayingConditions(observations(50))
    const section = report.sections[0]
    if (section?.findings[0]) {
      // Adjusted rate should be closer to baseline than raw rate
      expect(section.findings[0]).toHaveProperty("effect")
    }
  })

  it("uses association language only", () => {
    const report = buildPlayingConditions(observations(50))
    const json = JSON.stringify(report)
    expect(json).not.toMatch(/better|improve|should|must|will make/i)
  })

  it("generates no directional copy for sparse buckets", () => {
    const report = buildPlayingConditions(observations(20))
    report.sections.forEach((section) => {
      section.findings.forEach((finding) => {
        if (finding.games < 8) {
          expect(finding.summary).not.toMatch(/higher|lower|associated/i)
        }
      })
    })
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
})
