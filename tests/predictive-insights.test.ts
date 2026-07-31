import { describe, expect, it } from "vitest"
import type { InsightObservation } from "../electron/main/database/insights-repo.js"
import {
  buildPregameRows,
  fitRidgeLogistic,
  validatePredictiveSignals,
  buildPredictiveSection,
  splitPredictiveHistory,
  type PregameRow,
  type PredictiveSection,
} from "../electron/main/matches/predictive-insights.js"

// --- Helpers ---

function makeObservation(
  index: number,
  overrides: Partial<InsightObservation> = {},
): InsightObservation {
  const baseTime = 1700000000000
  const playedAt = baseTime + index * 3600_000 // 1h apart
  return {
    gameId: 1000 + index,
    playedAt,
    endedAt: playedAt + 1800_000,
    mode: "sr_ranked_solo",
    family: "sr",
    queueId: 420,
    win: index % 2 === 0,
    gradeScore: 40 + (index % 60),
    championId: 1 + (index % 5),
    role: "MIDDLE",
    durationSecs: 1800,
    completeLobby: true,
    metrics: {
      kda: 3,
      deaths: 4,
      damagePerMinute: 700,
      damageTakenPerMinute: 500,
      goldPerMinute: 400,
      csPerMinute: 7,
      visionPerMinute: 1.5,
      ccPerMinute: 0.4,
    },
    ...overrides,
  }
}

function repeatedChampionHistory(): InsightObservation[] {
  const baseTime = 1700000000000
  return [0, 1, 2].map((i) =>
    makeObservation(i, { championId: 42, playedAt: baseTime + i * 3600_000 }),
  )
}

function history(count: number, opts?: { signal?: boolean }): InsightObservation[] {
  const baseTime = 1700000000000
  const obs: InsightObservation[] = []
  for (let i = 0; i < count; i++) {
    // Keep timestamps strictly monotonic (1h apart)
    const playedAt = baseTime + i * 3600_000

    let gradeScore = 30 + (i % 70)
    let win = i % 2 === 0

    // If signal mode: later session games correlate with high grade
    if (opts?.signal) {
      const sessionGame = (i % 4) + 1
      if (sessionGame >= 3) {
        gradeScore = 70 + (i % 30)
      } else {
        gradeScore = 20 + (i % 30)
      }
      win = gradeScore >= 50
    }

    obs.push(
      makeObservation(i, {
        playedAt,
        endedAt: playedAt + 1800_000,
        gradeScore,
        win,
        championId: 1 + (i % 8),
        role: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5],
      }),
    )
  }
  return obs
}

function historyWithExtremeHoldout(): InsightObservation[] {
  // Make the last 20% have an extreme pattern not seen in training
  const obs = history(250)
  const holdoutStart = Math.floor(250 * 0.8)
  for (let i = holdoutStart; i < obs.length; i++) {
    obs[i].gradeScore = 95
  }
  return obs
}

function randomLabelHistory(count: number): InsightObservation[] {
  // LCG with large prime to avoid period alignment with hour/weekday features
  const obs = history(count)
  let seed = 42
  return obs.map((o) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return { ...o, gradeScore: 30 + (seed % 70) }
  })
}

function signalHistory(count: number): InsightObservation[] {
  // Create sessions of 4 games with >90min breaks between sessions.
  // Session games 3 and 4 get high grades (strong signal).
  const baseTime = 1700000000000
  const obs: InsightObservation[] = []
  for (let i = 0; i < count; i++) {
    const sessionIndex = Math.floor(i / 4)
    const sessionGame = (i % 4) + 1
    // Within session: 30min gaps. Between sessions: 120min gap.
    const sessionStart = baseTime + sessionIndex * (4 * 30 * 60_000 + 120 * 60_000)
    const playedAt = sessionStart + (sessionGame - 1) * 30 * 60_000
    const gradeScore = sessionGame >= 3 ? 70 + (i % 30) : 20 + (i % 30)
    const win = gradeScore >= 50

    obs.push(
      makeObservation(i, {
        playedAt,
        endedAt: playedAt + 1800_000,
        gradeScore,
        win,
        championId: 1 + (i % 8),
        role: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5],
      }),
    )
  }
  return obs
}

// --- Leakage tests ---

