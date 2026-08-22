import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => "C:/application" },
  nativeImage: {},
}))

import {
  completeChampionTemplateRoster,
  DataDragonTemplateProvider,
  validatedChampionTemplateRoster,
} from "../electron/main/minimap/data-dragon-template-provider.js"

const roster = [
  {
    participantKey: "ally:garen",
    championName: "Garen",
    team: "ally" as const,
    isLocal: false,
  },
  {
    participantKey: "enemy:future",
    championName: "Future Champion",
    team: "enemy" as const,
    isLocal: false,
  },
]

describe("offline champion portrait provider", () => {
  it("loads and caches known local portraits while leaving future champions to fallback CV", async () => {
    const reads: string[] = []
    const manifest = {
      schemaVersion: 1,
      patch: "16.16.1",
      championCount: 150,
      champions: [
        {
          id: 86,
          assetKey: "Garen",
          name: "Garen",
          file: "Garen.png",
          bytes: 8,
          sha256: "0".repeat(64),
        },
        ...Array.from({ length: 149 }, (_, index) => ({
          id: 1_000 + index,
          assetKey: `Placeholder${index}`,
          name: `Placeholder ${index}`,
          file: `Placeholder${index}.png`,
          bytes: 8,
          sha256: "0".repeat(64),
        })),
      ],
    }
    const read = vi.fn(async (file: string) => {
      reads.push(file)
      return file.endsWith("manifest.json")
        ? JSON.stringify(manifest)
        : Buffer.from("portrait")
    })
    const provider = new DataDragonTemplateProvider({
      directory: "C:/offline-portraits",
      readFile: read as never,
      decode: () => ({
        width: 2,
        height: 2,
        data: new Uint8Array(16).fill(255),
        capturedMonotonicMs: 0,
        frameSequence: 0,
      }),
    })

    const first = await provider.load(roster)
    const second = await provider.load(roster)

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ participantKey: "ally:garen", championName: "Garen" })
    expect(second).toHaveLength(1)
    expect(reads.filter((file) => file.endsWith("manifest.json"))).toHaveLength(1)
    expect(reads.filter((file) => file.endsWith("Garen.png"))).toHaveLength(1)
    expect(validatedChampionTemplateRoster(roster, first)).toHaveLength(1)
    expect(completeChampionTemplateRoster(roster, first)).toEqual([])
  })
})
