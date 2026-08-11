export const SKILL_SCOPE_IDS = [
  "riftAll", "riftRanked", "riftNormal",
  "rankedSolo", "rankedFlex", "draftBlind",
  "quickplay", "swiftplay", "aram", "mayhem", "leagueClassic",
] as const

export type SkillScopeId = typeof SKILL_SCOPE_IDS[number]
export type SkillTab = "overview" | "insights" | "analyze"

export interface SkillViewPreferences {
  scopeId: SkillScopeId
  seasonId: string
  role?: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY"
  championId?: number
  tab: SkillTab
  rviArmDetailsOpen?: boolean
}

const SKILL_TABS: readonly SkillTab[] = ["overview", "insights", "analyze"]
const SKILL_ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const

export function validateSkillViewPreferences(value: unknown): SkillViewPreferences | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (!SKILL_SCOPE_IDS.includes(candidate.scopeId as SkillScopeId) ||
      typeof candidate.seasonId !== "string" || candidate.seasonId.length > 64 ||
      !SKILL_TABS.includes(candidate.tab as SkillTab)) return undefined
  if (candidate.role !== undefined &&
      !SKILL_ROLES.includes(candidate.role as typeof SKILL_ROLES[number])) return undefined
  if (candidate.championId !== undefined &&
      (!Number.isSafeInteger(candidate.championId) || (candidate.championId as number) <= 0)) {
    return undefined
  }
  if (candidate.rviArmDetailsOpen !== undefined &&
      typeof candidate.rviArmDetailsOpen !== "boolean") return undefined
  return {
    scopeId: candidate.scopeId as SkillScopeId,
    seasonId: candidate.seasonId,
    ...(candidate.role === undefined ? {} : { role: candidate.role as SkillViewPreferences["role"] }),
    ...(candidate.championId === undefined ? {} : { championId: candidate.championId as number }),
    tab: candidate.tab as SkillTab,
    ...(candidate.rviArmDetailsOpen === undefined
      ? {}
      : { rviArmDetailsOpen: candidate.rviArmDetailsOpen }),
  }
}
