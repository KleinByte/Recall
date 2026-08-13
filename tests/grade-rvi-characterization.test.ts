import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { observed, unavailable, type Evidence } from "../src/shared/measurement.js"
import { canonicalJson } from "../electron/main/database/match-source-repo.js"
import {
  buildGradeCalibrationSnapshot,
  deriveRawMetricEvidence,
  prepareGradeLobbyFromSnapshot,
} from "../electron/main/matches/match-grade-observations.js"
import { scoreMatchLobby } from "../electron/main/matches/match-grade.js"
import {
  MATCH_GRADE_ARM_KEYS,
  CURRENT_GRADE_RECIPE,
  MATCH_GRADE_SCORE_THRESHOLDS,
  recipeIdForCalibration,
} from "../electron/main/matches/match-grade-recipe.js"
import {
  METRIC_DEFINITIONS,
  RVI_METRIC_POLICIES,
  metricDefinition,
  rviMetricPolicy,
} from "../electron/main/matches/match-metric-registry.js"
import {
  RVI_VECTOR_KEYS,
  aggregateRviProfile,
  type RviMatchObservation,
  type RviMetricObservation,
} from "../electron/main/matches/rvi-contract.js"
import {
  rviRecipeDefinition,
  rviRecipeIdForCalibration,
} from "../electron/main/matches/rvi-recipe.js"
import {
  CHARACTERIZATION_CONTEXT,
  characterizationReferenceLobbies,
  characterizationSubjectLobby,
} from "./fixtures/grade-rvi-characterization.js"

const sha256 = (value: unknown) => createHash("sha256")
  .update(canonicalJson(value))
  .digest("hex")

function frozenReference() {
  const snapshot = buildGradeCalibrationSnapshot(characterizationReferenceLobbies())
  const calibrationHash = sha256(snapshot)
  const calibrationId = `recall.grade.calibration.${calibrationHash}`
  const gradeRecipeId = recipeIdForCalibration(calibrationId)
  const gradeDefinition = {
    ...CURRENT_GRADE_RECIPE,
    calibrationId,
    calibrationHash,
    referencePopulation: snapshot.referencePopulation,
  }
  const rviDefinition = rviRecipeDefinition(gradeRecipeId, calibrationId)
  return {
    snapshot,
    calibrationHash,
    calibrationId,
    gradeRecipeId,
    gradeDefinition,
    rviDefinition,
  }
}

function compactEvidence(evidence: Evidence<number> | undefined) {
  if (!evidence) return { state: "missing" as const }
  return evidence.state === "observed"
    ? { state: evidence.state, value: evidence.value, source: evidence.source }
    : { state: evidence.state, reason: evidence.reason, source: evidence.source }
}

function metricObservation(
  key: string,
  rawEvidence: Evidence<number>,
  scoreEvidence: Evidence<number>,
  gradeWeight: number,
): RviMetricObservation {
  const definition = metricDefinition(key)
  const policy = rviMetricPolicy(key)
  if (!definition || !policy) throw new Error(`unknown characterization metric: ${key}`)
  return {
    key,
    vector: policy.vector,
    label: definition.label,
    description: definition.description,
    formula: definition.formula,
    unit: definition.unit,
    tier: policy.tier,
    vectorWeight: policy.vectorWeight,
    gradeWeight,
    rawEvidence,
    scoreEvidence,
    comparisonScope: "role",
    referenceMatchCount: 12,
  }
}

