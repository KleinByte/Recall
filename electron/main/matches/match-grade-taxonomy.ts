import { CHAMPION_CLASSES, type ChampionClass } from "./champion-classes.js"
import type { ModeFamily } from "./types.js"
import type { NormalizedPosition, Position } from "./position.js"
import {
  MATCH_GRADE_ARM_KEYS,
  MATCH_GRADE_TAXONOMY_VERSION,
  type MatchGradeArmKey,
  type ResponsibilityTier,
} from "./match-grade-recipe.js"

export { MATCH_GRADE_TAXONOMY_VERSION }

export const PRIMARY_ARCHETYPES = [
  "assassin",
  "artillery",
  "battlemage",
  "burst_mage",
  "catcher",
  "diver",
  "enchanter",
  "juggernaut",
  "marksman",
  "skirmisher",
  "vanguard",
  "warden",
  "specialist",
] as const

export type PrimaryArchetype = typeof PRIMARY_ARCHETYPES[number]

export type MatchGradeRuleset = "standard_sr" | "howling_abyss" | "league_classic"

export interface MatchGradeModeContext {
  modeFamily: ModeFamily
  /** Tracked mode separates ranked, normal, swiftplay, and future modes. */
  trackedMode: string
  ruleset: MatchGradeRuleset
  /** Versioned rules epoch; intentionally coarser than a fine patch cell. */
  rulesetKey: string
}

const RULESET_BY_FAMILY: Readonly<Record<Exclude<ModeFamily, "other">, MatchGradeRuleset>> =
  Object.freeze({
    sr: "standard_sr",
    aram: "howling_abyss",
    classic: "league_classic",
  })

export function defaultRulesetForModeFamily(
  family: Exclude<ModeFamily, "other">,
): MatchGradeRuleset {
  return RULESET_BY_FAMILY[family]
}

export function isSupportedModeContext(context: MatchGradeModeContext): boolean {
  return context.modeFamily !== "other" &&
    RULESET_BY_FAMILY[context.modeFamily] === context.ruleset &&
    context.trackedMode.trim().length > 0 && context.rulesetKey.trim().length > 0
}

export function defaultGradeModeContext(
  family: Exclude<ModeFamily, "other">,
): MatchGradeModeContext {
  const trackedMode = family === "sr" ? "sr_normal" : family === "aram" ? "aram" : "league_classic"
  return {
    modeFamily: family,
    trackedMode,
    ruleset: defaultRulesetForModeFamily(family),
    rulesetKey: `${trackedMode}:rules-r1`,
  }
}

export function calibrationScopeKey(context: MatchGradeModeContext): string {
  return `${context.trackedMode}:${context.rulesetKey}`
}

/** League Classic uses 600xx aliases for the original champion ids. */
export function canonicalChampionId(championId: number): number {
  return Number.isSafeInteger(championId) && championId >= 60_000 && championId < 61_000
    ? championId - 60_000
    : championId
}

/**
 * Checked-in primary detailed role for every modern id in CHAMPION_CLASSES.
 * The first role in League Wiki's ordered champion-role data is used when a
 * champion has multiple subclasses. New champions without a published
 * detailed role use Riot's primary role plus the champion's documented kit.
 */
