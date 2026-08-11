import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:css|vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe("readable application typography", () => {
  it("defines one semantic scale for microtext, labels, support copy, and controls", () => {
    const tokens = readFileSync("src/design/tokens.css", "utf8")

    expect(tokens).toContain("--ui-text-micro: 11px")
    expect(tokens).toContain("--ui-text-label: 12px")
    expect(tokens).toContain("--ui-text-support: 13px")
    expect(tokens).toContain("--ui-text-body: 14px")
    expect(tokens).toContain("--ui-text-control: 14px")
  })

  it("does not render user-facing CSS or chart labels below 11px", () => {
    const offenders: string[] = []

    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8")
      for (const declaration of source.matchAll(/(?:font-size|font)\s*:\s*([^;\n}]+)/gi)) {
        const values = [...declaration[1].matchAll(/(?<![\d.])(\d+(?:\.\d+)?)px/g)]
        if (values.some((value) => Number(value[1]) < 11)) {
          offenders.push(`${file}: ${declaration[0].trim()}`)
        }
      }
      for (const declaration of source.matchAll(/\bfontSize\s*:\s*(\d+(?:\.\d+)?)/g)) {
        if (Number(declaration[1]) < 11) offenders.push(`${file}: ${declaration[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
