import { describe, expect, it } from "vitest"
import { GRADES, gradeMatch } from "../electron/main/matches/grade.js"
import type { GradeInput } from "../electron/main/matches/grade.js"

/** A baseline ARAM performance used to build a believable lobby. */
const player = (overrides: Partial<GradeInput> = {}): GradeInput => ({
  participantId: 1,
  teamId: 100,
  kills: 5,
  deaths: 5,
  assists: 15,
  damageToChampions: 20000,
  damageTaken: 20000,
  goldEarned: 10000,
  ...overrides,
})

/** Ten players with identical output, so nobody stands out. */
const evenLobby = (): GradeInput[] =>
  Array.from({ length: 10 }, (_, index) =>
    player({ participantId: index + 1, teamId: index < 5 ? 100 : 200 }),
  )

const gradeAram = (lobby: GradeInput[], id: number) =>
  gradeMatch(lobby, id, "aram")!

describe("gradeMatch", () => {
  it("explains the exact composite used by the grade", () => {
    const result = gradeAram(evenLobby(), 1)
    expect(result.breakdown.components.map((component) => component.key)).toEqual([
      "combat",
      "participation",
      "economy",
      "survival",
      "frontlining",
    ])
    expect(
      result.breakdown.components.reduce(
        (sum, component) => sum + component.contribution,
        0,
      ),
    ).toBeCloseTo(.45)
    expect(result.percentile).toBe(.5)
  })
  it("gives an average grade when everyone performed identically", () => {
    const lobby = evenLobby()

    const result = gradeAram(lobby, 1)

    expect(result.grade).toBe("B+")
  })

  it("awards the top grade to a dominant carry", () => {
    const lobby = evenLobby()
    lobby[0] = player({
      participantId: 1,
      kills: 25,
      deaths: 1,
      assists: 20,
      damageToChampions: 60000,
      goldEarned: 18000,
    })

    expect(gradeAram(lobby, 1).grade).toBe("S+")
  })

  it("awards the lowest grade to a clearly poor game", () => {
    const lobby = evenLobby()
    lobby[0] = player({
      participantId: 1,
      kills: 0,
      deaths: 18,
      assists: 1,
      damageToChampions: 2000,
      damageTaken: 30000,
      goldEarned: 5000,
    })

    expect(gradeAram(lobby, 1).grade).toBe("D")
  })

  it("ranks a strong player above a weak one in the same lobby", () => {
    const lobby = evenLobby()
    lobby[0] = player({
      participantId: 1,
      kills: 15,
      deaths: 2,
      assists: 20,
      damageToChampions: 40000,
    })
    lobby[1] = player({
      participantId: 2,
      kills: 1,
      deaths: 12,
      assists: 3,
      damageToChampions: 6000,
    })

    const strong = gradeAram(lobby, 1)
    const weak = gradeAram(lobby, 2)

    expect(strong.score).toBeGreaterThan(weak.score)
    expect(GRADES.indexOf(strong.grade)).toBeLessThan(
      GRADES.indexOf(weak.grade),
    )
  })

  it("credits a tank who absorbs damage rather than dealing it", () => {
    const lobby = evenLobby()
    const carryish = player({
      participantId: 1,
      damageToChampions: 26000,
      damageTaken: 20000,
    })
    const tank = player({
      participantId: 2,
      damageToChampions: 20000,
      damageTaken: 46000,
      assists: 22,
    })
    lobby[0] = carryish
    lobby[1] = tank

    expect(gradeAram(lobby, 2).score).toBeGreaterThan(
      gradeAram(lobby, 1).score,
    )
  })

  it("survives a deathless game without dividing by zero", () => {
    const lobby = evenLobby()
    lobby[0] = player({ participantId: 1, kills: 10, deaths: 0, assists: 10 })

    const result = gradeAram(lobby, 1)

    expect(Number.isFinite(result.score)).toBe(true)
    expect(GRADES).toContain(result.grade)
  })

  it("returns undefined when the player is not in the lobby", () => {
    expect(gradeAram(evenLobby(), 99)).toBeUndefined()
  })

  it("returns undefined for an incomplete lobby", () => {
    expect(gradeAram([player()], 1)).toBeUndefined()
  })

  it("only ever returns a known grade", () => {
    const lobby = evenLobby()

    for (let id = 1; id <= 10; id += 1) {
      expect(GRADES).toContain(gradeAram(lobby, id)!.grade)
    }
  })
})