export const CURATED_PRIMARY_ARCHETYPES: ReadonlyMap<number, PrimaryArchetype> = new Map([
  [1, "burst_mage"],
  [2, "diver"],
  [3, "warden"],
  [4, "burst_mage"],
  [5, "diver"],
  [6, "juggernaut"],
  [7, "burst_mage"],
  [8, "battlemage"],
  [9, "specialist"],
  [10, "specialist"],
  [11, "skirmisher"],
  [12, "vanguard"],
  [13, "battlemage"],
  [14, "vanguard"],
  [15, "marksman"],
  [16, "enchanter"],
  [17, "specialist"],
  [18, "marksman"], // Tristana
  [19, "diver"],
  [20, "vanguard"],
  [21, "marksman"],
  [22, "marksman"],
  [23, "skirmisher"],
  [24, "skirmisher"],
  [25, "catcher"],
  [26, "specialist"],
  [27, "specialist"],
  [28, "assassin"],
  [29, "marksman"],
  [30, "battlemage"],
  [31, "specialist"],
  [32, "vanguard"],
  [33, "vanguard"],
  [34, "battlemage"],
  [35, "assassin"],
  [36, "juggernaut"],
  [37, "enchanter"],
  [38, "assassin"],
  [39, "diver"],
  [40, "enchanter"],
  [41, "specialist"],
  [42, "marksman"],
  [43, "burst_mage"],
  [44, "enchanter"],
  [45, "burst_mage"],
  [48, "juggernaut"],
  [50, "battlemage"],
  [51, "marksman"],
  [53, "catcher"],
  [54, "vanguard"],
  [55, "assassin"],
  [56, "assassin"],
  [57, "vanguard"],
  [58, "diver"],
  [59, "diver"],
  [60, "diver"],
  [61, "burst_mage"],
  [62, "diver"],
  [63, "burst_mage"],
  [64, "diver"],
  [67, "marksman"],
  [68, "battlemage"],
  [69, "battlemage"],
  [72, "vanguard"], // Skarner: Vanguard, Juggernaut
  [74, "specialist"],
  [75, "juggernaut"],
  [76, "specialist"],
  [77, "juggernaut"],
  [78, "warden"],
  [79, "vanguard"],
  [80, "diver"],
  [81, "marksman"],
  [82, "juggernaut"],
  [83, "juggernaut"],
  [84, "assassin"],
  [85, "specialist"],
  [86, "juggernaut"],
  [89, "vanguard"],
  [90, "battlemage"],
  [91, "assassin"],
  [92, "skirmisher"],
  [96, "marksman"],
  [98, "warden"],
  [99, "burst_mage"],
  [101, "artillery"],
  [102, "diver"], // Shyvana: post-VGU detailed role
  [103, "burst_mage"],
  [104, "specialist"],
  [105, "assassin"],
  [106, "juggernaut"],
  [107, "assassin"],
  [110, "marksman"],
  [111, "vanguard"],
  [112, "battlemage"],
  [113, "vanguard"],
  [114, "skirmisher"],
  [115, "artillery"],
  [117, "enchanter"],
  [119, "marksman"],
  [120, "diver"],
  [121, "assassin"],
  [122, "juggernaut"],
  [126, "artillery"],
  [127, "burst_mage"],
  [131, "assassin"],
  [133, "specialist"],
  [134, "burst_mage"],
  [136, "battlemage"],
  [141, "skirmisher"],
  [142, "burst_mage"],
  [143, "catcher"],
  [145, "marksman"],
  [147, "burst_mage"],
  [150, "specialist"],
  [154, "vanguard"], // Zac
  [157, "skirmisher"],
  [161, "artillery"],
  [163, "battlemage"],
  [164, "diver"],
  [166, "marksman"],
  [200, "skirmisher"],
  [201, "warden"],
  [202, "marksman"],
  [203, "marksman"],
  [221, "marksman"],
  [222, "marksman"],
  [223, "warden"],
  [233, "diver"],
  [234, "skirmisher"],
  [235, "marksman"],
  [236, "marksman"],
  [238, "assassin"],
  [240, "skirmisher"],
  [245, "assassin"],
  [246, "assassin"],
  [254, "diver"],
  [266, "juggernaut"],
  [267, "enchanter"],
  [268, "specialist"],
  [350, "enchanter"],
  [360, "marksman"],
  [412, "catcher"],
  [420, "juggernaut"],
  [421, "diver"],
  [427, "catcher"],
  [429, "marksman"],
  [432, "catcher"],
  [497, "catcher"],
  [498, "marksman"],
  [516, "vanguard"],
  [517, "burst_mage"],
  [518, "burst_mage"],
  [523, "marksman"],
  [526, "vanguard"],
  [555, "assassin"],
  [711, "burst_mage"],
  [777, "assassin"],
  [799, "diver"],
  [800, "burst_mage"], // Mel: Burst, not her secondary Artillery traits
  [804, "marksman"],
  [805, "assassin"], // Locke: Riot primary Assassin; detailed role not yet published
  [875, "juggernaut"],
  [876, "skirmisher"],
  [887, "skirmisher"],
  [888, "enchanter"],
  [893, "burst_mage"],
  [895, "skirmisher"],
  [897, "warden"],
  [901, "marksman"],
  [902, "enchanter"],
  [904, "skirmisher"], // Zaahen
  [910, "artillery"],
  [950, "assassin"],
])

/** Any entry here must block release until the checked-in map is updated. */
export function unmappedChampionTaxonomyIds(): number[] {
  return [...new Set([...CHAMPION_CLASSES.keys()].map(canonicalChampionId))]
    .filter((championId) => !CURATED_PRIMARY_ARCHETYPES.has(championId))
    .sort((a, b) => a - b)
}

