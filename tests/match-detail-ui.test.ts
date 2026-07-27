import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  formatMilestone,
  formatOptionalText,
  formatStat,
  formatStatDuration,
  groupMatchSides,
  toggleExpandedParticipant,
} from "../src/helpers/match-detail.js"
import type { MatchDetail, ParticipantRow } from "../src/types/stats.js"

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

describe("groupMatchSides", () => {
  it("lists the local player's team first and attaches team summaries", () => {
    const detail: MatchDetail = {
      participants: [participant(6, 200), participant(1, 100, 1)],
      teams: [
        { gameId: 1, puuid: "owner", teamId: 200, win: 0, bans: "[]", baronKills: 0, dragonKills: 0, heraldKills: 0, hordeKills: 0, towerKills: 0, inhibitorKills: 0, firstBlood: 0, firstTower: 0, firstBaron: 0, firstDragon: 0, firstInhibitor: 0 },
        { gameId: 1, puuid: "owner", teamId: 100, win: 1, bans: "[]", baronKills: 0, dragonKills: 0, heraldKills: 0, hordeKills: 0, towerKills: 1, inhibitorKills: 0, firstBlood: 0, firstTower: 1, firstBaron: 0, firstDragon: 0, firstInhibitor: 0 },
      ],
    }

    const sides = groupMatchSides(detail)

    expect(sides.map((side) => side.teamId)).toEqual([100, 200])
    expect(sides[0].team?.towerKills).toBe(1)
    expect(sides[0].won).toBe(true)
  })
})

describe("toggleExpandedParticipant", () => {
  it("replaces the expanded player only on the same team", () => {
    let state = toggleExpandedParticipant({}, 100, 1)
    state = toggleExpandedParticipant(state, 200, 6)
    state = toggleExpandedParticipant(state, 100, 2)

    expect(state).toEqual({ 100: 2, 200: 6 })
  })

  it("collapses a player when selected again", () => {
    const open = toggleExpandedParticipant({}, 100, 1)
    expect(toggleExpandedParticipant(open, 100, 1)).toEqual({})
  })
})

describe("advanced stat formatting", () => {
  it("groups integers and preserves zero", () => {
    expect(formatStat(12_345)).toBe("12,345")
    expect(formatStat(0)).toBe("0")
  })

  it("formats durations, milestones, and absent text", () => {
    expect(formatStatDuration(125)).toBe("2:05")
    expect(formatMilestone(1)).toBe("Yes")
    expect(formatMilestone(0)).toBe("No")
    expect(formatOptionalText("")).toBe("—")
    expect(formatOptionalText("MIDDLE")).toBe("MIDDLE")
  })
})

describe("match detail component contract", () => {
  it("keeps the detail IPC request in MatchSheet only", () => {
    const sheet = readFileSync("src/components/MatchSheet.vue", "utf8")
    const scoreboard = readFileSync("src/components/MatchDetail.vue", "utf8")

    expect(sheet.match(/getMatchDetail\(/g)).toHaveLength(1)
    expect(scoreboard).not.toContain("getMatchDetail(")
  })

  it("renders accessible controls and every advanced stat group", () => {
    const scoreboard = readFileSync("src/components/MatchDetail.vue", "utf8")

    expect(scoreboard).toContain(":aria-expanded=")
    expect(scoreboard).toContain("Combat")
    expect(scoreboard).toContain("Economy &amp; farming")
    expect(scoreboard).toContain("Vision")
    expect(scoreboard).toContain("Objectives")
    expect(scoreboard).toContain("Multikills &amp; survival")
    expect(scoreboard).toContain("Setup")
  })

  it("resets expanded players when the displayed match changes", () => {
    const scoreboard = readFileSync("src/components/MatchDetail.vue", "utf8")

    expect(scoreboard).toContain("watch(() => props.detail")
    expect(scoreboard).toContain("expanded.value = {}")
  })
})
