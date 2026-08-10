import type { ModeFamily, StatsFilter, TrackedMode } from "../types/stats"
import type { SkillScopeId } from "../shared/skill-preferences"
export type { SkillScopeId } from "../shared/skill-preferences"

export interface SkillScope {
  id: SkillScopeId
  label: string
  primary: "rift" | "aram" | "mayhem" | "classic"
  family: ModeFamily
  kind: "combined" | "leaf"
  modes: readonly TrackedMode[]
}

export const SKILL_SCOPES: readonly SkillScope[] = [
  { id: "riftAll", label: "All Rift", primary: "rift", family: "sr", kind: "combined", modes: ["sr_ranked_solo", "sr_ranked_flex", "sr_normal", "sr_quickplay", "sr_swiftplay"] },
  { id: "riftRanked", label: "Ranked", primary: "rift", family: "sr", kind: "combined", modes: ["sr_ranked_solo", "sr_ranked_flex"] },
  { id: "riftNormal", label: "Normal", primary: "rift", family: "sr", kind: "combined", modes: ["sr_normal", "sr_quickplay", "sr_swiftplay"] },
  { id: "rankedSolo", label: "Ranked Solo", primary: "rift", family: "sr", kind: "leaf", modes: ["sr_ranked_solo"] },
  { id: "rankedFlex", label: "Ranked Flex", primary: "rift", family: "sr", kind: "leaf", modes: ["sr_ranked_flex"] },
  { id: "draftBlind", label: "Draft / Blind", primary: "rift", family: "sr", kind: "leaf", modes: ["sr_normal"] },
  { id: "quickplay", label: "Quickplay", primary: "rift", family: "sr", kind: "leaf", modes: ["sr_quickplay"] },
  { id: "swiftplay", label: "Swiftplay", primary: "rift", family: "sr", kind: "leaf", modes: ["sr_swiftplay"] },
  { id: "aram", label: "ARAM", primary: "aram", family: "aram", kind: "leaf", modes: ["aram"] },
  { id: "mayhem", label: "Mayhem", primary: "mayhem", family: "aram", kind: "leaf", modes: ["mayhem"] },
  { id: "leagueClassic", label: "League Classic", primary: "classic", family: "classic", kind: "leaf", modes: ["league_classic"] },
] as const

export function filterForSkillScope(id: SkillScopeId): StatsFilter {
  const scope = SKILL_SCOPES.find((entry) => entry.id === id)!
  return { modes: [...scope.modes] }
}
