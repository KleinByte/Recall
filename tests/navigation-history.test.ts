import { beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => vi.resetModules())

describe("application navigation history", () => {
  it("restores the exact reviewed match when moving back and forward", async () => {
    const navigation = await import("../src/helpers/navigation")
    navigation.goTo("matches")
    navigation.reviewMatch(101)

    expect(navigation.page.value).toBe("review")
    expect(navigation.focusReviewGameId.value).toBe(101)
    expect(navigation.canGoBack.value).toBe(true)

    navigation.goBack()
    expect(navigation.page.value).toBe("matches")
    expect(navigation.canGoForward.value).toBe(true)

    navigation.goForward()
    expect(navigation.page.value).toBe("review")
    expect(navigation.focusReviewGameId.value).toBe(101)
  })

  it("discards the old forward branch after new navigation", async () => {
    const navigation = await import("../src/helpers/navigation")
    navigation.goTo("matches")
    navigation.goTo("skill")
    navigation.goBack()
    navigation.goTo("progress")

    expect(navigation.page.value).toBe("progress")
    expect(navigation.canGoForward.value).toBe(false)
  })
})
