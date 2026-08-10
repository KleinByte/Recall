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
        { style: 8100, selections: [{ perk: 8112, var1: 2840, var2: 12 }, { perk: 8126 }] },
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
    damageDealtToTurrets: 0,
    timeCCingOthers: 0,
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
      gradeCoreComplete: 1,
      gradeCoreSource: "match_v5",
      gradeCoreMissingFields: [],
      runeSelections: expect.arrayContaining([
        expect.objectContaining({ runeId: 8112, var1: 2840, var2: 12 }),
      ]),
    })
    expect(result.teams[0]).toMatchObject({
      firstBlood: 1,
      firstTower: 1,
      towerKills: 2,
    })
  })

  it("flags absent or malformed core fields before numeric fallback coercion", () => {
    const dto = match()
    dto.info.participants[0] = participant(1, {
      kills: undefined,
      visionScore: Number.NaN,
    })

    const row = mapRiotMatch(dto, PUUID)!.participants[0]

    expect(row.kills).toBe(0)
    expect(row.visionScore).toBe(0)
    expect(row.gradeCoreComplete).toBe(0)
    expect(row.gradeCoreSource).toBe("match_v5")
    expect(row.gradeCoreMissingFields).toEqual(["kills", "vision_score"])
  })

  it("keeps an explicit all-zero core line eligible for completeness", () => {
    const dto = match()
    dto.info.participants[0] = participant(1, {
      kills: 0,
      deaths: 0,
      assists: 0,
      goldEarned: 0,
      totalDamageDealtToChampions: 0,
      totalMinionsKilled: 0,
      neutralMinionsKilled: 0,
      damageDealtToObjectives: 0,
      damageDealtToTurrets: 0,
      timeCCingOthers: 0,
      visionScore: 0,
    })

    const row = mapRiotMatch(dto, PUUID)!.participants[0]

    expect(row.gradeCoreComplete).toBe(1)
    expect(row.gradeCoreMissingFields).toEqual([])
  })

  it("captures Match-V5 augments and schema drift across the whole lobby", () => {
    const dto = match()
    dto.info.participants = dto.info.participants.map((entry, index) => ({
      ...entry,
      playerAugment1: 1000 + index,
      playerAugment2: 2000 + index,
      newlyAddedRiotMetric: index,
    }))

    const result = mapRiotMatch(dto, PUUID)!

    expect(result.participants).toHaveLength(10)
    expect(result.participants[9].augments?.map((augment) => augment.augmentId))
      .toEqual([1009, 2009])
    expect(result.unknownParticipantFields).toContain("newlyAddedRiotMetric")
  })

  it("separates Recall's local owner key from Riot's participant PUUID", () => {
    const result = mapRiotMatch(
      match(),
      "local-client-uuid",
      undefined,
      PUUID,
    )!

    expect(result.match.puuid).toBe("local-client-uuid")
    expect(result.participants[0]).toMatchObject({
      puuid: "local-client-uuid",
      participantPuuid: PUUID,
      isPlayer: 1,
    })
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

  it("marks inconsistent duration sources instead of trusting a bad rate denominator", () => {
    const start = 1_700_000_000_000
    const verified = mapRiotMatch(match({
      gameStartTimestamp: start,
      gameEndTimestamp: start + 1_200_000,
      gameDuration: 1_200,
    }), PUUID)!
    const inconsistent = mapRiotMatch(match({
      gameStartTimestamp: start,
      gameEndTimestamp: start + 600_000,
      gameDuration: 1_200,
    }), PUUID)!

    expect(verified.match.durationQuality).toBe("verified")
    expect(inconsistent.match.durationQuality).toBe("inconsistent")
  })

  it("rejects payloads that do not contain the requested player", () => {
    expect(mapRiotMatch(match(), "missing")).toBeUndefined()
  })

  it("prefers teamPosition over individualPosition for stored role", () => {
    const dto = match({
      participants: Array.from({ length: 10 }, (_, i) =>
        participant(i + 1, {
          teamPosition: "MIDDLE",
          individualPosition: "UTILITY",
        }),
      ),
    })

    const result = mapRiotMatch(dto, PUUID)!

    expect(result.participants[0].role).toBe("MIDDLE")
    expect(result.match.role).toBe("MIDDLE")
  })

  it("falls back from an invalid team position to the individual estimate", () => {
    const dto = match({
      participants: Array.from({ length: 10 }, (_, i) =>
        participant(i + 1, {
          teamPosition: "Invalid",
          individualPosition: "UTILITY",
        }),
      ),
    })

    const result = mapRiotMatch(dto, PUUID)!

    expect(result.participants[0].role).toBe("UTILITY")
  })

  it("keeps a legacy bottom support hint when positions are unavailable", () => {
    const dto = match({
      participants: Array.from({ length: 10 }, (_, i) =>
        participant(i + 1, {
          teamPosition: undefined,
          individualPosition: undefined,
          lane: "BOTTOM",
          role: "SUPPORT",
        }),
      ),
    })

    const result = mapRiotMatch(dto, PUUID)!

    expect(result.participants[0].role).toBe("SUPPORT")
  })
})
