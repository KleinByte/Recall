// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChampionsPage from "../src/pages/ChampionsPage.vue"
import type { Champion } from "../src/types/lol"

const apiMocks = vi.hoisted(() => ({
  getChampionStats: vi.fn(),
  getProfile: vi.fn(),
  getRankedChampions: vi.fn(),
  on: vi.fn(() => () => undefined),
}))

vi.mock("../src/helpers/api", () => ({ api: apiMocks }))
vi.mock("../src/helpers/navigation", () => ({ openChampion: vi.fn() }))

const champions: Champion[] = [
  {
    id: 103,
    alias: "Ahri",
    name: "Ahri",
    roles: ["mage", "assassin"],
    primaryArchetype: "burst_mage",
    isVisibleInClient: true,
  },
  {
    id: 89,
    alias: "Leona",
    name: "Leona",
    roles: ["tank", "support"],
    primaryArchetype: "vanguard",
    isVisibleInClient: true,
  },
  {
    id: 3,
    alias: "Galio",
    name: "Galio",
    roles: ["tank", "mage"],
    primaryArchetype: "warden",
    isVisibleInClient: true,
  },
]

describe("ChampionsPage collection filters", () => {
  beforeEach(() => {
    apiMocks.getChampionStats.mockResolvedValue([
      {
        championId: 103, games: 4, wins: 2, winRate: .5,
        avgKills: 5, avgDeaths: 4, avgAssists: 7, kda: 3,
        avgDamageToChampions: 20_000, averageRecallScore: 57, gradedGames: 4,
      },
      {
        championId: 89, games: 2, wins: 1, winRate: .5,
        avgKills: 1, avgDeaths: 5, avgAssists: 12, kda: 2.6,
        avgDamageToChampions: 8_000, averageRecallScore: 52, gradedGames: 2,
      },
    ])
    apiMocks.getProfile.mockResolvedValue({ challenges: null, ranked: null, mastery: [] })
    apiMocks.getRankedChampions.mockResolvedValue({
      ranked: [], earlySignals: [], best: [], worst: [],
    })
  })

  it("combines status, archetype, Riot class, and search filters", async () => {
    const wrapper = mount(ChampionsPage, {
      props: { champions, connected: true },
    })
    await flushPromises()

    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(3)
    expect(wrapper.text()).toContain("Burst Mage · Mage / Assassin")

    await wrapper.get('select[aria-label="Filter by archetype"]').setValue("vanguard")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(1)
    expect(wrapper.get("tbody .champion-row").text()).toContain("Leona")

    await wrapper.get('select[aria-label="Filter by Riot class"]').setValue("mage")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(0)

    await wrapper.get('select[aria-label="Filter by archetype"]').setValue("all")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(2)

    const untouched = wrapper.findAll(".chip-row button")
      .find((button) => button.text().includes("Untouched"))!
    await untouched.trigger("click")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(1)
    expect(wrapper.get("tbody .champion-row").text()).toContain("Galio")

    await wrapper.get('input[aria-label="Search champions"]').setValue("warden")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(1)

    const reset = wrapper.findAll("button").find((button) => button.text().trim() === "Reset")!
    await reset.trigger("click")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(3)
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Filter by archetype"]').element.value)
      .toBe("all")
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Filter by Riot class"]').element.value)
      .toBe("all")
  })

  it("is performance-focused with toolbar search, graded filtering, and damage sorting", async () => {
    const wrapper = mount(ChampionsPage, {
      props: { champions, connected: true },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain("Challenges remaining")
    expect(wrapper.text()).not.toContain("Has challenges")
    expect(wrapper.get(".toolbar").find('input[aria-label="Search champions"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("Graded pool")
    expect(wrapper.text()).toContain("6 graded games")

    const graded = wrapper.findAll(".chip-row button")
      .find((button) => button.text().includes("Graded"))!
    await graded.trigger("click")
    expect(wrapper.findAll("tbody .champion-row")).toHaveLength(2)

    const damageSort = wrapper.findAll("thead button")
      .find((button) => button.text().includes("Damage / game"))!
    await damageSort.trigger("click")
    expect(wrapper.get("tbody .champion-row").text()).toContain("Ahri")
    expect(wrapper.get("tbody .champion-row .damage-col").text()).toBe("20.0k")
  })
})
