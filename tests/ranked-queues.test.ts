import { describe, expect, it } from "vitest"
import {
  isLeagueClassicRankedQueue,
  isRecognizedRankedQueue,
  rankedQueueLabel,
} from "../src/helpers/ranked-queues"

describe("ranked queue presentation", () => {
  it("presents Riot's Jade queue keys as League Classic", () => {
    expect(rankedQueueLabel("JADE_RANKED")).toBe("League Classic")
    expect(rankedQueueLabel("RANKED_JADE")).toBe("League Classic")
    expect(isLeagueClassicRankedQueue("JADE_RANKED")).toBe(true)
    expect(isRecognizedRankedQueue("RANKED_JADE")).toBe(true)
  })

  it("does not mistake Mayhem's Kiwi Jade identifier for League Classic", () => {
    expect(isLeagueClassicRankedQueue("RANKED_KIWI_JADE")).toBe(false)
    expect(rankedQueueLabel("RANKED_KIWI_JADE")).toBe("KIWI JADE")
  })

  it("keeps established ranked queue labels stable", () => {
    expect(rankedQueueLabel("RANKED_SOLO_5x5")).toBe("Solo/Duo")
    expect(rankedQueueLabel("RANKED_FLEX_SR")).toBe("Flex")
  })
})
