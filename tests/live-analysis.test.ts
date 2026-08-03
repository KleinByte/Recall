import { describe, expect, it } from "vitest"
import {
  estimatePlayerGold,
  LiveTempoTracker,
} from "../electron/main/live-analysis.js"
import type {
  LiveGamePlayer,
  LiveGameSnapshot,
} from "../electron/main/game-client.js"

function player(
  riotId: string,
  team: "ORDER" | "CHAOS",
  overrides: Partial<LiveGamePlayer> = {},
): LiveGamePlayer {
  return {
    championName: riotId,
    riotId,
    team,
    level: 10,
    isDead: false,
    respawnTimer: 0,
    isLocal: riotId === "Owner#NA1",
    scores: { kills: 1, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    items: [{
      itemId: 3078,
      name: "Trinity Force",
      count: 1,
      price: 3_333,
      canUse: false,
      consumable: false,
    }],
    summonerSpells: ["Flash", "Teleport"],
    ...overrides,
  }
}

function snapshot(
  gameTime: number,
  allyOverrides: Partial<LiveGamePlayer> = {},
  enemyOverrides: Partial<LiveGamePlayer> = {},
): LiveGameSnapshot {
  return {
    available: true,
    gameTime,
    gameMode: "CLASSIC",
    mapNumber: 11,
    localTeam: "ORDER",
    activePlayer: {
      riotId: "Owner#NA1",
      championName: "Owner",
      currentGold: 900,
      level: 10,
      abilityHaste: 0,
    },
    allies: Array.from({ length: 5 }, (_, index) => player(
      index === 0 ? "Owner#NA1" : `Ally${index}#NA1`,
      "ORDER",
      index === 0 ? allyOverrides : {},
    )),
    enemies: Array.from({ length: 5 }, (_, index) => player(
      `Enemy${index}#NA1`,
      "CHAOS",
      index === 0 ? enemyOverrides : {},
    )),
    events: [],
    updatedAt: 1_000_000 + gameTime * 1_000,
  }
}

describe("live resource and tempo analysis", () => {
  it("uses visible inventory as a symmetric lower bound", () => {
    const richInventory = player("Owner#NA1", "ORDER", {
      scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
      items: [{
        itemId: 1,
        name: "Expensive item",
        count: 2,
        price: 2_000,
        canUse: false,
        consumable: false,
      }],
    })

    expect(estimatePlayerGold(richInventory, 60)).toBe(4_000)
  })

  it("starts neutral and reports a strong complete-roster estimate after eight minutes", () => {
    const analysis = new LiveTempoTracker().update(snapshot(600))

    expect(analysis?.resources).toMatchObject({
      difference: 0,
      quality: "strong",
      source: "estimated",
    })
    expect(analysis?.winConfidence.percent).toBe(50)
    expect(analysis?.tempo).toMatchObject({ score: 50, label: "Stable" })
  })

  it("raises win confidence and tempo while the local team builds a lead", () => {
    const tracker = new LiveTempoTracker()
    tracker.update(snapshot(600))
    const analysis = tracker.update(snapshot(612, {
      scores: { kills: 4, deaths: 1, assists: 5, creepScore: 82, wardScore: 4 },
    }))

    expect(analysis!.resources.difference).toBeGreaterThan(1_000)
    expect(analysis!.winConfidence.percent).toBeGreaterThan(55)
    expect(analysis!.tempo.score).toBeGreaterThan(50)
    expect(analysis!.tempo.direction).toBe("up")
  })

  it("penalizes a throw window after holding a lead", () => {
    const tracker = new LiveTempoTracker()
    tracker.update(snapshot(600, {
      scores: { kills: 7, deaths: 1, assists: 6, creepScore: 100, wardScore: 4 },
    }))
    const thrown = tracker.update(snapshot(612, {}, {
      scores: { kills: 8, deaths: 1, assists: 6, creepScore: 105, wardScore: 4 },
    }))

    expect(thrown!.tempo.score).toBeLessThan(50)
    expect(thrown!.tempo.direction).toBe("down")
    expect(thrown!.tempo.factors.join(" ")).toMatch(/swing|trade|returned/i)
  })

  it.each([
    [2, "gold", "Double Kill"],
    [3, "emerald", "Triple Kill"],
    [4, "diamond", "Quadra Kill"],
    [5, "master", "Pentakill"],
  ] as const)("turns an allied %i-kill into the matching maximum-tempo state", (
    count,
    tier,
    label,
  ) => {
    const tracker = new LiveTempoTracker()
    tracker.update(snapshot(600))
    const swing = snapshot(604, {
      scores: { kills: 1 + count, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    })
    swing.events = [
      ...Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        name: "ChampionKill",
        time: 601 + index * .5,
        killerName: "Owner#NA1",
        victimName: `Enemy${index}#NA1`,
        assisters: [],
      })),
      {
        id: count + 1,
        name: "Multikill",
        time: 602 + count * .5,
        killerName: "Owner#NA1",
        assisters: [],
        multiKill: count,
      },
    ]

    const analysis = tracker.update(swing)

    expect(analysis?.tempo).toMatchObject({ score: 100, surgeTier: tier, label })
    expect(analysis?.tempo.direction).toBe("up")
  })

  it("holds a multikill surge briefly, then lets Tempo decay", () => {
    const tracker = new LiveTempoTracker()
    tracker.update(snapshot(600))
    const double = snapshot(604, {
      scores: { kills: 3, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    })
    double.events = [{
      id: 1,
      name: "Multikill",
      time: 603,
      killerName: "Owner#NA1",
      assisters: [],
      multiKill: 2,
    }]

    expect(tracker.update(double)?.tempo.score).toBe(100)
    expect(tracker.update({ ...double, gameTime: 608 })?.tempo.score).toBe(100)
    const decayed = tracker.update({ ...double, gameTime: 612 })
    expect(decayed?.tempo.score).toBeLessThan(100)
    expect(decayed?.tempo.surgeTier).toBeUndefined()
  })

  it("holds a quadra kill at 100 longer, then glides down instead of cliff-dropping", () => {
    const tracker = new LiveTempoTracker()
    tracker.update(snapshot(600))
    const quadra = snapshot(604, {
      scores: { kills: 5, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    })
    quadra.events = [{
      id: 1,
      name: "Multikill",
      time: 603,
      killerName: "Owner#NA1",
      assisters: [],
      multiKill: 4,
    }]

    expect(tracker.update(quadra)?.tempo.score).toBe(100)
    // A quadra owns the dial for twelve seconds, not six.
    expect(tracker.update({ ...quadra, gameTime: 610 })?.tempo.score).toBe(100)
    expect(tracker.update({ ...quadra, gameTime: 615 })?.tempo).toMatchObject({
      score: 100,
      surgeTier: "diamond",
    })
    const gliding = tracker.update({ ...quadra, gameTime: 622 })
    expect(gliding?.tempo.score).toBeLessThan(100)
    expect(gliding?.tempo.score).toBeGreaterThanOrEqual(80)
  })

  it("keeps even ARAM bloodbath trades near the midpoint instead of sinking", () => {
    const brawl = (gameTime: number, kills: number) => {
      const value = snapshot(gameTime)
      value.gameMode = "ARAM"
      value.mapNumber = 12
      // Both teams trade evenly; nobody is actually losing tempo.
      value.allies.forEach((entry, index) => {
        entry.scores = { ...entry.scores, kills, deaths: kills, assists: kills * 2 }
        if (index === 0) entry.scores.deaths = 1
      })
      value.enemies.forEach((entry) => {
        entry.scores = { ...entry.scores, kills, deaths: kills, assists: kills * 2 }
      })
      return value
    }

    const tracker = new LiveTempoTracker()
    tracker.update(brawl(300, 3))
    let tempo = 50
    for (const [step, kills] of [[310, 5], [320, 7], [330, 9], [340, 11]] as const) {
      tempo = tracker.update(brawl(step, kills))!.tempo.score
    }

    expect(tempo).toBeGreaterThanOrEqual(40)
    expect(tempo).toBeLessThanOrEqual(60)
  })

  it("lets an objective secure swing Tempo upward through a modest resource deficit", () => {
    const tracker = new LiveTempoTracker()
    const behind = snapshot(600)
    behind.allies[0].scores.creepScore = 40
    behind.enemies[0].scores.creepScore = 75
    tracker.update(behind)
    const secured = snapshot(604)
    secured.allies[0].scores.creepScore = 40
    secured.enemies[0].scores.creepScore = 75
    secured.events = [{
      id: 1,
      name: "DragonKill",
      time: 603,
      killerName: "Owner#NA1",
      assisters: [],
    }]

    const analysis = tracker.update(secured)

    expect(analysis!.resources.difference).toBeLessThan(0)
    expect(analysis!.tempo.score).toBeGreaterThanOrEqual(68)
    expect(analysis!.tempo.direction).toBe("up")
    expect(analysis!.tempo.factors.join(" ")).toMatch(/dragon/i)
  })

  it("treats a clean teamfight and a killing spree as high-priority tempo swings", () => {
    const fightTracker = new LiveTempoTracker()
    fightTracker.update(snapshot(600))
    const fight = snapshot(604, {
      scores: { kills: 3, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    })
    fight.events = [1, 2].map((id) => ({
      id,
      name: "ChampionKill",
      time: 601 + id,
      killerName: id === 1 ? "Owner#NA1" : "Ally1#NA1",
      victimName: `Enemy${id}#NA1`,
      assisters: [],
    }))
    const teamfight = fightTracker.update(fight)
    expect(teamfight!.tempo.score).toBeGreaterThanOrEqual(78)
    expect(teamfight!.tempo.factors.join(" ")).toMatch(/teamfight/i)

    const spreeTracker = new LiveTempoTracker()
    const twoKills = snapshot(600, {
      scores: { kills: 3, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    })
    twoKills.events = [1, 2].map((id) => ({
      id,
      name: "ChampionKill",
      time: 590 + id,
      killerName: "Owner#NA1",
      victimName: `Enemy${id}#NA1`,
      assisters: [],
    }))
    spreeTracker.update(twoKills)
    const thirdKill = snapshot(604, {
      scores: { kills: 4, deaths: 1, assists: 2, creepScore: 70, wardScore: 4 },
    })
    thirdKill.events = [...twoKills.events, {
      id: 3,
      name: "ChampionKill",
      time: 603,
      killerName: "Owner#NA1",
      victimName: "Enemy3#NA1",
      assisters: [],
    }]
    const spree = spreeTracker.update(thirdKill)
    expect(spree!.tempo.score).toBeGreaterThanOrEqual(66)
    expect(spree!.tempo.factors.join(" ")).toMatch(/spree/i)
  })

  it("starts and stays collapsed when the team is already losing 1 to 15", () => {
    const losing = (gameTime: number) => {
      const value = snapshot(gameTime)
      value.allies.forEach((entry, index) => {
        entry.scores = {
          kills: index === 0 ? 1 : 0,
          deaths: index === 0 ? 7 : 2,
          assists: 0,
          creepScore: 40,
          wardScore: 2,
        }
      })
      value.enemies.forEach((entry, index) => {
        entry.scores = {
          kills: 3,
          deaths: index === 0 ? 1 : 0,
          assists: 5,
          creepScore: 100,
          wardScore: 8,
        }
      })
      return value
    }

    const tracker = new LiveTempoTracker()
    const initial = tracker.update(losing(900))
    const unchanged = tracker.update(losing(912))

    expect(initial!.tempo.score).toBeLessThan(20)
    expect(unchanged!.tempo.score).toBeLessThan(20)
    expect(unchanged!.tempo.label).toBe("Collapsing")
    expect(unchanged!.tempo.factors.join(" ")).toMatch(/deficit/i)
  })

  it("suppresses analysis instead of guessing when the enemy team is unavailable", () => {
    const incomplete = snapshot(300)
    incomplete.enemies = []
    expect(new LiveTempoTracker().update(incomplete)).toBeUndefined()
  })
})
