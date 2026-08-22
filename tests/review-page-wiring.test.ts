// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { defineComponent, h } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ReviewPage from "../src/pages/ReviewPage.vue"
import { focusReviewGameId } from "../src/helpers/navigation"
import type { Champion } from "../src/types/lol"
import type { MatchReview } from "../src/types/review"
import type { ParticipantRow, TeamRow } from "../src/types/stats"

const apiMocks = vi.hoisted(() => ({
  getReviewOverview: vi.fn(),
  getMatchReview: vi.fn(),
  getJunglePathingReview: vi.fn(),
  getOwnerAugmentSummaries: vi.fn(),
  getRviProfile: vi.fn(),
  getReviewSessions: vi.fn(),
  listTags: vi.fn(),
  listMatches: vi.fn(),
  saveAnnotation: vi.fn(),
  getTimeline: vi.fn(),
  cacheAugmentCatalog: vi.fn(),
}))
const eventMocks = vi.hoisted(() => ({ on: vi.fn() }))
const loadGameAssetsMock = vi.hoisted(() => vi.fn())

vi.mock("../src/helpers/api", () => ({ api: apiMocks }))
vi.mock("../src/helpers/use-api-events", () => ({
  useApiEvents: () => eventMocks,
}))
vi.mock("../src/helpers/game-assets", async () => {
  const actual = await vi.importActual<typeof import("../src/helpers/game-assets")>(
    "../src/helpers/game-assets",
  )
  return { ...actual, loadGameAssets: loadGameAssetsMock }
})

const champions: Champion[] = [{
  id: 22,
  alias: "Ashe",
  name: "Ashe",
  roles: ["marksman"],
  primaryArchetype: "marksman",
  isVisibleInClient: true,
}]

function reviewFixture(jungling = false): MatchReview {
  const owner = {
    participantId: 1,
    teamId: 100,
    isPlayer: 1,
    championId: 22,
    summonerName: "Owner#NA1",
    recallScore: 74,
    augments: [],
    spell1Id: jungling ? 11 : 4,
    spell2Id: 14,
    resolvedPosition: jungling ? "JUNGLE" : "BOTTOM",
    positionResolverVersion: 3,
  } as ParticipantRow
  const team = {
    gameId: 42,
    puuid: "owner",
    teamId: 100,
    bans: "[]",
  } as TeamRow

  return {
    match: {
      gameId: 42,
      playedAt: 1_725_000_000_000,
      modeFamily: "other",
      lobbyPlace: 1,
      lobbySize: 1,
      grade: "A",
      gradeReferenceSampleCount: 12,
      resolvedPosition: jungling ? "JUNGLE" : "BOTTOM",
      positionResolverVersion: 3,
    },
    records: [],
    scoreboard: [owner],
    teams: [team],
    labels: [],
    highlights: [],
    annotation: {
      gameId: 42,
      note: "",
      bookmarked: false,
      tags: [],
    },
    timeline: { status: "pending" },
  } as MatchReview
}

const MatchReviewHeroStub = defineComponent({
  name: "MatchReviewHero",
  props: {
    review: { type: Object, required: true },
    champions: { type: Array, required: true },
  },
  emits: ["bookmark"],
  setup(_props, { emit }) {
    return () => h("section", { class: "match-review-hero-stub" }, [
      h("button", {
        type: "button",
        class: "bookmark-from-hero",
        onClick: () => emit("bookmark"),
      }, "Bookmark"),
    ])
  },
})

const ReviewScoreboardStub = defineComponent({
  name: "ReviewScoreboard",
  props: {
    match: { type: Object, required: true },
    participants: { type: Array, required: true },
    teams: { type: Array, required: true },
    champions: { type: Array, required: true },
    assets: { type: Object, required: true },
  },
  setup() {
    return () => h("section", { class: "review-scoreboard-stub" })
  },
})

describe("ReviewPage wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    focusReviewGameId.value = null
    const review = reviewFixture()
    apiMocks.getReviewOverview.mockResolvedValue({ latest: review })
    apiMocks.getMatchReview.mockResolvedValue(review)
    apiMocks.getJunglePathingReview.mockResolvedValue({
      participants: [],
      segments: [],
      campClears: [],
    })
    apiMocks.getOwnerAugmentSummaries.mockResolvedValue([])
    apiMocks.getRviProfile.mockResolvedValue(undefined)
    apiMocks.getReviewSessions.mockResolvedValue({ rows: [] })
    apiMocks.listTags.mockResolvedValue([])
    apiMocks.listMatches.mockResolvedValue({ rows: [] })
    apiMocks.saveAnnotation.mockImplementation(async (gameId, annotation) => ({
      gameId,
      note: annotation.note,
      bookmarked: annotation.bookmarked,
      tags: [],
    }))
    apiMocks.getTimeline.mockResolvedValue({ status: "pending" })
    apiMocks.cacheAugmentCatalog.mockResolvedValue(undefined)
    loadGameAssetsMock.mockResolvedValue({
      version: "test",
      items: {},
      augments: {},
      abilities: {},
    })
  })

  it("passes the loaded review to live children and handles the hero bookmark event", async () => {
    const wrapper = mount(ReviewPage, {
      props: { champions },
      global: {
        stubs: {
          MatchReviewHero: MatchReviewHeroStub,
          ReviewScoreboard: ReviewScoreboardStub,
        },
      },
    })
    await flushPromises()

    expect(wrapper.get(".review-area-tabs").text()).not.toContain("Experiments")
    expect(wrapper.text()).not.toContain("New practice experiment")
    expect(apiMocks.getMatchReview).toHaveBeenCalledWith(42)
    expect(apiMocks.getJunglePathingReview).toHaveBeenCalledWith(42)
    expect(eventMocks.on).toHaveBeenCalledWith(
      "minimap:pathing-updated",
      expect.any(Function),
    )
    const hero = wrapper.getComponent(MatchReviewHeroStub)
    const scoreboard = wrapper.getComponent(ReviewScoreboardStub)
    expect((hero.props("review") as MatchReview).match.gameId).toBe(42)
    expect(hero.props("champions")).toEqual(champions)
    expect((scoreboard.props("match") as MatchReview["match"]).gameId).toBe(42)
    expect(scoreboard.props("participants")).toHaveLength(1)
    expect(scoreboard.props("teams")).toHaveLength(1)

    await hero.get(".bookmark-from-hero").trigger("click")
    await flushPromises()

    expect(apiMocks.saveAnnotation).toHaveBeenCalledWith(42, {
      note: "",
      bookmarked: true,
      tagIds: [],
    })
    expect(apiMocks.getTimeline).toHaveBeenCalledWith(42)

    wrapper.unmount()
  })

  it("shows jungle clear review in a dedicated tab only for jungle games", async () => {
    const jungleReview = reviewFixture(true)
    apiMocks.getReviewOverview.mockResolvedValue({ latest: jungleReview })
    apiMocks.getMatchReview.mockResolvedValue(jungleReview)

    const wrapper = mount(ReviewPage, {
      props: { champions },
      global: {
        stubs: {
          MatchReviewHero: MatchReviewHeroStub,
          ReviewScoreboard: ReviewScoreboardStub,
        },
      },
    })
    await flushPromises()

    const jungleTab = wrapper.findAll(".match-tabs button").find(
      (button) => button.text() === "Jungle clear",
    )
    expect(jungleTab).toBeDefined()
    expect(wrapper.find('[aria-label="Jungle clear and pathing review"]').exists()).toBe(false)

    await jungleTab!.trigger("click")
    await flushPromises()

    expect(wrapper.get('[aria-label="Jungle clear and pathing review"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
