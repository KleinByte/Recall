import { describe, expect, it, vi } from "vitest"
import { RepairNotificationCoalescer } from "../electron/main/database/repair-notifications.js"

describe("repair notifications", () => {
  it("publishes one coalesced post-commit event", () => {
    const publish = vi.fn()
    const batch = new RepairNotificationCoalescer(publish).begin()
    for (let index = 0; index < 100; index += 1) {
      batch.record({ gameId: index % 10, category: "eligibility", version: { key: "eligibility", value: 3 } })
    }
    expect(publish).not.toHaveBeenCalled()
    batch.commit()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toMatchObject({
      gameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      changedCount: 100,
      categories: { eligibility: 100 },
      versions: { eligibility: 3 },
    })
  })

  it("publishes nothing after rollback", () => {
    const publish = vi.fn()
    const batch = new RepairNotificationCoalescer(publish).begin()
    batch.record({ gameId: 1, category: "duration" })
    batch.rollback()
    expect(publish).not.toHaveBeenCalled()
  })
})
