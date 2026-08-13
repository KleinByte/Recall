import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  lobbyStandings,
  teamTotals,
} from "../src/helpers/match-detail.js"
import type { ParticipantRow } from "../src/types/stats.js"

const participant = (
  participantId: number,
  teamId: number,
  isPlayer = 0,
): ParticipantRow => ({
  gameId: 1,
  puuid: "owner",
  participantId,
  teamId,
  isPlayer,
  championId: participantId,
  win: teamId === 100 ? 1 : 0,
  profileIcon: 0,
  spell1Id: 4,
  spell2Id: 14,
  items: [0, 0, 0, 0, 0, 0, 0],
  perkPrimaryStyle: 8000,
  perkSubStyle: 8100,
  perks: [8005, 9111],
  champLevel: 18,
  kills: 1,
  deaths: 2,
  assists: 3,
  goldEarned: 12_345,
  goldSpent: 11_000,
  damageToChampions: 20_000,
  totalDamageDealt: 50_000,
  magicDamageToChampions: 5_000,
  physicalDamageToChampions: 14_000,
  trueDamageToChampions: 1_000,
  damageTaken: 10_000,
  damageSelfMitigated: 4_000,
  totalHeal: 500,
  totalUnitsHealed: 1,
  timeCcingOthers: 12,
  largestKillingSpree: 2,
  largestMultiKill: 2,
  doubleKills: 1,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 100,
  neutralMinions: 10,
  visionScore: 20,
  wardsPlaced: 8,
  wardsKilled: 2,
  controlWards: 1,
  damageObjectives: 3_000,
  damageTurrets: 1_000,
  turretKills: 1,
  inhibitorKills: 0,
  longestTimeLiving: 125,
  firstBlood: 0,
  firstTower: 1,
  lane: "MIDDLE",
  role: "SOLO",
})

describe("teamTotals", () => {
  it("adds up every contribution on a side", () => {
    const totals = teamTotals([participant(1, 100), participant(2, 100)])

    expect(totals.kills).toBe(2)
    expect(totals.gold).toBe(24_690)
    expect(totals.damage).toBe(40_000)
    expect(totals.cs).toBe(220)
    expect(totals.vision).toBe(40)
  })
})

describe("lobbyStandings", () => {
  const graded = (participantId: number, recallScore: number) => ({
    ...participant(participantId, participantId <= 5 ? 100 : 200),
    recallScore,
  })

  it("places the best graded player first and the worst last", () => {
    const rows = [graded(1, 30), graded(2, 90), graded(6, 60)]

    const standings = lobbyStandings(rows)

    expect(standings.get(2)).toEqual({ place: 1, of: 3 })
    expect(standings.get(6)?.place).toBe(2)
    expect(standings.get(1)).toEqual({ place: 3, of: 3 })
  })

  it("breaks ties without giving two players the same place", () => {
    const standings = lobbyStandings([graded(6, 60), graded(1, 60)])

    expect([...standings.values()].map((entry) => entry.place)).toEqual([1, 2])
  })

  it("stays empty when any player in the lobby is ungraded", () => {
    const rows = [graded(1, 85), participant(2, 100)]

    expect(lobbyStandings(rows).size).toBe(0)
  })
})

describe("current match review component contract", () => {
  it("loads the unified review payload and passes its scoreboard down", () => {
    const review = readFileSync("src/pages/ReviewPage.vue", "utf8")
    const reviewData = readFileSync("src/features/review/use-review-page-data.ts", "utf8")
    const scoreboard = readFileSync("src/components/ReviewScoreboard.vue", "utf8")

    expect(review).toContain("useReviewPageData")
    expect(reviewData).toContain("review.value = target ? await api.getMatchReview(target) : undefined")
    expect(review).toContain("<ReviewScoreboard")
    expect(review).toContain(':participants="review.scoreboard"')
    expect(review).toContain(':teams="review.teams"')
    expect(scoreboard).not.toContain("api.")
  })

  it("renders interactive setup and every advanced stat group", () => {
    const scoreboard = readFileSync("src/components/ReviewScoreboard.vue", "utf8")
    const stats = readFileSync("src/components/MatchStatsTable.vue", "utf8")
    const runePage = readFileSync("src/components/RunePage.vue", "utf8")

    expect(scoreboard).toContain("<RunePage")
    expect(scoreboard).toContain(":classic=\"match.modeFamily === 'classic'\"")
    expect(stats).toContain('label: "Combat"')
    expect(stats).toContain('label: "Damage dealt"')
    expect(stats).toContain('label: "Damage taken and healed"')
    expect(stats).toContain('label: "Economy"')
    expect(stats).toContain('label: "Vision"')
    expect(stats).toContain('label: "Objectives"')
    expect(runePage).toContain('<Teleport to="body">')
    expect(runePage).toContain("window.addEventListener(\"scroll\", placePopover, true)")
    expect(runePage).toContain("classic-rune-board.webp")
    expect(runePage).toContain("classic-masteries-empty.webp")
    expect(runePage).toContain("Mastery allocations not captured")
  })

  it("resets expanded review content when the displayed match changes", () => {
    const hero = readFileSync("src/components/MatchReviewHero.vue", "utf8")

    expect(hero).toContain("watch(() => props.review.match.gameId")
    expect(hero).toContain("showAllRecords.value = false")
    expect(hero).toContain("showAllLabels.value = false")
  })

  it("shows lobby placement and marks the MVP in both summary and scoreboard", () => {
    const scoreboard = readFileSync("src/components/ReviewScoreboard.vue", "utf8")
    const hero = readFileSync("src/components/MatchReviewHero.vue", "utf8")

    expect(scoreboard).toContain('if (value === 1) return "MVP"')
    expect(scoreboard).toContain(":class=\"{ mvp: place(row) === 1 }\"")
    expect(hero).toContain("standing?.place === 1")
    expect(hero).toContain('class="mvp-badge"')
  })

  it("labels the scoreboard columns and compares team totals", () => {
    const scoreboard = readFileSync("src/components/ReviewScoreboard.vue", "utf8")

    expect(scoreboard).toContain('aria-label="Complete match scoreboard"')
    expect(scoreboard).toContain("Player</span><span>Lobby</span><span>Role</span>")
    expect(scoreboard).toContain("teamTotals(players(teamId))")
    expect(scoreboard).toContain('class="team-objectives"')
    expect(scoreboard).toContain('class="team-bans"')
  })
})
