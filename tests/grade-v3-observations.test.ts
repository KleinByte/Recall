import { describe, expect, it } from "vitest"
import {
  buildGradeCalibrationSnapshotV3,
  deriveRawMetricEvidenceV3,
  gradeCalibrationClusterIdV3,
  prepareGradeLobbyFromSnapshotV3,
  type GradeRawLobbyV3,
  type GradeRawParticipantV3,
} from "../electron/main/matches/grade-v3-observations.js"
import {
  rawResponsibilityScoresV3,
  scoreLobbyV3,
} from "../electron/main/matches/grade-v3.js"
import { shrunkMidEcdf } from "../electron/main/matches/grade-v3-calibration.js"
import { gradeForRoleFitScore } from "../electron/main/matches/grade-v3-recipe.js"
import type { NormalizedPosition } from "../electron/main/matches/position.js"
import { calibrationScopeKey } from "../electron/main/matches/grade-v3-taxonomy.js"

const POSITIONS: readonly NormalizedPosition[] = [
  "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY",
]

function player(
  participantId: number,
  matchId: number,
  overrides: Partial<GradeRawParticipantV3> = {},
): GradeRawParticipantV3 {
  const index = participantId - 1
  return {
    participantId,
    teamId: index < 5 ? 100 : 200,
    isPlayer: participantId === 1,
    championId: 18,
    position: POSITIONS[index % 5],
    kills: 1 + index % 3,
    deaths: index % 4,
    assists: 2 + index % 5,
    damageToChampions: 5_000 + matchId * 20 + index * 500,
    goldEarned: 7_000 + matchId * 10 + index * 200,
    totalMinionsKilled: 40 + index * 15,
    neutralMinions: index % 3,
    damageObjectives: matchId * 20 + index * 100,
    damageTurrets: matchId * 10 + index * 50,
    damageStructures: matchId * 10 + index * 50,
    visionScore: 5 + index,
    timeCcingOthers: index,
    totalHealsOnTeammates: 0,
    totalDamageShieldedOnTeammates: 0,
    ...overrides,
  }
}

function lobby(
  matchId: number,
  participantOverrides: Partial<GradeRawParticipantV3> = {},
  contextOverrides: Partial<GradeRawLobbyV3["context"]> = {},
): GradeRawLobbyV3 {
  return {
    clusterId: `NA1:${matchId}`,
    matchId,
    puuid: "owner",
    durationSecs: 1_200,
    context: {
      modeFamily: "sr",
      trackedMode: "sr_normal",
      ruleset: "standard_sr",
      rulesetKey: "sr_normal:rules-r1",
      ...contextOverrides,
    },
    players: Array.from({ length: 10 }, (_, index) =>
      player(index + 1, matchId, index === 0 ? participantOverrides : {})),
  }
}

