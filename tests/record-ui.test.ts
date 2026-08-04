import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("personal record surfaces", () => {
  it("announces new records in the post-game banner", () => {
    const banner = read("../src/components/PostGameBanner.vue")
    const main = read("../electron/main/index.ts")
    const app = read("../src/App.vue")
    expect(banner).toContain("new personal")
    expect(banner).toContain("formatRecordValue(record)")
    expect(banner).toContain("record-callout")
    expect(main).not.toContain("new Notification")
    expect(main).toContain('broadcast(win, "record:notification"')
    expect(app).toContain('events.on("record:notification"')
    expect(app).toContain("recordNotifications")
    expect(app).toContain("openRecordNotification")
    const center = read("../src/components/RecordNotificationCenter.vue")
    expect(center).toContain("faBell")
    expect(center).toContain("unread-count")
    expect(center).toContain("Open match review")
    expect(center).toContain("Clear all Recall notifications")
    expect(app).toContain("clearRecordNotifications")
  })

  it("marks every record currently held by the reviewed game", () => {
    const hero = read("../src/components/MatchReviewHero.vue")
    expect(hero).toContain("Current personal records")
    expect(hero).toContain("Personal best")
    expect(hero).toContain("review.records")
    expect(hero).toContain("visibleRecords")
    expect(hero).toContain("visibleLabels")
    expect(hero).toContain("reveal-card")
    expect(hero).not.toContain("overflow-x: auto")
  })

  it("organizes the expanded Progress catalog into readable groups", () => {
    const progress = read("../src/pages/ProgressPage.vue")
    expect(progress).toContain("RECORD_CATEGORY_ORDER")
    expect(progress).toContain("recordGroups")
    expect(progress).toContain("activeRecordGroup")
    expect(progress).toContain("reviewMatch(record.gameId)")
  })
})