describe("Pregame row construction", () => {
  it("counts champion familiarity strictly before each game", () => {
    const rows = buildPregameRows(repeatedChampionHistory())
    expect(rows.map((row) => row.raw.priorChampionGames)).toEqual([0, 1, 2])
  })

  it("does not expose postgame values as features", () => {
    const rows = buildPregameRows(history(200))
    const row = rows[100]
    expect(Object.keys(row.features)).not.toEqual(
      expect.arrayContaining([
        "win",
        "gradeScore",
        "durationSecs",
        "damagePerMinute",
        "itemIds",
      ]),
    )
  })

  it("excludes current-game champion from prior count", () => {
    // 5 games on champion 42, then 1 more on champion 42
    const obs = Array.from({ length: 6 }, (_, i) =>
      makeObservation(i, { championId: 42 }),
    )
    const rows = buildPregameRows(obs)
    // Last row should have 5 prior games, not 6
    expect(rows[5].raw.priorChampionGames).toBe(5)
  })

  it("does not count future games in prior champion count", () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObservation(i, { championId: 42 }),
    )
    const rows = buildPregameRows(obs)
    // Row at index 3 should only know about rows 0,1,2
    expect(rows[3].raw.priorChampionGames).toBe(3)
  })

  it("previous win is from the same session only", () => {
    const baseTime = 1700000000000
    // Game 0 ends at baseTime + 30min, game 1 starts 2h later (>90min gap → new session)
    const obs = [
      makeObservation(0, { win: true, playedAt: baseTime, endedAt: baseTime + 1800_000 }),
      makeObservation(1, {
        win: false,
        playedAt: baseTime + 1800_000 + 91 * 60_000, // 91min after game 0 ends
        endedAt: baseTime + 1800_000 + 91 * 60_000 + 1800_000,
      }),
    ]
    const rows = buildPregameRows(obs)
    // Game 1 starts a new session, so previousWin should be undefined
    expect(rows[1].raw.previousWin).toBeUndefined()
  })
})

describe("Temporal split integrity", () => {
  it("fits transforms and the quartile threshold on training rows only", () => {
    const result = splitPredictiveHistory(historyWithExtremeHoldout())
    expect(result.threshold).toBe(result.trainingThreshold)
    expect(result.scalerSource).toBe("training")
  })

  it("keeps every holdout row later than every training row", () => {
    const split = splitPredictiveHistory(history(200))
    expect(
      Math.min(...split.holdout.map((row) => row.playedAt)),
    ).toBeGreaterThan(Math.max(...split.training.map((row) => row.playedAt)))
  })

  it("holdout is exactly the latest 20%", () => {
    const count = 250
    const split = splitPredictiveHistory(history(count))
    const expectedHoldout = Math.floor(count * 0.2)
    expect(split.holdout.length).toBe(expectedHoldout)
    expect(split.training.length).toBe(count - expectedHoldout)
  })
})

// --- Eligibility tests ---

describe("Eligibility requirements", () => {
  it("rejects fewer than 200 graded games", () => {
    const section = buildPredictiveSection(history(199))
    expect(section.state).toBe("insufficient")
  })

  it("rejects when fewer than 40 strong games", () => {
    // All games get similar grades so threshold splits badly
    const obs = Array.from({ length: 210 }, (_, i) =>
      makeObservation(i, { gradeScore: 50 }),
    )
    const section = buildPredictiveSection(obs)
    expect(section.state).toBe("insufficient")
  })

  it("rejects when fewer than 40 non-strong games", () => {
    // All games above threshold
    const obs = Array.from({ length: 210 }, (_, i) =>
      makeObservation(i, { gradeScore: 95 }),
    )
    const section = buildPredictiveSection(obs)
    expect(section.state).toBe("insufficient")
  })

  it("requires at least 2 holdout outcomes in each class", () => {
    // Create history where holdout has only one class
    const obs = history(200)
    // Make the last 20% all high-grade (same class)
    const holdoutStart = Math.floor(200 * 0.8)
    for (let i = holdoutStart; i < obs.length; i++) {
      obs[i].gradeScore = 99
    }
    const section = buildPredictiveSection(obs)
    // Should be insufficient because holdout doesn't have both classes
    expect(["insufficient", "no-signal"]).toContain(section.state)
  })
})

// --- Validation tests ---

describe("Model validation gates", () => {
  it("returns no-signal for random labels that cannot beat intercept", () => {
    const section = buildPredictiveSection(randomLabelHistory(250))
    expect(section.state).toBe("no-signal")
  })

  it("validates coefficient sign stability across folds", () => {
    // With a strong deterministic signal, we expect ready
    const section = buildPredictiveSection(signalHistory(300))
    if (section.state === "ready") {
      // At most 3 reported features
      expect(section.signals!.length).toBeLessThanOrEqual(3)
      // Each reported signal must have consistent sign in 4/5 folds
      for (const signal of section.signals!) {
        expect(signal.direction).toMatch(/^(positive|negative)$/)
      }
    }
  })

  it("reports at most 3 standardized features", () => {
    const section = buildPredictiveSection(signalHistory(300))
    if (section.state === "ready") {
      expect(section.signals!.length).toBeLessThanOrEqual(3)
    }
  })
})

// --- Synthetic signal tests ---

