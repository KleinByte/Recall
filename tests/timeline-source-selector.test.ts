import { describe, expect, it } from "vitest"
import { selectTimelineSource } from
  "../electron/main/matches/timeline-source-selector.js"
import { TIMELINE_MAPPER_VERSION } from
  "../electron/main/riot/timeline-mapper.js"

describe("timeline source selection", () => {
  it("prefers Riot's Match-V5 timeline over the local client fallback", () => {
    const selected = selectTimelineSource([
      {
        source: "league_client",
        mapperVersion: TIMELINE_MAPPER_VERSION,
        status: "ready",
        dataJson: '{"frames":[],"events":[],"turningPoints":[]}',
        capturedAt: 2,
      },
      {
        source: "match_v5",
        mapperVersion: TIMELINE_MAPPER_VERSION,
        status: "ready",
        dataJson: '{"frames":[{}],"events":[],"turningPoints":[]}',
        capturedAt: 1,
      },
    ])

    expect(selected?.source).toBe("match_v5")
  })
})
