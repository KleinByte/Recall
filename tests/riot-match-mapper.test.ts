import { describe, expect, it } from "vitest"
import {
  mapRiotMatch,
  type RiotMatchDto,
  type RiotMatchParticipant,
} from "../electron/main/riot/match-mapper.js"

const PUUID = "owner"

function participant(
  participantId: number,
  overrides: Partial<RiotMatchParticipant> = {},
): RiotMatchParticipant {
  return {
    participantId,
    puuid: participantId === 1 ? PUUID : `player-${participantId}`,
    riotIdGameName: `Player ${participantId}`,
    riotIdTagline: "NA1",
    championId: 80 + participantId,
    teamId: participantId <= 5 ? 100 : 200,
    win: participantId <= 5,
    summoner1Id: 4,
    summoner2Id: 32,
    item0: 1001,
    perks: {
      styles: [
        { style: 8100, selections: [{ perk: 8112 }, { perk: 8126 }] },
        { style: 8300, selections: [{ perk: 8345 }] },
      ],
    },
    champLevel: 18,
    kills: 10,
    deaths: 5,
    assists: 15,
    goldEarned: 12_000,
    totalDamageDealtToChampions: 20_000,
    totalDamageTaken: 10_000,
    totalMinionsKilled: 50,
    neutralMinionsKilled: 10,
    visionScore: 20,
    damageDealtToObjectives: 2_000,
    teamPosition: "MIDDLE",
    ...overrides,
  }
}

function match(overrides: Partial<NonNullable<RiotMatchDto["info"]>> = {}) {
  return {
    metadata: { matchId: "NA1_123" },
    info: {
      gameId: 123,
      gameStartTimestamp: 1_700_000_000_000,
      gameDuration: 1_200,
      gameMode: "ARAM",
      gameType: "MATCHED_GAME",
      gameVersion: "16.1",
      queueId: 450,
      mapId: 12,
      participants: Array.from({ length: 10 }, (_, index) =>
        participant(index + 1),
      ),
      teams: [
        {
          teamId: 100,
          win: true,
          bans: [],
          objectives: {
            champion: { first: true, kills: 30 },
            tower: { first: true, kills: 2 },
          },
        },
        { teamId: 200, win: false, bans: [], objectives: {} },
      ],
      ...overrides,
    },
  } satisfies RiotMatchDto
}

describe("mapRiotMatch", () => {
  it("maps the owner, full scoreboard, teams, and perks", () => {
    const result = mapRiotMatch(match(), PUUID)!

    expect(result.match).toMatchObject({
      gameId: 123,
      puuid: PUUID,
      mode: "aram",
      championId: 81,
      kills: 10,
      playedAt: 1_700_000_000_000,
    })
    expect(result.participants).toHaveLength(10)
    expect(result.participants[0]).toMatchObject({
      isPlayer: 1,
      summonerName: "Player 1#NA1",
      perkPrimaryStyle: 8100,
      perkSubStyle: 8300,
      perks: [8112, 8126, 8345, 0, 0, 0],
    })
    expect(result.teams[0]).toMatchObject({
      firstBlood: 1,
      firstTower: 1,
      towerKills: 2,
    })
    expect(result.gradeInputs).toHaveLength(10)
  })

  it("normalises old millisecond durations and retains other modes", () => {
    const result = mapRiotMatch(
      match({
        gameDuration: 1_200_000,
        gameMode: "CHERRY",
        queueId: 1700,
        mapId: 30,
      }),
      PUUID,
    )!

    expect(result.match.durationSecs).toBe(1_200)
    expect(result.match.mode).toBe("other")
    expect(result.match.modeFamily).toBe("other")
  })

  it("rejects payloads that do not contain the requested player", () => {
    expect(mapRiotMatch(match(), "missing")).toBeUndefined()
  })
})