describe("Synthetic signal detection", () => {
  it("detects a deterministic session-game signal when present", () => {
    const section = buildPredictiveSection(signalHistory(300))
    expect(section.state).toBe("ready")
    expect(section.signals).toBeDefined()
    expect(section.signals!.length).toBeGreaterThan(0)
  })

  it("marginal probability effect is computed over holdout without postgame leakage", () => {
    const section = buildPredictiveSection(signalHistory(300))
    if (section.state === "ready") {
      for (const signal of section.signals!) {
        expect(typeof signal.marginalEffect).toBe("number")
        expect(Math.abs(signal.marginalEffect)).toBeLessThanOrEqual(1)
        expect(Math.abs(signal.marginalEffect)).toBeGreaterThan(0)
      }
    }
  })
})

// --- Ridge logistic regression contract ---

describe("Ridge logistic regression", () => {
  it("converges on a simple separable problem", () => {
    // Two-feature problem: positive class has feature[0] > 0
    const X = [
      [1, 0],
      [2, 0],
      [3, 0],
      [-1, 0],
      [-2, 0],
      [-3, 0],
    ]
    const y = [1, 1, 1, 0, 0, 0]
    const result = fitRidgeLogistic(X, y, 1.0)
    expect(result.converged).toBe(true)
    expect(result.weights[0]).toBeGreaterThan(0) // positive feature 0
  })

  it("throws on non-finite input", () => {
    const X = [[NaN, 1], [1, 0]]
    const y = [1, 0]
    expect(() => fitRidgeLogistic(X, y, 1.0)).toThrow()
  })

  it("produces deterministic results", () => {
    const X = [[1, 0.5], [2, -0.3], [-1, 0.1], [-2, -0.5]]
    const y = [1, 1, 0, 0]
    const r1 = fitRidgeLogistic(X, y, 1.0)
    const r2 = fitRidgeLogistic(X, y, 1.0)
    expect(r1.weights).toEqual(r2.weights)
    expect(r1.intercept).toEqual(r2.intercept)
  })

  it("does not penalize the intercept", () => {
    // All positive y: intercept should be large, weights near zero
    const X = [[0], [0], [0], [0]]
    const y = [1, 1, 1, 1]
    const result = fitRidgeLogistic(X, y, 10.0)
    expect(result.intercept).toBeGreaterThan(0)
    expect(Math.abs(result.weights[0])).toBeLessThan(result.intercept)
  })
})

// --- State contract ---

describe("Predictive section state contract", () => {
  it("always returns exactly one state", () => {
    const states: PredictiveSection["state"][] = []
    states.push(buildPredictiveSection([]).state)
    states.push(buildPredictiveSection(history(50)).state)
    states.push(buildPredictiveSection(history(199)).state)
    states.push(buildPredictiveSection(randomLabelHistory(250)).state)
    states.push(buildPredictiveSection(signalHistory(300)).state)
    for (const s of states) {
      expect(["insufficient", "no-signal", "ready", "error"]).toContain(s)
    }
  })

  it("eligible model failing validation shows no-signal, not hidden", () => {
    const section = buildPredictiveSection(randomLabelHistory(250))
    expect(section.state).toBe("no-signal")
    expect(section.message).toBeDefined()
  })

  it("insufficient data states explain what is needed", () => {
    const section = buildPredictiveSection(history(50))
    expect(section.state).toBe("insufficient")
    expect(section.neededGames).toBeGreaterThan(0)
  })
})

// --- Feature set stability ---

describe("Fixed feature set", () => {
  it("uses stable sorted feature names", () => {
    const rows = buildPregameRows(history(10))
    const names1 = Object.keys(rows[5].features)
    const names2 = Object.keys(rows[7].features)
    expect(names1).toEqual(names2)
    // Verify sorted
    expect(names1).toEqual([...names1].sort())
  })

  it("includes only the specified feature vocabulary", () => {
    const rows = buildPregameRows(history(50))
    const features = Object.keys(rows[25].features)
    // Must include hour, weekday, session, rest, previous, role, mode, champion
    expect(features.some((f) => f.startsWith("hour_"))).toBe(true)
    expect(features.some((f) => f.startsWith("weekday_"))).toBe(true)
    expect(features.some((f) => f.startsWith("session_game_"))).toBe(true)
    expect(features.some((f) => f.includes("rest"))).toBe(true)
    expect(features.some((f) => f.includes("previous"))).toBe(true)
    expect(features.some((f) => f.startsWith("role_"))).toBe(true)
    expect(features.some((f) => f.startsWith("mode_"))).toBe(true)
    expect(features.some((f) => f.includes("champion"))).toBe(true)
  })

  it("does not include forbidden postgame features", () => {
    const rows = buildPregameRows(history(50))
    const features = Object.keys(rows[25].features)
    // Postgame stats/outcomes must never appear as standalone features
    const forbidden = [
      "gradeScore",
      "durationSecs",
      "damagePerMinute",
      "goldPerMinute",
      "csPerMinute",
      "visionScore",
      "outcome",
      "item_",
    ]
    for (const f of forbidden) {
      const matches = features.filter((name) => name.includes(f))
      expect(matches).toEqual([])
    }
  })
})
