import { describe, expect, it } from "vitest"
import { DatabaseWriteCoordinator } from "../electron/main/database-write-coordinator.js"

describe("DatabaseWriteCoordinator", () => {
  it("holds the maintenance gate until the owner releases it", () => {
    const coordinator = new DatabaseWriteCoordinator()
    const finish = coordinator.beginMaintenance("clear-history")

    expect(coordinator.maintenanceActive).toBe(true)
    expect(() => coordinator.beginMaintenance("other"))
      .toThrow("database_maintenance_already_active")

    finish()
    finish()
    expect(coordinator.maintenanceActive).toBe(false)
  })

  it("drains tracked work and children queued while a task is settling", async () => {
    const coordinator = new DatabaseWriteCoordinator()
    const events: string[] = []
    let release: (() => void) | undefined
    const first = new Promise<void>((resolve) => {
      release = resolve
    }).then(() => {
      events.push("first")
      coordinator.track(Promise.resolve().then(() => {
        events.push("child")
      }))
    })
    coordinator.track(first)

    const drained = coordinator.drain().then(() => events.push("drained"))
    await Promise.resolve()
    expect(events).toEqual([])

    release?.()
    await drained
    expect(events).toEqual(["first", "child", "drained"])
  })
})
