import { describe, expect, it } from "vitest"
import {
  confidenceOf,
  durationBucketsFor,
  matchAxes,
  pickBestAndWorst,
  rankChampions,
  shrinkToward,
} from "../electron/main/matches/insights.js"
import type { ChampionStatRow } from "../electron/main/database/matches-repo.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"

const champion = (
  overrides: Partial<ChampionStatRow> = {},
): ChampionStatRow => ({
  championId: 1,
  games: 3,
  wins: 2,
  winRate: 2 / 3,
  avgKills: 5,
  avgDeaths: 5,
  avgAssists: 10,
  kda: 3,
  avgDamageToChampions: 20000,
  avgGradeScore: 0,
  gradedGames: 3,
  ...overrides,
})

describe("shrinkToward", () => {
  it("leaves a large sample almost untouched", () => {
    expect(shrinkToward(2, 60, 0)).toBeCloseTo(1.9, 1)
  })

  it("pulls a single game most of the way back", () => {
    // One game at 2.0 against a baseline of 0: (1 * 2 + 3 * 0) / 4
    expect(shrinkToward(2, 1, 0)).toBeCloseTo(0.5)
  })

  it("returns the baseline when there are no games", () => {
    expect(shrinkToward(2, 0, 0.4)).toBeCloseTo(0.4)
  })
})

describe("confidenceOf", () => {
  it("labels the sample honestly", () => {
    expect(confidenceOf(1)).toBe("thin")
    expect(confidenceOf(4)).toBe("thin")
    expect(confidenceOf(5)).toBe("fair")
    expect(confidenceOf(11)).toBe("fair")
    expect(confidenceOf(12)).toBe("solid")
  })
})

describe("rankChampions", () => {
  it("ranks sustained performance above one extreme game", () => {
    const ranked = rankChampions(
      [
        champion({ championId: 40, games: 1, avgGradeScore: 1.97, gradedGames: 1 }),
        champion({ championId: 110, games: 8, avgGradeScore: 1.0, gradedGames: 8 }),
      ],
      0,
    )

    expect(ranked[0].championId).toBe(110)
  })

  it("pulls a single outlier most of the way back to the player's average", () => {
    const [only] = rankChampions(
      [champion({ championId: 40, games: 1, avgGradeScore: 2.0, gradedGames: 1 })],
      0,
    )

    // Reported as 0.5 rather than 2.0: one game is weak evidence.
    expect(only.adjustedGrade).toBeCloseTo(0.5)
    expect(only.rawGrade).toBe(2.0)
  })

  it("does not exclude a champion for a thin sample", () => {
    const ranked = rankChampions([champion({ games: 1, gradedGames: 1 })], 0)

    expect(ranked).toHaveLength(1)
    expect(ranked[0].confidence).toBe("thin")
  })

  it("treats an ungraded champion as average rather than best", () => {
    const ranked = rankChampions(
      [
        champion({ championId: 7, avgGradeScore: undefined, gradedGames: 0 }),
        champion({ championId: 8, avgGradeScore: 0.5, gradedGames: 3 }),
      ],
      0,
    )

    expect(ranked[0].championId).toBe(8)
  })

  it("keeps a losing champion out of the top spot", () => {
    // The real defect: three games at -0.39 was being called a best champion.
    const ranked = rankChampions(
      [
        champion({ championId: 31, games: 3, avgGradeScore: -0.39, gradedGames: 3 }),
        champion({ championId: 147, games: 2, avgGradeScore: 1.49, gradedGames: 2 }),
      ],
      0.2,
    )

    expect(ranked[0].championId).toBe(147)
  })
})