/** A Summoner's Rift player, with the statistics that mode rewards. */
const riftPlayer = (overrides: Partial<GradeInput> = {}): GradeInput => ({
  participantId: 1,
  teamId: 100,
  kills: 5,
  deaths: 5,
  assists: 10,
  damageToChampions: 20000,
  damageTaken: 20000,
  goldEarned: 12000,
  csPerMin: 6,
  visionScore: 20,
  damageObjectives: 8000,
  role: "SOLO",
  ...overrides,
})

const evenRiftLobby = (): GradeInput[] =>
  Array.from({ length: 10 }, (_, index) =>
    riftPlayer({ participantId: index + 1, teamId: index < 5 ? 100 : 200 }),
  )

describe("gradeMatch — Summoner's Rift", () => {
  it("rewards farming on the Rift but ignores it in ARAM", () => {
    const lobby = evenRiftLobby()
    lobby[0] = riftPlayer({ participantId: 1, csPerMin: 11 })

    expect(gradeMatch(lobby, 1, "sr")!.score).toBeGreaterThan(0.2)
    expect(gradeMatch(lobby, 1, "aram")!.score).toBeCloseTo(0)
  })

  it("rewards vision control", () => {
    const lobby = evenRiftLobby()
    lobby[0] = riftPlayer({ participantId: 1, visionScore: 70 })

    expect(gradeMatch(lobby, 1, "sr")!.score).toBeGreaterThan(0)
  })

  it("rewards objective damage", () => {
    const lobby = evenRiftLobby()
    lobby[0] = riftPlayer({ participantId: 1, damageObjectives: 40000 })

    expect(gradeMatch(lobby, 1, "sr")!.score).toBeGreaterThan(0)
  })

  it("does not punish a support for farming less than the carries", () => {
    // Carries farm heavily; supports do not. Judged on raw creep score a
    // support looks terrible, which is exactly the distortion to avoid.
    const lobby: GradeInput[] = []
    for (let index = 0; index < 10; index += 1) {
      const isSupport = index % 5 === 4
      lobby.push(
        riftPlayer({
          participantId: index + 1,
          teamId: index < 5 ? 100 : 200,
          role: isSupport ? "DUO_SUPPORT" : "SOLO",
          csPerMin: isSupport ? 1 : 8,
          visionScore: isSupport ? 60 : 18,
          goldEarned: isSupport ? 8000 : 14000,
        }),
      )
    }

    const supportId = 5
    expect(gradeMatch(lobby, supportId, "sr")!.grade).not.toBe("D")
  })

  it("still separates a good support from a poor one", () => {
    const lobby: GradeInput[] = []
    for (let index = 0; index < 10; index += 1) {
      const isSupport = index % 5 === 4
      lobby.push(
        riftPlayer({
          participantId: index + 1,
          teamId: index < 5 ? 100 : 200,
          role: isSupport ? "DUO_SUPPORT" : "SOLO",
          csPerMin: isSupport ? 1 : 8,
          visionScore: isSupport ? 40 : 18,
          assists: isSupport ? 10 : 10,
        }),
      )
    }

    // Participant 5 wards far more than the other support.
    lobby[4] = riftPlayer({
      ...lobby[4],
      visionScore: 90,
      assists: 22,
    })

    expect(gradeMatch(lobby, 5, "sr")!.score).toBeGreaterThan(
      gradeMatch(lobby, 10, "sr")!.score,
    )
  })

  it("falls back to raw values when role data is missing", () => {
    const lobby = evenRiftLobby().map((entry) => ({
      ...entry,
      role: undefined,
    }))

    expect(gradeMatch(lobby, 1, "sr")).toBeDefined()
  })

  it("handles a role held by only one player", () => {
    const lobby = evenRiftLobby()
    lobby[0] = riftPlayer({ participantId: 1, role: "DUO_SUPPORT" })

    expect(gradeMatch(lobby, 1, "sr")).toBeDefined()
  })
})
