import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { LABEL_ICONS, labelIcon } from "../src/helpers/label-icons"

const sourceIds = (relative: string) => {
  const path = fileURLToPath(new URL(relative, import.meta.url))
  const matches = readFileSync(path, "utf8").matchAll(/\bid: "([a-z0-9_]+)", name: "/g)
  return [...matches].map(([, id]) => id)
}

const evaluatorIds = new Set([
  ...sourceIds("../electron/main/matches/labels.ts"),
  ...sourceIds("../electron/main/matches/timeline-labels.ts"),
])

/** Awarded in the renderer from the stored lobby grades, not by an evaluator. */
const UI_ONLY_IDS = new Set(["mvp"])

describe("label icons", () => {
  it("covers every label the evaluators can award", () => {
    const mapped = new Set(LABEL_ICONS.map((entry) => entry.id))
    expect([...evaluatorIds].filter((id) => !mapped.has(id))).toEqual([])
  })

  it("does not map labels the evaluators never award", () => {
    expect(LABEL_ICONS.filter((entry) =>
      !evaluatorIds.has(entry.id) && !UI_ONLY_IDS.has(entry.id))).toEqual([])
  })

  it("resolves an icon by id and by display name", () => {
    expect(labelIcon("pentakill")).toBe(labelIcon("Pentakill"))
  })

  it("falls back to a generic icon for unknown labels", () => {
    expect(labelIcon("not_a_label").iconName).toBe("tag")
  })
})
