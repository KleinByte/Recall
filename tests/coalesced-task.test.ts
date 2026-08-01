import { describe, expect, it, vi } from "vitest"
import { createCoalescedTask } from "../src/helpers/use-coalesced-task"

describe("createCoalescedTask", () => {
  it("collapses an event burst into one trailing refresh", async () => {
    const releases: Array<() => void> = []
    const task = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)))
    const runner = createCoalescedTask(task)

    const completed = runner.run()
    void runner.run()
    void runner.run()
    expect(task).toHaveBeenCalledTimes(1)

    releases.shift()!()
    await Promise.resolve()
    await Promise.resolve()
    expect(task).toHaveBeenCalledTimes(2)

    releases.shift()!()
    await completed
    runner.stop()
    await runner.run()
    expect(task).toHaveBeenCalledTimes(2)
  })
})
