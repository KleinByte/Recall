// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DashboardPage from "../src/pages/DashboardPage.vue"
import type { PerformanceProfile, StatsSummary } from "../src/types/stats"

const apiMocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getMatches: vi.fn(),
  getRankedChampions: vi.fn(),
  getProfile: vi.fn(),
  listChallenges: vi.fn(),
  getRankedHistory: vi.fn(),
  getRviProfile: vi.fn(),
  on: vi.fn(() => () => undefined),
}))

vi.mock("../src/helpers/api", () => ({ api: apiMocks }))

const summary: StatsSummary = {
  games: 12,
  wins: 7,
  losses: 5,
  winRate: 7 / 12,
  avgKills: 6,
  avgDeaths: 4,
  avgAssists: 8,
  kda: 3.5,
  avgDamageToChampions: 22_000,
  avgDamageTaken: 18_000,
  avgGold: 12_500,
  avgDurationSecs: 1_800,
  pentaKills: 0,
  currentStreak: 1,
  longestWinStreak: 3,
  averageRecallScore: 61,
  gradedGames: 10,
}

const profile = (score: number): PerformanceProfile => ({
  score,
  dimensions: [],
} as PerformanceProfile)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function mountDashboard() {
  return mount(DashboardPage, {
    props: { champions: [], connected: true },
    global: {
      stubs: {
        RankedHistoryPanel: true,
        PerformanceRadar: { template: '<div class="radar-stub" />' },
      },
    },
  })
}

describe("Dashboard RVI scope", () => {
  beforeEach(() => {
    apiMocks.getSummary.mockResolvedValue(summary)
    apiMocks.getMatches.mockResolvedValue([])
    apiMocks.getRankedChampions.mockResolvedValue({
      ranked: [], earlySignals: [], best: [], worst: [],
    })
    apiMocks.getProfile.mockResolvedValue({ challenges: null, ranked: null, mastery: [] })
    apiMocks.listChallenges.mockResolvedValue([])
    apiMocks.getRankedHistory.mockResolvedValue([])
  })

  it("defaults to Solo/Duo and keeps its selector visible while loading and building", async () => {
    const pending = deferred<PerformanceProfile | undefined>()
    apiMocks.getRviProfile.mockReturnValueOnce(pending.promise)
    const wrapper = mountDashboard()
    await flushPromises()

    const selector = wrapper.get<HTMLSelectElement>('select[aria-label="RVI scope"]')
    expect(selector.element.value).toBe("rankedSolo")
    expect(wrapper.text()).toContain("Loading RVI profile")
    expect(apiMocks.getRviProfile).toHaveBeenCalledWith(
      { mode: "sr_ranked_solo" },
      "sr",
    )

    pending.resolve(undefined)
    await flushPromises()

    expect(wrapper.get('select[aria-label="RVI scope"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("RVI is still building")
    expect(wrapper.text()).toContain("Ranked Solo/Duo does not yet have enough measured")
  })

  it("loads All Summoner's Rift and ignores an older Solo/Duo response", async () => {
    const pendingSolo = deferred<PerformanceProfile | undefined>()
    apiMocks.getRviProfile
      .mockReturnValueOnce(pendingSolo.promise)
      .mockResolvedValueOnce(profile(73))
    const wrapper = mountDashboard()
    await flushPromises()

    await wrapper.get('select[aria-label="RVI scope"]').setValue("allRift")
    await flushPromises()

    expect(apiMocks.getRviProfile).toHaveBeenLastCalledWith(
      { modeFamily: "sr" },
      "sr",
    )
    expect(wrapper.text()).toContain("73 · All Summoner's Rift")

    pendingSolo.resolve(profile(41))
    await flushPromises()
    expect(wrapper.text()).toContain("73 · All Summoner's Rift")
    expect(wrapper.text()).not.toContain("41 ·")
  })
})
