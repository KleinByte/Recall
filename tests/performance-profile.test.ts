import { describe, expect, it } from "vitest"
import type { GradeComponentObservation, InsightObservation, RviTimelineObservation } from "../electron/main/database/insights-repo.js"
import { buildPerformanceProfile } from "../electron/main/matches/performance-profile.js"
import type { GradeComponent } from "../electron/main/review/types.js"

const componentKeys: GradeComponent["key"][] = [
  "combat",
  "participation",
  "economy",
  "survival",
  "frontlining",
  "farming",
  "vision",
  "objectives",
]

function history(games: number, value = .72, include = componentKeys): GradeComponentObservation[] {
  return Array.from({ length: games }, (_, index) => ({
    gameId: index + 1,
    playedAt: index * 1000,
    grade: "A",
    gradeScore: .5,
    compositePercentile: Math.max(0, Math.min(1, value + (index % 3 - 1) * .04)),
    components: include.map((key) => ({
      key,
      label: key,
      percentile: value,
      weight: 1 / include.length,
      contribution: value / include.length,
      scope: key === "farming" || key === "vision" || key === "economy" ? "role" : "lobby",
    })),
  }))
}

function observations(games: number, family: "sr" | "aram" = "sr"): InsightObservation[] {
  return Array.from({ length: games }, (_, index) => ({
    gameId: index + 1,
    playedAt: index * 1000,
    mode: family === "sr" ? "sr_ranked_solo" : "aram",
    family,
    queueId: family === "sr" ? 420 : 450,
    win: index % 2 === 0,
    championId: 1 + index % 5,
    role: family === "sr" ? "MIDDLE" : undefined,
    durationSecs: 1800,
    completeLobby: true,
    grade: "A",
    gradeScore: .5,
    metrics: {
      kda: 3,
      deaths: 4,
      damagePerMinute: 600,
      damageTakenPerMinute: 500,
      goldPerMinute: 400,
      csPerMinute: 7,
      ccPerMinute: 4,
    },
    styleAxes: family === "sr"
      ? { aggression: .5, damage: .6, durability: .5, farming: .7, objectives: .5, vision: .5 }
      : { aggression: .5, damage: .6, durability: .5, farming: .5, sustain: .64, teamfighting: .58 },
  }))
}

