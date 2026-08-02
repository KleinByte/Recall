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

  it("suppresses analysis instead of guessing when the enemy team is unavailable", () => {
    const incomplete = snapshot(300)
    incomplete.enemies = []
    expect(new LiveTempoTracker().update(incomplete)).toBeUndefined()
  })
})
