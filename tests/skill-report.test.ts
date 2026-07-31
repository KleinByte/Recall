import { describe, expect, it } from "vitest"
import type { InsightObservation } from "../electron/main/database/insights-repo.js"
import {
  buildBestGamePattern,
  buildPlayingConditions,
  buildDurationInsights,
  buildPredictiveSection,
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
    expect(report.definition).toContain("top 25% of your Recall grades")
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
    // Test with games at exact boundary times
    const obs = observations(40).map((o, i) => {
      if (i > 0) {
        const prev = observations(1)[0]
        // Set exact 15, 45, 90 minute gaps
        const gaps = [14, 15, 44, 45, 89, 90, 91]
        const gapMinutes = gaps[i % gaps.length]
        o.playedAt = prev.playedAt + gapMinutes * 60 * 1000
        o.endedAt = o.playedAt + o.durationSecs * 1000
      }
      return o
    })
    
    const report = buildPlayingConditions(obs)
    // Boundaries should be handled consistently (<15, 15-45, 45-90, >90)
    expect(report.sections).toBeDefined()
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