describe("pickBestAndWorst", () => {
  it("never puts the same champion in both lists", () => {
    const ranked = rankChampions(
      [1, 2, 3, 4].map((id) =>
        champion({ championId: id, avgGradeScore: id * 0.1 }),
      ),
      0,
    )

    const { best, worst } = pickBestAndWorst(ranked, 3)
    const overlap = best.filter((row) =>
      worst.some((other) => other.championId === row.championId),
    )

    expect(overlap).toEqual([])
  })

  it("gives nothing to the worst list when there is too little to split", () => {
    const ranked = rankChampions([champion({ championId: 1 })], 3)

    expect(pickBestAndWorst(ranked, 3).worst).toEqual([])
  })

  it("orders worst from the poorest upward", () => {
    const ranked = rankChampions(
      [1, 2, 3, 4, 5, 6].map((id) =>
        champion({ championId: id, avgGradeScore: id * 0.1 }),
      ),
      0,
    )

    const { worst } = pickBestAndWorst(ranked, 2)

    expect(worst[0].adjustedGrade).toBeLessThan(worst[1].adjustedGrade)
  })
})

describe("durationBucketsFor", () => {
  it("uses shorter bands on the Howling Abyss", () => {
    expect(durationBucketsFor("aram").map((b) => b.maxSecs)).toEqual([
      720,
      960,
      1200,
      Number.MAX_SAFE_INTEGER,
    ])
  })

  it("uses longer bands on the Rift", () => {
    expect(durationBucketsFor("sr").map((b) => b.maxSecs)).toEqual([
      1320,
      1680,
      2040,
      Number.MAX_SAFE_INTEGER,
    ])
  })

  it("labels every band", () => {
    for (const bucket of durationBucketsFor("sr")) {
      expect(bucket.label.length).toBeGreaterThan(0)
    }
  })
})

const participant = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: "p",
  participantId: 1,
  teamId: 100,
  isPlayer: 1,
  championId: 84,
  win: 1,
  profileIcon: 0,
  spell1Id: 0,
  spell2Id: 0,
  items: [0, 0, 0, 0, 0, 0, 0],
  perkPrimaryStyle: 0,
  perkSubStyle: 0,
  perks: [0, 0, 0, 0, 0, 0],
  champLevel: 18,
  kills: 10,
  deaths: 5,
  assists: 10,
  goldEarned: 12000,
  goldSpent: 11000,
  damageToChampions: 30000,
  totalDamageDealt: 90000,
  magicDamageToChampions: 0,
  physicalDamageToChampions: 0,
  trueDamageToChampions: 0,
  damageTaken: 10000,
  damageSelfMitigated: 10000,
  totalHeal: 2000,
  totalUnitsHealed: 1,
  timeCcingOthers: 20,
  largestKillingSpree: 3,
  largestMultiKill: 2,
  doubleKills: 1,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 100,
  neutralMinions: 0,
  visionScore: 20,
  wardsPlaced: 5,
  wardsKilled: 1,
  controlWards: 1,
  damageObjectives: 5000,
  damageTurrets: 2000,
  turretKills: 1,
  inhibitorKills: 0,
  longestTimeLiving: 300,
  firstBlood: 0,
  firstTower: 0,
  ...overrides,
})

describe("matchAxes", () => {
  it("scores a single game on the same axes as a career", () => {
    const axes = matchAxes(participant(), 1200, "sr")

    expect(axes.map((axis) => axis.key)).toEqual([
      "aggression",
      "damage",
      "durability",
      "farming",
      "objectives",
      "vision",
    ])
  })

  it("reads aggression as the share of involvement that was a kill", () => {
    const axes = matchAxes(participant({ kills: 10, assists: 10 }), 1200, "sr")

    expect(axes.find((a) => a.key === "aggression")!.value).toBeCloseTo(0.5)
  })

  it("never draws outside the ring", () => {
    const axes = matchAxes(
      participant({ visionScore: 9999, timeCcingOthers: 9999 }),
      600,
      "sr",
    )

    for (const axis of axes) {
      expect(axis.value).toBeGreaterThanOrEqual(0)
      expect(axis.value).toBeLessThanOrEqual(1)
    }
  })

  it("survives a game with nothing in it", () => {
    const axes = matchAxes(
      participant({
        kills: 0,
        assists: 0,
        goldEarned: 0,
        damageTaken: 0,
        damageToChampions: 0,
        damageSelfMitigated: 0,
        totalHeal: 0,
      }),
      0,
      "aram",
    )

    for (const axis of axes) {
      expect(Number.isFinite(axis.value)).toBe(true)
    }
  })
})
