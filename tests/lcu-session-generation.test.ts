import { describe, expect, it } from "vitest"
import { LcuSessionGeneration } from "../electron/main/lcu-session-generation.js"

describe("LcuSessionGeneration", () => {
  it("invalidates every older asynchronous startup on reconnect or disconnect", () => {
    const sessions = new LcuSessionGeneration()
    const first = sessions.invalidate()
    expect(sessions.isCurrent(first)).toBe(true)

    const replacement = sessions.invalidate()
    expect(sessions.isCurrent(first)).toBe(false)
    expect(sessions.isCurrent(replacement)).toBe(true)

    sessions.invalidate()
    expect(sessions.isCurrent(replacement)).toBe(false)
  })
})
