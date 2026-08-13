// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import DashboardChampionForm from "../src/features/dashboard/DashboardChampionForm.vue"
import DashboardRecentGames from "../src/features/dashboard/DashboardRecentGames.vue"
import type { Champion } from "../src/types/lol"
import type { MatchRow, RankedChampion } from "../src/types/stats"

const champions: Champion[] = [{
  id: 84,
  alias: "Akali",
  name: "Akali",
  roles: ["assassin"],
  isVisibleInClient: true,
}]

const recentGame = {
  gameId: 24,
  championId: 84,
  win: 1,
  grade: "A",
  queueName: "ARAM",
  mode: "aram",
  durationSecs: 1_234,
  kills: 12,
  deaths: 4,
  assists: 18,
  playedAt: Date.now(),
} as MatchRow

const championRow: RankedChampion = {
  championId: 84,
  games: 20,
  gradedGames: 12,
  winRate: .6,
  kda: 3,
  recallScore: 90,
  confidence: "solid",
}

describe("dashboard performance lists", () => {
  it("renders recent game evidence and emits the selected match", async () => {
    const wrapper = mount(DashboardRecentGames, {
      props: { games: [recentGame], champions },
    })

    const row = wrapper.get("li.game")
    expect(row.classes()).toContain("won")
    expect(row.text()).toContain("Akali")
    expect(row.text()).toContain("ARAM · 20:34")
    expect(row.text()).toContain("12/4/18")
    expect(row.get("img").attributes("alt")).toBe("Akali")

    await row.trigger("click")

    expect(wrapper.emitted("openMatch")).toEqual([[recentGame]])
  })

  it("renders champion evidence and emits the selected champion", async () => {
    const wrapper = mount(DashboardChampionForm, {
      props: { rows: [championRow], champions },
    })

    const row = wrapper.get("button.champion")
    expect(row.text()).toContain("Akali")
    expect(row.text()).toContain("Strong read · 12 graded")
    expect(row.text()).toContain("20games")
    expect(row.text()).toContain("60%win rate")
    expect(row.text()).toContain("3.00KDA")
    expect(row.get(".grade").text()).toBe("S")

    await row.trigger("click")

    expect(wrapper.emitted("openChampion")).toEqual([[84]])
  })
})