describe("Recall Vector Index performance profile", () => {
  it("returns no profile without measured lobby components", () => {
    expect(buildPerformanceProfile({ family: "sr", observations: [], gradeComponentHistory: [] })).toBeUndefined()
  })

  it("builds eight established Rift dimensions with bounded scores", () => {
    const profile = buildPerformanceProfile({
      family: "sr",
      observations: observations(36),
      gradeComponentHistory: history(36),
    })!

    expect(profile.dimensions).toHaveLength(8)
    expect(profile.score).toBeGreaterThanOrEqual(0)
    expect(profile.score).toBeLessThanOrEqual(100)
    expect(profile.confidence).toBe("established")
    expect(profile.dimensions.map((dimension) => dimension.key)).toEqual(expect.arrayContaining([
      "fighting",
      "survivability",
      "objectives",
      "farming",
      "vision",
      "initiative",
      "consistency",
      "versatility",
    ]))
    expect(profile.dimensions.every((dimension) => dimension.score >= 0 && dimension.score <= 100)).toBe(true)
    expect(profile.dimensions.every((dimension) => dimension.metrics.every((metric) => metric.score >= 0 && metric.score <= 100))).toBe(true)
  })

  it("steadies a small extreme sample toward neutral", () => {
    const profile = buildPerformanceProfile({
      family: "sr",
      observations: observations(4),
      gradeComponentHistory: history(4, 1),
    })!
    const combat = profile.dimensions.find((dimension) => dimension.key === "fighting")!

    expect(combat.confidence).toBe("learning")
    expect(combat.metrics[0].score).toBe(100)
    expect(combat.score).toBeGreaterThan(50)
    expect(combat.score).toBeLessThan(70)
  })

  it("shows a single match directly without applying the career-profile prior", () => {
    const singleMatch = observations(1).map((observation) => ({
      ...observation,
      metrics: {
        ...observation.metrics,
        visionPerMinute: 3.11,
      },
    }))
    const singleHistory = history(1, .9)
    const match = buildPerformanceProfile({
      family: "sr",
      observations: singleMatch,
      gradeComponentHistory: singleHistory,
      scoringContext: "match",
    })!
    const profile = buildPerformanceProfile({
      family: "sr",
      observations: singleMatch,
      gradeComponentHistory: singleHistory,
    })!
    const matchVision = match.dimensions.find((dimension) => dimension.key === "vision")!
    const profileVision = profile.dimensions.find((dimension) => dimension.key === "vision")!

    expect(matchVision.metrics.find((metric) => metric.key === "vision")?.score).toBe(90)
    expect(matchVision.metrics.find((metric) => metric.key === "visionPace")?.score).toBe(100)
    expect(matchVision.score).toBeGreaterThanOrEqual(92)
    expect(profileVision.score).toBe(53)
    expect(match.score).toBeGreaterThan(profile.score)
    expect(match.dimensions).toHaveLength(6)
    expect(match.dimensions.map((dimension) => dimension.key)).not.toEqual(
      expect.arrayContaining(["consistency", "versatility"]),
    )
    expect(match.dimensions.every((dimension) => dimension.recentScore === undefined)).toBe(true)
    expect(match.score).toBe(Math.round(
      match.dimensions.reduce((total, dimension) => total + dimension.score, 0) /
        match.dimensions.length,
    ))

    for (const dimension of match.dimensions) {
      const rawFromDisplayedMetrics = dimension.metrics.reduce(
        (total, metric) => total + metric.score * metric.weight,
        0,
      )
      expect(dimension.score).toBeCloseTo(rawFromDisplayedMetrics, 0)
    }
  })

  it("omits unavailable measurements and rebalances the remaining weights", () => {
    const available: GradeComponent["key"][] = [
      "combat", "participation", "economy", "survival", "frontlining", "objectives",
    ]
    const profile = buildPerformanceProfile({
      family: "sr",
      observations: observations(20),
      gradeComponentHistory: history(20, .7, available),
    })!
    const resources = profile.dimensions.find((dimension) => dimension.key === "farming")!

    expect(profile.dimensions.some((dimension) => dimension.key === "vision")).toBe(false)
    expect(resources.metrics.length).toBeGreaterThan(1)
    expect(resources.metrics.reduce((total, metric) => total + metric.weight, 0)).toBeCloseTo(1)
    expect(resources.score).toBeGreaterThan(50)
  })

  it("uses mode-appropriate Abyss dimensions instead of Rift vision and objectives", () => {
    const available: GradeComponent["key"][] = ["combat", "participation", "economy", "survival", "frontlining"]
    const profile = buildPerformanceProfile({
      family: "aram",
      observations: observations(30, "aram"),
      gradeComponentHistory: history(30, .65, available),
    })!
    const keys = profile.dimensions.map((dimension) => dimension.key)

    expect(keys).toHaveLength(8)
    expect(keys).toEqual(expect.arrayContaining(["sustain", "fightControl", "consistency", "versatility"]))
    expect(keys).not.toEqual(expect.arrayContaining(["vision", "objectives"]))
  })

  it("uses only match-observable Abyss dimensions for a single-match RVI", () => {
    const match = buildPerformanceProfile({
      family: "aram",
      observations: observations(1, "aram"),
      gradeComponentHistory: history(1, .65, [
        "combat", "participation", "economy", "survival", "frontlining",
      ]),
      scoringContext: "match",
    })!

    expect(match.dimensions.map((dimension) => dimension.key)).toEqual([
      "fighting",
      "survivability",
      "farming",
      "teamPresence",
      "sustain",
      "fightControl",
    ])
  })

  it("adds distinct fight signals when cached timeline evidence is available", () => {
    const timeline: RviTimelineObservation = {
      gameId: 1,
      playedAt: 0,
      durationSecs: 1800,
      participantId: 1,
      teamId: 100,
      opponentParticipantId: 6,
      summary: {
        frames: [10, 15, 20, 30].map((minute) => ({
          timestamp: minute * 60_000,
          blueGold: minute * 3_000,
          redGold: minute * 2_900,
          ownerGold: minute * 320,
          ownerLevel: Math.floor(minute / 2),
          ownerXp: minute * 400,
          ownerCs: minute * 8,
          participants: [
            { participantId: 1, teamId: 100, currentGold: 500, totalGold: minute * 320, level: 8, xp: 4_000, minionsKilled: minute * 8, jungleMinionsKilled: 0 },
            { participantId: 6, teamId: 200, currentGold: 400, totalGold: minute * 300, level: 8, xp: 3_800, minionsKilled: minute * 7, jungleMinionsKilled: 0 },
          ],
        })),
        turningPoints: [],
        events: [
          { eventId: "solo", timestamp: 120_000, type: "CHAMPION_KILL", category: "kill", participantId: 1, targetId: 6, assistingParticipantIds: [] },
          { eventId: "team", timestamp: 900_000, type: "CHAMPION_KILL", category: "kill", participantId: 2, targetId: 7, assistingParticipantIds: [1, 3] },
          { eventId: "ward", timestamp: 690_000, type: "WARD_PLACED", category: "vision", participantId: 1 },
          { eventId: "dragon", timestamp: 750_000, type: "ELITE_MONSTER_KILL", category: "objective", participantId: 1, teamId: 100, objective: "DRAGON", assistingParticipantIds: [2, 3] },
        ],
      },
    }
    const profile = buildPerformanceProfile({
      family: "sr",
      observations: observations(20),
      gradeComponentHistory: history(20),
      timelineHistory: [timeline],
    })!
    const fighting = profile.dimensions.find((dimension) => dimension.key === "fighting")!
    const objectives = profile.dimensions.find((dimension) => dimension.key === "objectives")!
    const farming = profile.dimensions.find((dimension) => dimension.key === "farming")!
    const initiative = profile.dimensions.find((dimension) => dimension.key === "initiative")!

    expect(fighting.metrics.map((metric) => metric.key)).toEqual(expect.arrayContaining(["duels", "teamfights", "picks"]))
    expect(objectives.metrics.map((metric) => metric.key)).toEqual(expect.arrayContaining(["dragons", "objectiveSecure", "objectiveVision"]))
    expect(farming.metrics.map((metric) => metric.key)).toEqual(expect.arrayContaining(["laneLead", "earlyFarm", "midFarm", "lateFarm"]))
    expect(initiative.metrics.map((metric) => metric.key)).toEqual(expect.arrayContaining(["earlyRoams", "soloPressure", "laneSnowball"]))
    expect(fighting.metrics.find((metric) => metric.key === "duels")?.games).toBe(1)
    expect(fighting.metrics.find((metric) => metric.key === "duels")!.weight)
      .toBeLessThan(fighting.metrics.find((metric) => metric.key === "combat")!.weight)
    expect(fighting.metrics.reduce((total, metric) => total + metric.weight, 0)).toBeCloseTo(1)
  })

  // Identical scoreboards on different champion classes: 54 is Malphite
  // (tank) and 22 is Ashe (marksman) in the bundled Data Dragon snapshot.
  const withShare = (games: number, championId: number) =>
    observations(games).map((observation) => ({
      ...observation,
      championId,
      metrics: { ...observation.metrics, teamDamageShare: .18 },
    }))
  const damageShareMetric = (profile: NonNullable<ReturnType<typeof buildPerformanceProfile>>) =>
    profile.dimensions.find((dimension) => dimension.key === "fighting")!
      .metrics.find((metric) => metric.key === "damageShare")!

  it("judges damage share against the champion's own class ceiling", () => {
    const tank = buildPerformanceProfile({
      family: "sr",
      observations: withShare(20, 54),
      gradeComponentHistory: history(20),
    })!
    const marksman = buildPerformanceProfile({
      family: "sr",
      observations: withShare(20, 22),
      gradeComponentHistory: history(20),
    })!

    expect(damageShareMetric(tank).score).toBeGreaterThan(damageShareMetric(marksman).score)
    expect(damageShareMetric(tank).comparison).toBe("Class-aware display scale")
  })

  it("prefers live catalog classes over the bundled snapshot", () => {
    const bundled = buildPerformanceProfile({
      family: "sr",
      observations: withShare(20, 22),
      gradeComponentHistory: history(20),
    })!
    const overridden = buildPerformanceProfile({
      family: "sr",
      observations: withShare(20, 22),
      gradeComponentHistory: history(20),
      championRoles: new Map([[22, ["tank", "support"]]]),
    })!

    expect(damageShareMetric(overridden).score).toBeGreaterThan(damageShareMetric(bundled).score)
  })

  it("keeps unknown champions on the neutral base scale", () => {
    const unknown = buildPerformanceProfile({
      family: "sr",
      observations: withShare(20, 999_999),
      gradeComponentHistory: history(20),
    })!

    expect(damageShareMetric(unknown).score).toBe(Math.round(.18 / .35 * 100))
  })
})
