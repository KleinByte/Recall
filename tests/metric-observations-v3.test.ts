import { describe, expect, it } from "vitest"
import { observed, unavailable } from "../src/shared/measurement.js"
import {
  calibrateRawDetailMetricV3,
  collectDetailMetricCalibrationRowsV3,
  detailMetricCalibrationCohortV3,
  toMatchMetricObservationV3,
  validateMatchMetricObservationV3,
  type RawMetricObservationV3,
} from "../electron/main/matches/metric-observations-v3.js"

const raw = (
  metricKey: string,
  value: number,
): RawMetricObservationV3 => ({
  metricKey,
  rawEvidence: observed(value, { source: "derived" }),
  unit: "ratio",
  source: "derived",
  sourceQuality: "derived",
})

describe("Recall v3 metric observations", () => {
  it("preserves an observed raw and calibrated zero", () => {
    const observation = toMatchMetricObservationV3(
      raw("damage_share", 0),
      {
        gameId: 1,
        puuid: "owner",
        participantId: 1,
        recipeId: "rvi:test",
        calibrationId: "calibration:test",
        derivationId: "derivation:test",
        derivedAt: 0,
      },
      observed(0, { source: "derived" }),
      { comparisonScope: "position", referenceMatchCount: 10 },
    )
    expect(() => validateMatchMetricObservationV3(observation)).not.toThrow()
    expect(observation.rawEvidence).toMatchObject({ state: "observed", value: 0 })
    expect(observation.scoreEvidence).toMatchObject({ state: "observed", value: 0 })
  })

  it("collects only observed finite rows and retains zero in the frozen reference", () => {
    const rows = collectDetailMetricCalibrationRowsV3([
      {
        matchId: "NA1_1",
        scopeKey: "ranked:rules-r1",
        position: "middle",
        archetype: "burst_mage",
        observations: [raw("damage_share", 0), {
          ...raw("time_dead_share", 1),
          rawEvidence: unavailable("source_not_captured"),
        }],
      },
    ])
    expect(rows).toEqual([expect.objectContaining({
      metricKey: "damage_share",
      value: 0,
      position: "MIDDLE",
      archetype: "BURST_MAGE",
    })])
  })

  it("builds archetype to position to mode cohorts and excludes the subject match", () => {
    const matches = Array.from({ length: 12 }, (_, index) => ({
      matchId: `NA1_${index}`,
      scopeKey: "ranked:rules-r1",
      position: index < 8 ? "MIDDLE" : "TOP",
      archetype: index < 4 ? "BURST_MAGE" : "ASSASSIN",
      observations: [raw("damage_share", index / 100)],
    }))
    const rows = collectDetailMetricCalibrationRowsV3(matches)
    const target = {
      matchId: "NA1_0",
      scopeKey: "ranked:rules-r1",
      position: "MIDDLE",
      archetype: "BURST_MAGE",
    }
    expect(detailMetricCalibrationCohortV3("damage_share", target, rows)).toMatchObject({
      comparisonScope: "archetype",
      referenceMatchCount: 3,
      rootReferenceMatchCount: 11,
    })
    const higher = calibrateRawDetailMetricV3(raw("damage_share", .05), target, rows, {
      minimumReferenceMatches: 1,
      kappa: 0,
      direction: "higher",
    })
    const lower = calibrateRawDetailMetricV3(raw("damage_share", .05), target, rows, {
      minimumReferenceMatches: 1,
      kappa: 0,
      direction: "lower",
    })
    expect(higher).toMatchObject({
      comparisonScope: "archetype",
      referenceMatchCount: 3,
      scoreEvidence: { state: "observed" },
    })
    expect(lower.scoreEvidence.state).toBe("observed")
    if (higher.scoreEvidence.state === "observed" && lower.scoreEvidence.state === "observed") {
      expect(higher.scoreEvidence.value + lower.scoreEvidence.value).toBeCloseTo(1, 12)
    }
  })

  it("preserves raw evidence when the reference is too small or the source is absent", () => {
    const target = { matchId: 1, scopeKey: "ranked:rules-r1" }
    const result = calibrateRawDetailMetricV3(raw("damage_share", .2), target, [], {
      minimumReferenceMatches: 10,
    })
    expect(result.scoreEvidence).toMatchObject({
      state: "unavailable",
      reason: "reference_population_too_small",
    })
    const absent = calibrateRawDetailMetricV3({
      ...raw("time_dead_share", 0),
      rawEvidence: unavailable("source_not_captured"),
    }, target, [])
    expect(absent.scoreEvidence).toMatchObject({
      state: "unavailable",
      reason: "source_not_captured",
    })
  })
})
