import type {
  CampClearAttribution,
  CampClearEvidence,
} from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"

export interface CampAttributionResult {
  attribution: CampClearAttribution
  confidence: number
  score: number
  reasons: string[]
}

export class CampAttributionEngine {
  attribute(evidence: CampClearEvidence): CampAttributionResult {
    const reasons: string[] = []
    if (!evidence.campTransition || evidence.localPlayerDead) {
      return {
        attribution: "other",
        confidence: evidence.localPlayerDead ? 0.9 : 0.75,
        score: 0,
        reasons: [evidence.localPlayerDead ? "local_player_dead" : "no_camp_transition"],
      }
    }
    let score = clamp(evidence.transitionConfidence) * 0.28
    reasons.push("confirmed_visual_transition")

    if (evidence.localPositionObserved && evidence.localPositionDistance !== undefined) {
      if (evidence.localPositionDistance <= 0.055) {
        score += 0.38
        reasons.push("local_marker_inside_camp_radius")
      } else if (evidence.localPositionDistance <= 0.095) {
        score += 0.2
        reasons.push("local_marker_near_camp")
      } else {
        score -= 0.16
        reasons.push("local_marker_far_from_camp")
      }
    } else {
      reasons.push("local_marker_unavailable")
    }

    if ((evidence.neutralMinionKillDelta ?? 0) > 0) {
      score += 0.18
      reasons.push("neutral_minion_counter_increased")
    } else if ((evidence.creepScoreDelta ?? 0) > 0) {
      score += 0.09
      reasons.push("creep_score_increased")
    }
    if ((evidence.goldResidual ?? 0) >= 8) {
      score += 0.1
      reasons.push("compatible_gold_residual")
    }
    if (evidence.expectedNextCamp) {
      score += 0.06
      reasons.push("route_continuity")
    }
    if ((evidence.visibleEnemiesNearCamp ?? 0) > 0) {
      score -= 0.24
      reasons.push("enemy_marker_near_camp")
    }
    if ((evidence.visibleAlliesNearCamp ?? 0) > 1) {
      score -= 0.1
      reasons.push("multiple_allies_near_camp")
    }
    if ((evidence.evidenceAgeMs ?? 0) > 1_500) {
      score -= 0.12
      reasons.push("supporting_evidence_stale")
    }

    score = clamp(score)
    const otherStrong =
      !evidence.localPositionObserved &&
      (evidence.visibleEnemiesNearCamp ?? 0) > 0 &&
      (evidence.neutralMinionKillDelta ?? 0) === 0 &&
      (evidence.creepScoreDelta ?? 0) === 0
    if (otherStrong) {
      return {
        attribution: "other",
        confidence: clamp(0.65 + evidence.transitionConfidence * 0.25),
        score,
        reasons,
      }
    }
    if (score >= 0.76) {
      return { attribution: "local", confidence: score, score, reasons }
    }
    return {
      attribution: "uncertain",
      confidence: clamp(0.45 + Math.abs(score - 0.5) * 0.45),
      score,
      reasons,
    }
  }
}