describe("Grade and RVI canonical characterization", () => {
  it("freezes the exact persisted recipe manifests and metric eligibility contract", () => {
    const reference = frozenReference()
    const aramContext = {
      modeFamily: "aram" as const,
      trackedMode: "aram",
      ruleset: "howling_abyss",
      rulesetKey: "aram:rules-r1",
    }
    const metricManifest = METRIC_DEFINITIONS.map((definition) => {
      const policy = rviMetricPolicy(definition.key)
      if (!policy) throw new Error(`missing policy: ${definition.key}`)
      return {
        key: definition.key,
        vector: policy.vector,
        tier: policy.tier,
        vectorWeight: policy.vectorWeight,
        direction: definition.direction,
        source: definition.source,
        eligible: {
          srMiddle: definition.applicable({
            context: CHARACTERIZATION_CONTEXT,
            position: "MIDDLE",
          }),
          srUtility: definition.applicable({
            context: CHARACTERIZATION_CONTEXT,
            position: "UTILITY",
          }),
          aram: definition.applicable({ context: aramContext, position: "UNKNOWN" }),
        },
      }
    })

    expect({
      calibrationHash: reference.calibrationHash,
      calibrationId: reference.calibrationId,
      gradeRecipeId: reference.gradeRecipeId,
      gradeRecipeHash: sha256(reference.gradeDefinition),
      gradeDefinitionId: CURRENT_GRADE_RECIPE.recipeDefinitionId,
      gradeArms: MATCH_GRADE_ARM_KEYS.join("|"),
      gradeThresholdsHash: sha256(MATCH_GRADE_SCORE_THRESHOLDS),
      rviRecipeId: reference.rviDefinition.recipeId,
      rviRecipeHash: sha256(reference.rviDefinition),
      rviVectors: reference.rviDefinition.vectors.map((entry) => entry.key).join("|"),
      metricCount: METRIC_DEFINITIONS.length,
      policyCount: RVI_METRIC_POLICIES.length,
      metricManifestHash: sha256(metricManifest),
      eligibilityCounts: {
        srMiddle: metricManifest.filter((entry) => entry.eligible.srMiddle).length,
        srUtility: metricManifest.filter((entry) => entry.eligible.srUtility).length,
        aram: metricManifest.filter((entry) => entry.eligible.aram).length,
      },
    }).toMatchInlineSnapshot(`
      {
        "calibrationHash": "3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086",
        "calibrationId": "recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086",
        "eligibilityCounts": {
          "aram": 27,
          "srMiddle": 62,
          "srUtility": 60,
        },
        "gradeArms": "combat|positioning_survival|control_utility|economy|objectives_macro|vision_setup|initiative_pressure",
        "gradeDefinitionId": "recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3",
        "gradeRecipeHash": "07efc7538c972357cbab6af1a881611ac65ec4180182b97d50aa580ae890e08b",
        "gradeRecipeId": "recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3@calibration:recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086",
        "gradeThresholdsHash": "5a707e37f10a743de5e6f912fecac3d53a206ca4af367cd57178c2c49d3395d5",
        "metricCount": 62,
        "metricManifestHash": "6f00c91babe8a36420b8f423f391555b5c3ec394467189ab67112b3dbee25c7b",
        "policyCount": 62,
        "rviRecipeHash": "0b31e93323e89b2383527dedaecf8e0913036b54a606cee0f7a736f052b9dcb0",
        "rviRecipeId": "recall.rvi.definition.dcd9eb30fa637a870a44d3c48dc458149b9892687a476992c3a7dc95be743b1b@grade:recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3@calibration:recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086@calibration:recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086",
        "rviVectors": "combat|positioning_survival|control_utility|economy|objectives_macro|vision_setup|initiative_pressure|consistency_versatility",
      }
    `)
  })

  it("freezes one raw-facts-to-Grade golden result without collapsing zero into missing", () => {
    const reference = frozenReference()
    const subject = characterizationSubjectLobby()
    const raw = deriveRawMetricEvidence(subject).get(1)
    const prepared = prepareGradeLobbyFromSnapshot(subject, reference.snapshot)
    const outcome = scoreMatchLobby({
      players: prepared.players,
      context: subject.context,
      calibrationSnapshotId: reference.calibrationId,
    })
    const owner = outcome.results.get(1)
    if (!owner) throw new Error(`characterization Grade was not ready: ${outcome.reason}`)

    expect({
      status: outcome.status,
      algorithmVersion: outcome.algorithmVersion,
      recipeDefinitionId: outcome.recipeDefinitionId,
      recipeId: outcome.recipeId,
      evidenceCoverage: prepared.evidenceCoverage,
      referenceSampleCount: prepared.referenceSampleCount,
      sourceEvidence: {
        literalZeroDamageShare: compactEvidence(raw?.damage_share),
        unavailableAllySustain: compactEvidence(raw?.ally_heal_shield_per_min),
      },
      calibratedEvidence: {
        literalZeroDamageShare: compactEvidence(
          prepared.players[0].metricEvidence.damage_share,
        ),
        unavailableAllySustain: compactEvidence(
          prepared.players[0].metricEvidence.ally_heal_shield_per_min,
        ),
      },
      result: {
        breakdownHash: sha256(owner.breakdown),
        grade: owner.grade,
        recallScore: owner.recallScore,
        gradeScore: owner.gradeScore,
        lobbyPercentile: owner.lobbyPercentile,
        rawResponsibilityScore: owner.breakdown.rawResponsibilityScore,
        recallScoreCalibrationSource: owner.breakdown.recallScoreCalibrationSource,
        responsibilityTiers: owner.breakdown.responsibilityTiers,
        neutralizedResponsibilityWeight: owner.breakdown.neutralizedResponsibilityWeight,
        neutralizedResponsibilityContribution: owner.breakdown
          .neutralizedResponsibilityContribution,
        components: owner.breakdown.components.map((component) => ({
          key: component.key,
          percentile: component.rankPercentile,
          tier: component.responsibilityTier,
          weight: component.weight,
        })),
        signalManifestHash: sha256(owner.breakdown.components.map((component) => ({
          key: component.key,
          signals: component.signals,
        }))),
        omittedComponents: owner.breakdown.omittedComponents,
      },
    }).toMatchInlineSnapshot(`
      {
        "algorithmVersion": 3,
        "calibratedEvidence": {
          "literalZeroDamageShare": {
            "source": "derived",
            "state": "observed",
            "value": 0.1220703125,
          },
          "unavailableAllySustain": {
            "reason": "source_did_not_capture_complete_ally_heal_and_shield",
            "source": "legacy",
            "state": "unavailable",
          },
        },
        "evidenceCoverage": 1,
        "recipeDefinitionId": "recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3",
        "recipeId": "recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3@calibration:recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086",
        "referenceSampleCount": 12,
        "result": {
          "breakdownHash": "ad8ab10c8f73a6fb4adbf8cdc8751664811623056b0da6559550723177bf7b0d",
          "components": [
            {
              "key": "combat",
              "percentile": 0.5,
              "tier": 2,
              "weight": 0.285714285714,
            },
            {
              "key": "positioning_survival",
              "percentile": 0.70361328125,
              "tier": 1,
              "weight": 0.142857142857,
            },
            {
              "key": "control_utility",
              "percentile": 0.8779296875,
              "tier": 0,
              "weight": 0,
            },
            {
              "key": "economy",
              "percentile": 0.8779296875,
              "tier": 2,
              "weight": 0.285714285714,
            },
            {
              "key": "objectives_macro",
              "percentile": 0.8779296875,
              "tier": 1,
              "weight": 0.142857142857,
            },
            {
              "key": "vision_setup",
              "percentile": 0.8779296875,
              "tier": 0,
              "weight": 0,
            },
          ],
          "grade": "S+",
          "gradeScore": 2.326347874388028,
          "lobbyPercentile": 1,
          "neutralizedResponsibilityContribution": 0.103271484375,
          "neutralizedResponsibilityWeight": 0.142857142857,
          "omittedComponents": [
            {
              "evidenceState": "not_applicable",
              "key": "initiative_pressure",
              "reason": "no_observed_arm_metrics",
            },
          ],
          "rawResponsibilityScore": 72.2900390625,
          "recallScore": 99,
          "recallScoreCalibrationSource": "local_shrunk",
          "responsibilityTiers": {
            "combat": 2,
            "control_utility": 0,
            "economy": 2,
            "initiative_pressure": 1,
            "objectives_macro": 1,
            "positioning_survival": 1,
            "vision_setup": 0,
          },
          "signalManifestHash": "99b55618ce50d8ac34085825be63d07e7f9f00b2a82342aa4b8453d8115069dc",
        },
        "sourceEvidence": {
          "literalZeroDamageShare": {
            "source": "derived",
            "state": "observed",
            "value": 0,
          },
          "unavailableAllySustain": {
            "reason": "source_did_not_capture_complete_ally_heal_and_shield",
            "source": "legacy",
            "state": "unavailable",
          },
        },
        "status": "ready",
      }
    `)
  })

  it("freezes RVI coverage, metric aggregation, and below-threshold Range eligibility", () => {
    const reference = frozenReference()
    const subject = characterizationSubjectLobby()
    const raw = deriveRawMetricEvidence(subject).get(1)
    const prepared = prepareGradeLobbyFromSnapshot(subject, reference.snapshot)
    const outcome = scoreMatchLobby({
      players: prepared.players,
      context: subject.context,
      calibrationSnapshotId: reference.calibrationId,
    })
    const owner = outcome.results.get(1)
    const rawDamageShare = raw?.damage_share
    const rawAllySustain = raw?.ally_heal_shield_per_min
    if (!owner || !rawDamageShare || !rawAllySustain) {
      throw new Error(`characterization Grade was not ready: ${outcome.reason}`)
    }

    const familyPercentiles = Object.fromEntries(
      RVI_VECTOR_KEYS.map((key) => [key, null]),
    ) as Record<string, number | null>
    const familyResponsibilityWeights = Object.fromEntries(
      RVI_VECTOR_KEYS.map((key) => [key, null]),
    ) as Record<string, number | null>
    for (const component of owner.breakdown.components) {
      familyPercentiles[component.key] = component.rankPercentile * 100
      familyResponsibilityWeights[component.key] = component.weight
    }
    const combat = owner.breakdown.components.find((entry) => entry.key === "combat")
    const damageShare = combat?.signals.find((entry) => entry.key === "damage_share")
    if (!combat || !damageShare) throw new Error("characterization damage-share signal missing")

    const rviRecipeId = rviRecipeIdForCalibration(
      reference.gradeRecipeId,
      reference.calibrationId,
    )
    const observations: RviMatchObservation[] = [
      {
        matchId: subject.matchId,
        recipeId: rviRecipeId,
        playedAt: subject.playedAt!,
        recallScore: owner.recallScore,
        familyPercentiles,
        familyResponsibilityWeights,
        championId: subject.players[0].championId,
        position: subject.players[0].position,
        primaryArchetype: owner.breakdown.primaryArchetype,
        metrics: [
          metricObservation(
            "damage_share",
            rawDamageShare,
            observed(damageShare.percentile * 100, { source: "derived" }),
            combat.weight * damageShare.weight,
          ),
          metricObservation(
            "ally_heal_shield_per_min",
            rawAllySustain,
            unavailable("ally_heal_shield_per_min_source_not_captured", {
              source: "legacy",
            }),
            0,
          ),
        ],
      },
      {
        matchId: subject.matchId + 1,
        recipeId: rviRecipeId,
        playedAt: subject.playedAt! + 60_000,
        recallScore: null,
        familyPercentiles: Object.fromEntries(RVI_VECTOR_KEYS.map((key) => [key, null])),
        familyResponsibilityWeights:
          Object.fromEntries(RVI_VECTOR_KEYS.map((key) => [key, null])),
        championId: subject.players[0].championId,
        position: subject.players[0].position,
        primaryArchetype: owner.breakdown.primaryArchetype,
        metrics: [
          metricObservation(
            "damage_share",
            unavailable("damage_share_source_not_captured", { source: "legacy" }),
            unavailable("damage_share_reference_unavailable", { source: "legacy" }),
            0,
          ),
          metricObservation(
            "ally_heal_shield_per_min",
            observed(0, { source: "derived" }),
            observed(0, { source: "derived" }),
            0,
          ),
        ],
      },
    ]
    const aggregate = aggregateRviProfile({
      recipeId: rviRecipeId,
      familyKeys: RVI_VECTOR_KEYS,
      observations,
    })
    const damageMetric = aggregate.families
      .find((family) => family.key === "combat")?.metrics
      .find((metric) => metric.key === "damage_share")
    const sustainMetric = aggregate.families
      .find((family) => family.key === "control_utility")?.metrics
      .find((metric) => metric.key === "ally_heal_shield_per_min")

    expect({
      algorithmVersion: aggregate.algorithmVersion,
      recipeId: aggregate.recipeId,
      aggregateHash: sha256(aggregate),
      headline: aggregate.headline,
      families: aggregate.families.map((family) => ({
        key: family.key,
        score: family.score,
        confidence: family.confidence,
        observedGames: family.coverage.observedGames,
        eligibleGames: family.coverage.eligibleGames,
        averageResponsibility: family.responsibility.averageWeight,
        positiveResponsibilityGames: family.responsibility.positiveGames,
      })),
      literalZeroDamageShare: damageMetric && {
        score: damageMetric.score,
        rawValue: damageMetric.rawValue,
        evidenceState: damageMetric.evidenceState,
        scoreObservedGames: damageMetric.coverage.observedGames,
        rawObservedGames: damageMetric.rawCoverage.observedGames,
      },
      missingThenObservedZeroSustain: sustainMetric && {
        score: sustainMetric.score,
        rawValue: sustainMetric.rawValue,
        evidenceState: sustainMetric.evidenceState,
        evidenceReason: sustainMetric.evidenceReason,
        scoreObservedGames: sustainMetric.coverage.observedGames,
        rawObservedGames: sustainMetric.rawCoverage.observedGames,
      },
    }).toMatchInlineSnapshot(`
      {
        "aggregateHash": "d7461b76e6762890edad4c77bb6efb722c74baef23309ddfe4839dc4d759da80",
        "algorithmVersion": 3,
        "families": [
          {
            "averageResponsibility": 0.142857142857,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "combat",
            "observedGames": 1,
            "positiveResponsibilityGames": 1,
            "score": 50,
          },
          {
            "averageResponsibility": 0.142857142857,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "positioning_survival",
            "observedGames": 1,
            "positiveResponsibilityGames": 1,
            "score": 70.361328125,
          },
          {
            "averageResponsibility": 0,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "control_utility",
            "observedGames": 1,
            "positiveResponsibilityGames": 0,
            "score": 87.79296875,
          },
          {
            "averageResponsibility": 0.285714285714,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "economy",
            "observedGames": 1,
            "positiveResponsibilityGames": 1,
            "score": 87.79296875,
          },
          {
            "averageResponsibility": 0.142857142857,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "objectives_macro",
            "observedGames": 1,
            "positiveResponsibilityGames": 1,
            "score": 87.79296875,
          },
          {
            "averageResponsibility": 0,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "vision_setup",
            "observedGames": 1,
            "positiveResponsibilityGames": 0,
            "score": 87.79296875,
          },
          {
            "averageResponsibility": null,
            "confidence": null,
            "eligibleGames": 2,
            "key": "initiative_pressure",
            "observedGames": 0,
            "positiveResponsibilityGames": 0,
            "score": null,
          },
          {
            "averageResponsibility": 0,
            "confidence": "learning",
            "eligibleGames": 2,
            "key": "consistency_versatility",
            "observedGames": 1,
            "positiveResponsibilityGames": 0,
            "score": null,
          },
        ],
        "headline": {
          "confidence": "learning",
          "confidenceInterval95": {
            "confidenceLevel": 0.95,
            "lower": 99,
            "method": "deterministic_match_bootstrap_percentile",
            "observedGames": 1,
            "replicates": 2000,
            "seed": 4001296472,
            "upper": 99,
          },
          "coverage": {
            "eligibleGames": 2,
            "eligibleWeight": 2,
            "gameRatio": 0.5,
            "observedGames": 1,
            "observedWeight": 1,
            "weightRatio": 0.5,
          },
          "nEff": 1,
          "score": 99,
          "source": "role_fit",
        },
        "literalZeroDamageShare": {
          "evidenceState": "observed",
          "rawObservedGames": 1,
          "rawValue": 0,
          "score": 12.20703125,
          "scoreObservedGames": 1,
        },
        "missingThenObservedZeroSustain": {
          "evidenceReason": undefined,
          "evidenceState": "observed",
          "rawObservedGames": 1,
          "rawValue": 0,
          "score": 0,
          "scoreObservedGames": 1,
        },
        "recipeId": "recall.rvi.definition.dcd9eb30fa637a870a44d3c48dc458149b9892687a476992c3a7dc95be743b1b@grade:recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3@calibration:recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086@calibration:recall.grade.calibration.3139967cf31169bd8b685950222d562c2c9e9ee446387a64d12d48a79688c086",
      }
    `)
  })
})
