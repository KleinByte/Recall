export const MATCH_RVI_ARM_KEYS = [
  "combat",
  "positioning_survival",
  "control_utility",
  "economy",
  "objectives_macro",
  "vision_setup",
  "initiative_pressure",
] as const

export const CAREER_RVI_ARM_KEYS = [
  ...MATCH_RVI_ARM_KEYS,
  "consistency_versatility",
] as const

export type MatchRviArmKey = typeof MATCH_RVI_ARM_KEYS[number]
export type CareerRviArmKey = typeof CAREER_RVI_ARM_KEYS[number]

export interface PerformanceArmCopy {
  label: string
  description: string
}

/** The single user-facing vocabulary for Recall Grade and RVI. */
export const PERFORMANCE_ARM_COPY: Readonly<Record<CareerRviArmKey, PerformanceArmCopy>> =
  Object.freeze({
    combat: Object.freeze({
      label: "Combat",
      description: "Damage, takedowns, and fight results.",
    }),
    positioning_survival: Object.freeze({
      label: "Survival",
      description: "Staying alive and avoiding costly deaths.",
    }),
    control_utility: Object.freeze({
      label: "Utility",
      description: "Crowd control, protection, and pressure absorbed.",
    }),
    economy: Object.freeze({
      label: "Economy",
      description: "Gold, farm, and advantages over your lane opponent.",
    }),
    objectives_macro: Object.freeze({
      label: "Macro",
      description: "Structures, neutral objectives, and map conversion.",
    }),
    vision_setup: Object.freeze({
      label: "Vision",
      description: "Creating and denying vision around important areas.",
    }),
    initiative_pressure: Object.freeze({
      label: "Initiative",
      description: "Early movement, takedowns, and pressure.",
    }),
    consistency_versatility: Object.freeze({
      label: "Range",
      description: "How consistently you perform and how well you play across different champions and positions.",
    }),
  })

export const PERFORMANCE_ARM_LABELS: Readonly<Record<CareerRviArmKey, string>> =
  Object.freeze(Object.fromEntries(
    CAREER_RVI_ARM_KEYS.map((key) => [key, PERFORMANCE_ARM_COPY[key].label]),
  ) as Record<CareerRviArmKey, string>)
