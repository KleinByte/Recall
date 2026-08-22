// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { defineComponent, h } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReviewPageData } from "../src/features/review/use-review-page-data"
import type { MatchReview } from "../src/types/review"

const apiMocks = vi.hoisted(() => ({
  getReviewOverview: vi.fn(),
  getMatchReview: vi.fn(),
  getOwnerAugmentSummaries: vi.fn(),
  getRviProfile: vi.fn(),
  getReviewSessions: vi.fn(),
  listTags: vi.fn(),
  listMatches: vi.fn(),
  saveAnnotation: vi.fn(),
  getTimeline: vi.fn(),
  createTag: vi.fn(),
  requestTimeline: vi.fn(),
  setSessionBoundary: vi.fn(),
}))
const focusReviewGameId = vi.hoisted(() => ({ value: null as number | null }))

vi.mock("../src/helpers/api", () => ({ api: apiMocks }))
vi.mock("../src/helpers/navigation", () => ({ focusReviewGameId }))

function reviewFixture(): MatchReview {
  return {
    match: {
      gameId: 42,
      playedAt: 1_725_000_000_000,
      modeFamily: "aram",
    },
    records: [],
    scoreboard: [],
    teams: [],
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

function mountReviewData() {
  const resetMatchView = vi.fn()
  const showPerformanceBreakdown = vi.fn()
  let data!: ReturnType<typeof useReviewPageData>
  const wrapper = mount(defineComponent({
    setup() {
      data = useReviewPageData({ resetMatchView, showPerformanceBreakdown })
      return () => h("div")
    },
  }))
  return { data, resetMatchView, showPerformanceBreakdown, wrapper }
}

describe("useReviewPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    focusReviewGameId.value = null
    apiMocks.getReviewOverview.mockResolvedValue({})
    apiMocks.getMatchReview.mockImplementation(async () => reviewFixture())
    apiMocks.getRviProfile.mockResolvedValue(undefined)
    apiMocks.getReviewSessions.mockResolvedValue({ rows: [] })
    apiMocks.listTags.mockResolvedValue([])
    apiMocks.listMatches.mockResolvedValue({ rows: [] })
    apiMocks.saveAnnotation.mockImplementation(async (_gameId, annotation) => ({
      gameId: 42,
      tags: [],
      ...annotation,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("loads one match and its supporting review collections through the controller", async () => {
    const { data, resetMatchView, showPerformanceBreakdown, wrapper } = mountReviewData()

    await data.load(42)

    expect(resetMatchView).toHaveBeenCalledOnce()
    expect(apiMocks.getMatchReview).toHaveBeenCalledWith(42)
    expect(apiMocks.getRviProfile).toHaveBeenNthCalledWith(1, {
      modeFamily: "aram",
      sinceMs: 1_724_999_999_999,
      untilMs: 1_725_000_000_001,
    }, "aram", "match")
    expect(apiMocks.getRviProfile).toHaveBeenNthCalledWith(2, { modeFamily: "aram" }, "aram")
    expect(showPerformanceBreakdown).toHaveBeenCalledOnce()
    expect(data.review.value?.match.gameId).toBe(42)
    expect(data.busy.value).toBe(false)
    expect(data.error.value).toBe("")
    expect(apiMocks.getReviewSessions).toHaveBeenCalledOnce()
    expect(apiMocks.listTags).toHaveBeenCalledOnce()
    expect(apiMocks.listMatches).toHaveBeenCalledWith({ bookmarked: true }, 1, 100)

    wrapper.unmount()
  })

  it("surfaces load failures and always releases the busy state", async () => {
    apiMocks.getReviewOverview.mockRejectedValue(new Error("League client unavailable"))
    const { data, resetMatchView, wrapper } = mountReviewData()

    await data.load()

    expect(resetMatchView).toHaveBeenCalledOnce()
    expect(data.review.value).toBeUndefined()
    expect(data.error.value).toBe("League client unavailable")
    expect(data.busy.value).toBe(false)

    wrapper.unmount()
  })

  it("does not refresh over a queued annotation save", async () => {
    vi.useFakeTimers()
    const { data, wrapper } = mountReviewData()
    await data.load(42)
    data.review.value!.annotation.note = "Watch the second fight"

    data.queueNoteSave()
    data.refreshCurrentWhenIdle()
    await flushPromises()
    expect(apiMocks.getReviewOverview).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(750)
    expect(apiMocks.saveAnnotation).toHaveBeenCalledWith(42, {
      note: "Watch the second fight",
      bookmarked: false,
      tagIds: [],
    })

    data.refreshCurrentWhenIdle()
    await flushPromises()
    expect(apiMocks.getReviewOverview).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })
})
