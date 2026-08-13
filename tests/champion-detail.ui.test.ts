// @vitest-environment happy-dom

import { readFileSync } from "node:fs"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChampionDetail from "../src/components/ChampionDetail.vue"
import type { Champion } from "../src/types/lol"
import type { ModeFamily, StatsSummary } from "../src/types/stats"

const apiMocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getGradeDistribution: vi.fn(),
  getRviProfile: vi.fn(),
  listMatches: vi.fn(),
  getChampionNeeds: vi.fn(),
}))

vi.mock("../src/helpers/api", () => ({ api: apiMocks }))
vi.mock("../src/helpers/navigation", () => ({ closeChampion: vi.fn() }))

const champion: Champion = {
  id: 103,
  alias: "Ahri",
  name: "Ahri",
  roles: ["mage", "assassin"],
  primaryArchetype: "burst_mage",
  isVisibleInClient: true,
}

const summary = (games: number): StatsSummary => ({
  games,
  wins: Math.floor(games / 2),
  losses: games - Math.floor(games / 2),
  winRate: games ? .5 : 0,
  avgKills: 5,
  avgDeaths: 4,
  avgAssists: 7,
  kda: 3,
  avgDamageToChampions: 20_000,
  avgDamageTaken: 18_000,
  avgGold: 12_000,
  avgDurationSecs: 1_800,
  pentaKills: 0,
  currentStreak: 0,
  longestWinStreak: 2,
  averageRecallScore: games ? 57 : undefined,
  gradedGames: games,
})

describe("ChampionDetail RVI scope", () => {
  beforeEach(() => {
    apiMocks.getSummary.mockImplementation((filter: { modeFamily?: ModeFamily }) =>
      Promise.resolve(summary(filter.modeFamily === "sr" ? 6 : filter.modeFamily === "aram" ? 3 : 0)))
    apiMocks.getGradeDistribution.mockResolvedValue([])
    apiMocks.getRviProfile.mockResolvedValue({
      score: 58,
      games: 6,
      recentGames: 6,
      measuredGames: 6,
      confidence: "learning",
      comparison: "Compared with similar recorded games",
      dimensions: [
        { key: "combat", label: "Combat", score: 61, careerOnly: false },
        { key: "positioning_survival", label: "Survival", score: 54, careerOnly: false },
        { key: "control_utility", label: "Utility", score: 67, careerOnly: false },
        { key: "consistency_versatility", label: "Range", score: 20, careerOnly: true },
      ],
    })
    apiMocks.listMatches.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 3 })
    apiMocks.getChampionNeeds.mockResolvedValue({ 103: [] })
  })

  it("uses the current champion-filtered RVI profile and scopes mode changes consistently", async () => {
    const wrapper = mount(ChampionDetail, {
      props: { championId: 103, champions: [champion] },
      global: {
        stubs: {
          teleport: true,
          UiDialog: { template: "<div><slot /></div>" },
          PerformanceRadar: {
            props: ["dimensions"],
            template: '<div class="performance-radar-stub">Radar</div>',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.get(".rvi-head h3").text()).toBe("Ahri performance shape")
    expect(wrapper.get(".performance-radar-stub").exists()).toBe(true)
    expect(wrapper.find(".rvi-context").exists()).toBe(false)
    expect(wrapper.find(".career-arm-grid").exists()).toBe(false)
    expect(wrapper.findAll(".rvi-arm-list li").map((row) => row.text()))
      .toEqual(["Combat61", "Survival54", "Utility67"])
    expect(apiMocks.getRviProfile).toHaveBeenCalledWith(
      { championIds: [103], modeFamily: "sr" },
      "sr",
    )
    expect(apiMocks.getGradeDistribution).toHaveBeenLastCalledWith(
      { championIds: [103], modeFamily: "sr" },
    )

    await wrapper.get(".scope-toolbar select").setValue("aram")
    await flushPromises()

    expect(apiMocks.getRviProfile).toHaveBeenLastCalledWith(
      { championIds: [103], modeFamily: "aram" },
      "aram",
    )
    expect(apiMocks.listMatches).toHaveBeenLastCalledWith(
      { championIds: [103], modeFamily: "aram", sortBy: "grade", sortDir: "asc" },
      1,
      3,
    )
    expect(wrapper.text()).toContain("Every performance value below uses ARAM games only")
  })

  it("uses the current RVI profile and performance radar", () => {
    const source = readFileSync("src/components/ChampionDetail.vue", "utf8")

    expect(source).toContain("getRviProfile")
    expect(source).toContain("PerformanceRadar")
  })
})
