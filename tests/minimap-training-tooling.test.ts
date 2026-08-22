import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repositoryRoot = path.resolve(process.cwd())

async function json(relativePath: string) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"))
}

describe("minimap model training lifecycle", () => {
  it("pins the complete local roster and focuses the three base-model gaps", async () => {
    const roster = await json("minimap_training/roster.json")
    const portraits = await json("resources/champion-portraits/manifest.json")
    const names = roster.classes.map((entry: { assetKey: string }) => entry.assetKey)

    expect(roster.classCount).toBe(173)
    expect(roster.classCount).toBe(portraits.championCount)
    expect(roster.baseModel.classCount).toBe(170)
    expect(roster.focusChampions).toEqual(["Locke", "Yunara", "Zaahen"])
    expect(names).toEqual([...names].sort())
    expect(names).toContain("Garen")
    for (const champion of roster.focusChampions) {
      expect(roster.baseModel.classNames).not.toContain(champion)
      expect(names).toContain(champion)
    }
  })

  it("references every checksummed portrait without duplicating champion assets", async () => {
    const roster = await json("minimap_training/roster.json")
    for (const champion of roster.classes) {
      const content = await readFile(path.join(
        repositoryRoot,
        "resources/champion-portraits",
        champion.file,
      ))
      expect(createHash("sha256").update(content).digest("hex")).toBe(champion.portraitSha256)
    }
    await expect(readdir(path.join(repositoryRoot, "minimap_training/assets/champs")))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("vendors the upstream synthetic backgrounds and lifecycle entry points", async () => {
    const [maps, icons, pings, packageJson, workflow] = await Promise.all([
      readdir(path.join(repositoryRoot, "minimap_training/assets/map")),
      readdir(path.join(repositoryRoot, "minimap_training/assets/icons")),
      readdir(path.join(repositoryRoot, "minimap_training/assets/pings")),
      json("package.json"),
      readFile(path.join(repositoryRoot, ".github/workflows/minimap-training.yml"), "utf8"),
    ])
    expect(maps.filter((file) => file.endsWith(".png"))).toHaveLength(6)
    expect(icons.filter((file) => file.endsWith(".png"))).toHaveLength(25)
    expect(pings.filter((file) => file.endsWith(".png"))).toHaveLength(10)
    for (const script of [
      "minimap:setup",
      "minimap:download-base",
      "minimap:generate",
      "minimap:live:build",
      "minimap:train",
      "minimap:evaluate",
      "minimap:publish",
      "minimap:pipeline",
    ]) {
      expect(packageJson.scripts[script]).toEqual(expect.any(String))
    }
    expect(workflow).toContain("Roster and generator smoke test")
    expect(workflow).toContain("self-hosted, linux, x64, gpu")
  })

  it("passes the deterministic local roster checker", () => {
    expect(() => execFileSync(
      process.execPath,
      ["scripts/sync-minimap-training-roster.mjs", "--check"],
      { cwd: repositoryRoot, stdio: "pipe" },
    )).not.toThrow()
  })
})