describe("Grade v3 raw observations", () => {
  it("keeps explicit zero as observed evidence", () => {
    const evidence = deriveRawMetricEvidenceV3(lobby(1, {
      deaths: 0,
      damageToChampions: 0,
      damageObjectives: 0,
      damageTurrets: 0,
      damageStructures: 0,
      visionScore: 0,
      timeCcingOthers: 0,
      totalHealsOnTeammates: 0,
      totalDamageShieldedOnTeammates: 0,
    })).get(1)

    expect(evidence?.damage_share).toMatchObject({ state: "observed", value: 0 })
    expect(evidence?.deaths_per_10).toMatchObject({ state: "observed", value: 0 })
    expect(evidence?.neutral_objective_damage_per_min)
      .toMatchObject({ state: "observed", value: 0 })
    expect(evidence?.structure_damage_per_min).toMatchObject({ state: "observed", value: 0 })
    expect(evidence?.vision_score_per_min).toMatchObject({ state: "observed", value: 0 })
    expect(evidence?.cc_seconds_per_min).toMatchObject({ state: "observed", value: 0 })
    expect(evidence?.ally_heal_shield_per_min).toMatchObject({ state: "observed", value: 0 })
  })

  it("separates neutral-objective damage from structure damage and clamps overlap", () => {
    const split = deriveRawMetricEvidenceV3(lobby(1, {
      damageObjectives: 1_500,
      damageTurrets: 500,
      damageStructures: 800,
    })).get(1)
    const fullyOverlapped = deriveRawMetricEvidenceV3(lobby(2, {
      damageObjectives: 500,
      damageTurrets: 800,
      damageStructures: 1_200,
    })).get(1)

    expect(split?.neutral_objective_damage_per_min)
      .toMatchObject({ state: "observed", value: 50 })
    expect(split?.structure_damage_per_min)
      .toMatchObject({ state: "observed", value: 40 })
    expect(fullyOverlapped?.neutral_objective_damage_per_min)
      .toMatchObject({ state: "observed", value: 0 })
  })

  it("distinguishes a missing optional source fact from an observed zero", () => {
    const missing = deriveRawMetricEvidenceV3(lobby(1, {
      totalHealsOnTeammates: undefined,
      totalDamageShieldedOnTeammates: undefined,
    })).get(1)?.ally_heal_shield_per_min
    const zero = deriveRawMetricEvidenceV3(lobby(2, {
      totalHealsOnTeammates: 0,
      totalDamageShieldedOnTeammates: 0,
    })).get(1)?.ally_heal_shield_per_min

    expect(missing).toMatchObject({ state: "unavailable" })
    expect(zero).toMatchObject({ state: "observed", value: 0 })
  })

  it("does not turn one missing ally-sustain field into an observed zero", () => {
    const missingHeal = deriveRawMetricEvidenceV3(lobby(1, {
      totalHealsOnTeammates: undefined,
      totalDamageShieldedOnTeammates: 0,
    })).get(1)?.ally_heal_shield_per_min
    const missingShield = deriveRawMetricEvidenceV3(lobby(2, {
      totalHealsOnTeammates: 0,
      totalDamageShieldedOnTeammates: undefined,
    })).get(1)?.ally_heal_shield_per_min

    expect(missingHeal).toMatchObject({ state: "unavailable" })
    expect(missingShield).toMatchObject({ state: "unavailable" })
  })

  it("does not let missing diagnostic sustain reduce grade evidence coverage", () => {
    const snapshot = buildGradeCalibrationSnapshotV3(
      Array.from({ length: 10 }, (_, index) => lobby(index + 1)),
    )
    const subject = lobby(100)
    const withoutSustain: GradeRawLobbyV3 = {
      ...subject,
      players: subject.players.map((entry) => ({
        ...entry,
        totalHealsOnTeammates: undefined,
        totalDamageShieldedOnTeammates: undefined,
      })),
    }

    const prepared = prepareGradeLobbyFromSnapshotV3(withoutSustain, snapshot)
    expect(prepared.evidenceCoverage).toBe(1)
    expect(prepared.referenceSampleCount).toBe(10)
    expect(prepared.players[0].metricEvidence.ally_heal_shield_per_min)
      .toMatchObject({ state: "unavailable" })
  })

  it("uses a neutral percentile only when the team had no opportunity", () => {
    const base = lobby(1)
    const noKills: GradeRawLobbyV3 = {
      ...base,
      players: base.players.map((entry) => ({ ...entry, kills: 0 })),
    }
    const snapshot = buildGradeCalibrationSnapshotV3(
      Array.from({ length: 10 }, (_, index) => lobby(index + 10)),
    )

    const prepared = prepareGradeLobbyFromSnapshotV3(noKills, snapshot)
    expect(prepared.evidenceCoverage).toBe(1)
    expect(prepared.players[0].metricEvidence.kill_participation).toMatchObject({
      state: "observed",
      value: .5,
      reason: "team_had_no_kills",
    })
    const outcome = scoreLobbyV3({
      players: prepared.players,
      context: noKills.context,
      calibrationSnapshotId: "test.no-opportunity",
    })
    expect(outcome.status).toBe("ready")
    expect(outcome.results.get(1)!.breakdown.components
      .find((entry) => entry.key === "combat")!.signals
      .find((entry) => entry.key === "kill_participation"))
      .toMatchObject({
        sourceEvidenceState: "no_opportunity",
        sourceEvidenceReason: "team_had_no_kills",
      })
  })

  it("calibrates the raw responsibility composite into a true frozen-reference percentile", () => {
    const snapshot = buildGradeCalibrationSnapshotV3(
      Array.from({ length: 10 }, (_, index) => lobby(index + 1)),
    )
    expect(snapshot.compositeObservations).toHaveLength(100)
    const subject = lobby(100, {
      damageToChampions: 100_000,
      goldEarned: 20_000,
    })
    const prepared = prepareGradeLobbyFromSnapshotV3(subject, snapshot)
    const raw = rawResponsibilityScoresV3({
      players: prepared.players,
      context: subject.context,
    }).results.get(1)!
    const scopeRows = snapshot.compositeObservations.filter((entry) =>
      entry.scopeKey === calibrationScopeKey(subject.context))
    const positionRows = scopeRows.filter((entry) => entry.position === raw.position)
    const archetypeRows = positionRows.filter((entry) =>
      entry.archetype === raw.primaryArchetype)
    const observations = (rows: typeof scopeRows) => rows.map((entry) => ({
      matchId: entry.clusterId,
      value: entry.value,
    }))
    const expected = shrunkMidEcdf(raw.rawResponsibilityComposite, {
      observations: observations(archetypeRows),
      parent: {
        observations: observations(positionRows),
        parent: { observations: observations(scopeRows) },
      },
    }, { rootKappa: 0, excludeMatchId: subject.clusterId })
    const percentile = prepared.players[0].responsibilityEvidence
    expect(percentile).toMatchObject({ state: "observed", value: expected.percentile })

    const outcome = scoreLobbyV3({
      players: prepared.players,
      context: subject.context,
      calibrationSnapshotId: "test.composite-ecdf",
    })
    const result = outcome.results.get(1)!
    expect(result.breakdown.rawResponsibilityScore)
      .toBeCloseTo(raw.rawResponsibilityComposite * 100)
    expect(result.roleFitScore).toBeCloseTo(expected.percentile * 100)
    expect(result.grade).toBe(gradeForRoleFitScore(result.roleFitScore))
  })

  it("excludes the entire subject match from final-composite calibration", () => {
    const subject = lobby(1, {
      damageToChampions: 500_000,
      goldEarned: 50_000,
      totalMinionsKilled: 1_000,
      damageObjectives: 100_000,
      damageTurrets: 10_000,
      damageStructures: 50_000,
      visionScore: 500,
      timeCcingOthers: 500,
    })
    const snapshot = buildGradeCalibrationSnapshotV3([
      subject,
      ...Array.from({ length: 9 }, (_, index) => lobby(index + 2)),
    ])
    const prepared = prepareGradeLobbyFromSnapshotV3(subject, snapshot)
    const raw = rawResponsibilityScoresV3({
      players: prepared.players,
      context: subject.context,
    }).results.get(1)!
    const scopeRows = snapshot.compositeObservations.filter((entry) =>
      entry.scopeKey === calibrationScopeKey(subject.context))
    const positionRows = scopeRows.filter((entry) => entry.position === raw.position)
    const archetypeRows = positionRows.filter((entry) =>
      entry.archetype === raw.primaryArchetype)
    const observations = (rows: typeof scopeRows) => rows.map((entry) => ({
      matchId: entry.clusterId,
      value: entry.value,
    }))
    const cohort = {
      observations: observations(archetypeRows),
      parent: {
        observations: observations(positionRows),
        parent: { observations: observations(scopeRows) },
      },
    }
    const excluded = shrunkMidEcdf(raw.rawResponsibilityComposite, cohort, {
      rootKappa: 0,
      excludeMatchId: subject.clusterId,
    })
    const included = shrunkMidEcdf(raw.rawResponsibilityComposite, cohort, {
      rootKappa: 0,
    })

    expect(prepared.referenceSampleCount).toBe(9)
    expect(prepared.players[0].responsibilityEvidence)
      .toMatchObject({ state: "observed", value: excluded.percentile })
    expect(excluded.percentile).not.toBe(included.percentile)
  })

  it("withholds RoleFit when a snapshot lacks a composite reference", () => {
    const snapshot = buildGradeCalibrationSnapshotV3(
      Array.from({ length: 10 }, (_, index) => lobby(index + 1)),
    )
    const malformed: typeof snapshot = { ...snapshot, compositeObservations: [] }
    const prepared = prepareGradeLobbyFromSnapshotV3(lobby(100), malformed)
    expect(prepared.referenceSampleCount).toBe(0)
    expect(prepared.players[0].responsibilityEvidence).toMatchObject({
      state: "unavailable",
      reason: "composite_reference_population_too_small",
    })
  })

  it("never mutates the frozen reference while grading later matches", () => {
    const snapshot = buildGradeCalibrationSnapshotV3(
      Array.from({ length: 10 }, (_, index) => lobby(index + 1)),
    )
    const serialized = JSON.stringify(snapshot)

    const first = prepareGradeLobbyFromSnapshotV3(lobby(100, {
      damageToChampions: 1,
    }), snapshot)
    const second = prepareGradeLobbyFromSnapshotV3(lobby(101, {
      damageToChampions: 999_999,
    }), snapshot)

    expect(JSON.stringify(snapshot)).toBe(serialized)
    expect(snapshot.clusterIds).toHaveLength(10)
    expect(first.referenceSampleCount).toBe(10)
    expect(second.referenceSampleCount).toBe(10)
  })

  it("builds the same content-addressable snapshot regardless of input order", () => {
    const references = Array.from({ length: 10 }, (_, index) => lobby(index + 1))
    const forward = buildGradeCalibrationSnapshotV3(references)
    const reversed = buildGradeCalibrationSnapshotV3([...references].reverse().map((entry) => ({
      ...entry,
      players: [...entry.players].reverse(),
    })))
    expect(reversed).toEqual(forward)
  })

  it("freezes only exact mode and ruleset scopes with ten independent matches", () => {
    const ruleOne = Array.from({ length: 10 }, (_, index) => lobby(index + 1))
    const ruleTwo = Array.from({ length: 9 }, (_, index) => lobby(index + 101, {}, {
      rulesetKey: "sr_normal:rules-r2",
    }))
    const snapshot = buildGradeCalibrationSnapshotV3([...ruleOne, ...ruleTwo])
    const ruleOneScope = calibrationScopeKey(ruleOne[0].context)
    const ruleTwoScope = calibrationScopeKey(ruleTwo[0].context)

    expect(snapshot.referencePopulation.supportedScopes).toEqual([ruleOneScope])
    expect(snapshot.referencePopulation.supportedModes).toEqual(["sr_normal"])
    expect(snapshot.referencePopulation.scopeMatchCounts).toEqual({ [ruleOneScope]: 10 })
    expect(snapshot.clusterIds).toHaveLength(10)

    const unrepresented = prepareGradeLobbyFromSnapshotV3(lobby(999, {}, {
      rulesetKey: "sr_normal:rules-r2",
    }), snapshot)
    expect(unrepresented.referenceSampleCount).toBe(0)
    expect(unrepresented.referenceMetadata).toMatchObject({
      scopeKey: ruleTwoScope,
      scopeFrozen: false,
      supportedScopes: [ruleOneScope],
    })
    expect(unrepresented.players[0].metricEvidence.damage_share)
      .toMatchObject({ state: "unavailable", reason: "reference_population_too_small" })
  })

  it("does not freeze an aggregate of individually underfilled scopes", () => {
    const normal = Array.from({ length: 5 }, (_, index) => lobby(index + 1))
    const aram = Array.from({ length: 5 }, (_, index) => lobby(index + 101, {}, {
      modeFamily: "aram",
      trackedMode: "aram",
      ruleset: "howling_abyss",
      rulesetKey: "aram:rules-r1",
    }))
    const snapshot = buildGradeCalibrationSnapshotV3([...normal, ...aram])

    expect(snapshot.referencePopulation.supportedScopes).toEqual([])
    expect(snapshot.referencePopulation.supportedModes).toEqual([])
    expect(snapshot.clusterIds).toEqual([])
  })

  it("does not merge equal numeric game ids from different platforms", () => {
    const northAmerica = Array.from({ length: 5 }, (_, index) => ({
      ...lobby(index + 1),
      clusterId: `NA1:${index + 1}`,
    }))
    const europe = Array.from({ length: 5 }, (_, index) => ({
      ...lobby(index + 1),
      clusterId: `EUW1:${index + 1}`,
      puuid: "europe-owner",
    }))
    const snapshot = buildGradeCalibrationSnapshotV3([...northAmerica, ...europe])

    expect(snapshot.clusterIds).toHaveLength(10)
    expect(snapshot.referencePopulation.scopeMatchCounts).toEqual({
      [calibrationScopeKey(northAmerica[0].context)]: 10,
    })
    const prepared = prepareGradeLobbyFromSnapshotV3(northAmerica[0], snapshot)
    // Only NA1_1 is removed. EUW1_1 has the same numeric game id but remains
    // an independent reference cluster.
    expect(prepared.referenceSampleCount).toBe(9)
  })

  it("deduplicates Match-V5 and LCU identities for the same lobby", () => {
    const matchV5 = gradeCalibrationClusterIdV3({
      gameId: 123,
      puuid: "match-v5-owner",
      riotMatchId: "na1_123",
    })
    const lcu = gradeCalibrationClusterIdV3({
      gameId: 123,
      puuid: "lcu-owner",
      platformId: "na1",
    })
    const otherRegion = gradeCalibrationClusterIdV3({
      gameId: 123,
      puuid: "euw-owner",
      platformId: "EUW1",
    })

    expect(matchV5).toBe("NA1:123")
    expect(lcu).toBe(matchV5)
    expect(otherRegion).not.toBe(matchV5)

    const references = Array.from({ length: 10 }, (_, index) => lobby(index + 1))
    const duplicateLcuView: GradeRawLobbyV3 = {
      ...references[0],
      puuid: "second-local-account",
      clusterId: gradeCalibrationClusterIdV3({
        gameId: 1,
        puuid: "second-local-account",
        platformId: "NA1",
      }),
    }
    const snapshot = buildGradeCalibrationSnapshotV3([...references, duplicateLcuView])
    expect(snapshot.clusterIds).toHaveLength(10)
    expect(snapshot.compositeObservations).toHaveLength(100)
  })
})
