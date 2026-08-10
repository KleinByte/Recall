import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  PERFORMANCE_ARM_LABELS,
} from "../src/shared/performance-vocabulary.js"

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? filesBelow(path) : [path]
  })
}

describe("performance language contract", () => {
  it("uses one canonical label for every RVI arm", () => {
    expect(PERFORMANCE_ARM_LABELS).toMatchObject({
      combat: "Combat",
      positioning_survival: "Survival",
      control_utility: "Utility",
      economy: "Economy",
      objectives_macro: "Macro",
      vision_setup: "Vision",
      initiative_pressure: "Initiative",
      consistency_versatility: "Range",
    })
  })

  it("keeps legacy scoring language and machine evidence codes out of the UI", () => {
    const source = filesBelow("src")
      .filter((path) => /\.(ts|vue)$/.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n")

    expect(source).not.toMatch(/RoleFit|Objectives & Macro|One grade\. Six responsibilities/i)
    expect(readFileSync("src/components/skill/PerformanceProfile.vue", "utf8"))
      .not.toContain("metric.evidenceReason")
  })

  it("keeps implementation generations out of runtime and test filenames", () => {
    const paths = [...filesBelow("electron"), ...filesBelow("src"), ...filesBelow("tests")]
    expect(paths.filter((path) => /(?:^|[-_.])v\d+(?:[-_.]|$)/i.test(path))).toEqual([])
  })
})
