import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  BrowserWindow: class {},
  desktopCapturer: { getSources: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
}))

import {
  completeChampionTemplateRoster,
  validatedChampionTemplateRoster,
  type ChampionRosterTemplateInput,
} from "../electron/main/minimap/data-dragon-template-provider.js"
import type { ChampionMarkerTemplate } from
  "../electron/main/minimap/champion-marker-detector.js"
import { RecallMinimapIntegration } from
  "../electron/main/minimap/recall-minimap-integration.js"

const roster: ChampionRosterTemplateInput[] = [
  {
    participantKey: "ally:slot:0:zac",
    championName: "Zac",
    team: "ally",
    isLocal: true,
  },
  {
    participantKey: "enemy:slot:0:ahri",
    championName: "Ahri",
    team: "enemy",
    isLocal: false,
  },
]

function template(
  descriptor: ChampionRosterTemplateInput,
): ChampionMarkerTemplate {
  return {
    ...descriptor,
    width: 24,
    height: 24,
    rgba: new Uint8Array(24 * 24 * 4),
  }
}

describe("minimap champion template roster", () => {
  it("refuses partial or identity-mismatched template sets", () => {
    expect(completeChampionTemplateRoster(roster, [
      template(roster[0]),
    ])).toEqual([])
    expect(completeChampionTemplateRoster(roster, [
      template(roster[0]),
      template({ ...roster[1], team: "ally" }),
    ])).toEqual([])
  })

  it("keeps only exact identities when a partial portrait download is usable", () => {
    expect(validatedChampionTemplateRoster(roster, [
      template(roster[0]),
      template({ ...roster[1], team: "ally" }),
    ])).toEqual([template(roster[0])])
  })

  it("commits safe partial templates while retrying for the full roster", async () => {
    const full = roster.map(template)
    const load = vi.fn()
      .mockResolvedValueOnce(full.slice(0, 1))
      .mockResolvedValueOnce(full)
    const integration = new RecallMinimapIntegration({
      gameClient: { request: vi.fn() },
      database: {
        prepare: vi.fn(() => ({
          run: vi.fn(),
          all: vi.fn(() => []),
          get: vi.fn(),
        })),
      },
      puuid: "owner",
      getEnabled: () => true,
      getDataDragonVersion: () => "1.2.3",
      templateProvider: { load },
      templateRetryIntervalMs: 0,
    })
    const session = {
      phase: "ChampSelect" as const,
      game: {
        allies: [{
          championName: "Zac",
          isDead: false,
          isLocal: true,
        }],
        enemies: [{
          championName: "Ahri",
          isDead: false,
          isLocal: false,
        }],
      },
    }

    await integration.update(session)
    await integration.update(session)
    await integration.update(session)

    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenNthCalledWith(1, roster)
    expect(load).toHaveBeenNthCalledWith(2, roster)
  })
})