const CLASS_ARCHETYPE: Readonly<Record<ChampionClass, PrimaryArchetype>> = Object.freeze({
  assassin: "assassin",
  fighter: "skirmisher",
  mage: "burst_mage",
  marksman: "marksman",
  support: "enchanter",
  tank: "vanguard",
})

export function primaryArchetypeForClass(championClass?: ChampionClass): PrimaryArchetype {
  return championClass ? CLASS_ARCHETYPE[championClass] : "specialist"
}

export function resolvePrimaryArchetype(
  championId: number | undefined,
  explicit?: PrimaryArchetype,
): PrimaryArchetype {
  if (explicit) return explicit
  if (!Number.isSafeInteger(championId)) return "specialist"
  const canonical = canonicalChampionId(championId as number)
  return CURATED_PRIMARY_ARCHETYPES.get(canonical) ??
    primaryArchetypeForClass(CHAMPION_CLASSES.get(canonical)?.[0])
}

export type ArchetypeResolutionSource =
  | "explicit"
  | "curated"
  | "class_fallback"
  | "specialist_fallback"

export interface ArchetypeResolution {
  archetype: PrimaryArchetype
  source: ArchetypeResolutionSource
  taxonomyVersion: typeof MATCH_GRADE_TAXONOMY_VERSION
}

export function resolvePrimaryArchetypeWithSource(
  championId: number | undefined,
  explicit?: PrimaryArchetype,
): ArchetypeResolution {
  if (explicit) {
    return { archetype: explicit, source: "explicit", taxonomyVersion: MATCH_GRADE_TAXONOMY_VERSION }
  }
  if (!Number.isSafeInteger(championId)) {
    return {
      archetype: "specialist",
      source: "specialist_fallback",
      taxonomyVersion: MATCH_GRADE_TAXONOMY_VERSION,
    }
  }
  const canonical = canonicalChampionId(championId as number)
  const curated = CURATED_PRIMARY_ARCHETYPES.get(canonical)
  if (curated) {
    return { archetype: curated, source: "curated", taxonomyVersion: MATCH_GRADE_TAXONOMY_VERSION }
  }
  const championClass = CHAMPION_CLASSES.get(canonical)?.[0]
  return {
    archetype: primaryArchetypeForClass(championClass),
    source: championClass ? "class_fallback" : "specialist_fallback",
    taxonomyVersion: MATCH_GRADE_TAXONOMY_VERSION,
  }
}

type ResponsibilityProfile = Readonly<Record<MatchGradeArmKey, ResponsibilityTier>>

const profile = (
  combat: ResponsibilityTier,
  positioningSurvival: ResponsibilityTier,
  controlUtility: ResponsibilityTier,
  economy: ResponsibilityTier,
  objectivesMacro: ResponsibilityTier,
  visionSetup: ResponsibilityTier,
  initiativePressure: ResponsibilityTier,
): ResponsibilityProfile => Object.freeze({
  combat,
  positioning_survival: positioningSurvival,
  control_utility: controlUtility,
  economy,
  objectives_macro: objectivesMacro,
  vision_setup: visionSetup,
  initiative_pressure: initiativePressure,
})

const ARCHETYPE_RESPONSIBILITIES: Readonly<Record<PrimaryArchetype, ResponsibilityProfile>> =
  Object.freeze({
    assassin: profile(2, 1, 0, 2, 1, 0, 2),
    artillery: profile(2, 2, 1, 2, 1, 1, 1),
    battlemage: profile(2, 2, 1, 2, 1, 1, 1),
    burst_mage: profile(2, 1, 1, 2, 1, 1, 1),
    catcher: profile(1, 1, 2, 0, 1, 2, 2),
    diver: profile(2, 2, 1, 1, 1, 0, 2),
    enchanter: profile(1, 1, 2, 0, 1, 2, 2),
    juggernaut: profile(2, 2, 1, 1, 1, 0, 1),
    marksman: profile(2, 1, 0, 2, 1, 0, 1),
    skirmisher: profile(2, 2, 1, 1, 1, 0, 2),
    vanguard: profile(1, 2, 2, 0, 1, 0, 2),
    warden: profile(1, 2, 2, 0, 1, 1, 2),
    specialist: profile(1, 1, 1, 1, 1, 1, 1),
  })

/**
 * Specialists are specialists precisely because a shared class profile loses
 * important kit responsibilities. Every champion curated as Specialist gets
 * an explicit policy here; position opportunity modifiers are applied after it.
 */
