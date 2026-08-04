import { describe, expect, it } from "vitest"
import {
  findingLabel,
  findingSummary,
} from "../src/helpers/insight-findings.js"

const champions = [{
  id: 9,
  alias: "Fiddlesticks",
  name: "Fiddlesticks",
  roles: ["mage" as const],
  isVisibleInClient: true,
}]

describe("insight finding labels", () => {
  it("resolves champion ids through the loaded champion catalog", () => {
    const finding = {
      key: "champion:9",
      title: "Champion 9",
      summary: "Champion 9 associated with higher grades.",
    }

    expect(findingLabel(finding, champions)).toBe("Fiddlesticks")
    expect(findingSummary(finding, champions)).toBe(
      "Fiddlesticks associated with higher grades.",
    )
  })
})
