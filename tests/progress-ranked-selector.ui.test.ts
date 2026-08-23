// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ProgressPage from "../src/pages/ProgressPage.vue"

const apiMocks = vi.hoisted(() => ({
  getRankedHistory: vi.fn(),
  listGoals: vi.fn(),
  listChallenges: vi.fn(),
  getLifetimeTotals: vi.fn(),
  getRecords: vi.fn(),
  addGoal: vi.fn(),
  removeGoal: vi.fn(),
  on: vi.fn(() => () => undefined),
}))

vi.mock("../src/helpers/api", () => ({ api: apiMocks }))
vi.mock("../src/helpers/navigation", () => ({ reviewMatch: vi.fn() }))

const point = (recordedAt: number, points: number, label: string) => ({
  recordedAt,
  points,
  label,
  leaguePoints: points % 100,
  wins: 10,
  losses: 8,
})

describe("Progress ranked selector", () => {
  beforeEach(() => {
    apiMocks.getRankedHistory.mockResolvedValue([
      {
        queue: "RANKED_FLEX_SR",
        points: [point(1_700_000_000_000, 1_300, "Gold IV")],
      },
      {
        queue: "RANKED_SOLO_5x5",
        points: [
          point(1_700_000_000_000, 1_500, "Gold II"),
          point(1_710_000_000_000, 1_560, "Gold II"),
        ],
      },
      {
        queue: "UNRECOGNIZED_QUEUE",
        points: [point(1_700_000_000_000, 900, "Silver IV")],
      },
    ])
    apiMocks.listGoals.mockResolvedValue([])
    apiMocks.listChallenges.mockResolvedValue([])
    apiMocks.getLifetimeTotals.mockResolvedValue(null)
    apiMocks.getRecords.mockResolvedValue([])
  })

  it("renders one all-season graph and selects Solo/Duo first", async () => {
    const wrapper = mount(ProgressPage, {
      props: { champions: [], connected: true },
      global: {
        stubs: {
          RankGraph: { template: '<div class="rank-graph-stub" />' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll(".rank-graph-stub")).toHaveLength(1)
    expect(wrapper.findAll(".ranked-history-panel")).toHaveLength(1)
    expect(wrapper.get<HTMLSelectElement>("#ranked-queue").element.value)
      .toBe("RANKED_SOLO_5x5")
    expect(wrapper.get<HTMLSelectElement>("#ranked-season").element.value).toBe("all")
    expect(wrapper.findAll("#ranked-queue option").map((option) => option.text()))
      .toEqual(["Solo/Duo", "Flex"])
  })
})