export const SPECIALIST_RESPONSIBILITY_OVERRIDES: ReadonlyMap<number, ResponsibilityProfile> =
  new Map([
    [9, profile(1, 2, 2, 1, 1, 0, 2)],   // Fiddlesticks
    [10, profile(2, 2, 0, 2, 1, 0, 1)],  // Kayle
    [17, profile(1, 2, 1, 2, 1, 2, 1)],  // Teemo
    [26, profile(1, 2, 2, 0, 1, 1, 2)],  // Zilean
    [27, profile(1, 2, 2, 2, 1, 0, 1)],  // Singed
    [31, profile(1, 2, 2, 1, 2, 0, 1)],  // Cho'Gath
    [41, profile(2, 1, 1, 2, 1, 0, 2)],  // Gangplank
    [74, profile(2, 2, 1, 2, 2, 0, 1)],  // Heimerdinger
    [76, profile(2, 2, 0, 2, 1, 1, 2)],  // Nidalee
    [85, profile(2, 1, 2, 2, 1, 0, 2)],  // Kennen
    [104, profile(2, 2, 0, 2, 2, 0, 2)], // Graves
    [133, profile(2, 2, 1, 2, 1, 1, 2)], // Quinn
    [150, profile(2, 2, 2, 2, 1, 0, 1)], // Gnar
    [268, profile(2, 2, 1, 2, 2, 0, 1)], // Azir
  ])

const missingSpecialistPolicies = [...CURATED_PRIMARY_ARCHETYPES]
  .filter(([, archetype]) => archetype === "specialist")
  .map(([championId]) => championId)
  .filter((championId) => !SPECIALIST_RESPONSIBILITY_OVERRIDES.has(championId))
if (missingSpecialistPolicies.length > 0) {
  throw new Error(`missing_specialist_responsibility_policy:${missingSpecialistPolicies.join(",")}`)
}

const POSITION_RESPONSIBILITIES: Readonly<Record<Position, ResponsibilityProfile>> =
  Object.freeze({
    TOP: profile(0, 0, 0, 2, 1, 0, 1),
    JUNGLE: profile(0, 0, 0, 1, 2, 1, 2),
    MIDDLE: profile(0, 0, 0, 2, 1, 0, 2),
    BOTTOM: profile(0, 0, 0, 2, 1, 0, 1),
    UTILITY: profile(0, 0, 2, 0, 1, 2, 2),
  })

const maxTier = (a: ResponsibilityTier, b: ResponsibilityTier): ResponsibilityTier =>
  Math.max(a, b) as ResponsibilityTier

/** Position controls opportunity; archetype controls responsibility. */
export function responsibilityTiersFor(
  context: MatchGradeModeContext,
  position: NormalizedPosition,
  archetype: PrimaryArchetype,
  championId?: number,
): ResponsibilityProfile {
  const canonical = Number.isSafeInteger(championId)
    ? canonicalChampionId(championId as number)
    : undefined
  const archetypeProfile = archetype === "specialist" && canonical !== undefined
    ? SPECIALIST_RESPONSIBILITY_OVERRIDES.get(canonical) ??
      ARCHETYPE_RESPONSIBILITIES.specialist
    : ARCHETYPE_RESPONSIBILITIES[archetype]
  const positionProfile = position === "UNKNOWN" ? undefined : POSITION_RESPONSIBILITIES[position]
  const combined = Object.fromEntries(MATCH_GRADE_ARM_KEYS.map((family) => [
    family,
    positionProfile
      ? maxTier(archetypeProfile[family], positionProfile[family])
      : archetypeProfile[family],
  ])) as Record<MatchGradeArmKey, ResponsibilityTier>

  // Support economy is an opportunity constraint, even for damage-oriented
  // archetypes played in the utility position.
  if (position === "UTILITY") combined.economy = 0
  if (context.ruleset === "howling_abyss") {
    // ARAM and Mayhem expose exactly the four mode-capable match arms.
    combined.combat = Math.max(1, combined.combat) as ResponsibilityTier
    combined.positioning_survival = Math.max(
      1,
      combined.positioning_survival,
    ) as ResponsibilityTier
    combined.control_utility = Math.max(1, combined.control_utility) as ResponsibilityTier
    combined.economy = Math.max(1, combined.economy) as ResponsibilityTier
    combined.objectives_macro = 0
    combined.vision_setup = 0
    combined.initiative_pressure = 0
  }
  return Object.freeze(combined)
}
