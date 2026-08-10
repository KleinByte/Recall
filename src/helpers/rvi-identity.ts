import type { PerformanceProfile } from "../types/stats"

export interface RviIdentity {
  label: string
  description: string
  arms: string[]
}

const MIN_GAMES = 10
const BALANCED_SPREAD = 8
const DOMINANT_GAP = 10
const SECONDARY_FLOOR = 52

const SINGLE: Record<string, Omit<RviIdentity, "arms">> = {
  combat: { label: "Combat Carry", description: "Your clearest measured edge is turning damage and fight involvement into results." },
  positioning_survival: { label: "Anchor", description: "Your clearest measured edge is staying available and avoiding costly deaths." },
  control_utility: { label: "Disruptor", description: "Your clearest measured edge is crowd control and utility for your assigned responsibilities." },
  economy: { label: "Scaler", description: "Your clearest measured edge is converting positional access into gold and farm." },
  objectives_macro: { label: "Objective Hunter", description: "Your clearest measured edge is converting pressure into structures and neutral objectives." },
  vision_setup: { label: "Scout", description: "Your clearest measured edge is vision and measurable setup work." },
  initiative_pressure: { label: "Tempo Setter", description: "Your clearest measured edge is creating early pressure and acting before opportunities close." },
  consistency_versatility: { label: "Versatile", description: "Your career record combines dependable results with breadth across champions, archetypes, and positions." },
}

const PAIRS: Record<string, Omit<RviIdentity, "arms">> = {
  "combat+positioning_survival": { label: "Juggernaut", description: "You combine combat impact with staying available for your team." },
  "combat+control_utility": { label: "Playmaker", description: "You combine fight impact with measurable control and utility." },
  "combat+economy": { label: "Carry", description: "You build a resource edge and convert it into direct combat impact." },
  "combat+objectives_macro": { label: "Siegebreaker", description: "You convert fight pressure into structures and neutral objectives." },
  "combat+initiative_pressure": { label: "Aggressor", description: "You pair combat impact with early initiative and pressure." },
  "control_utility+positioning_survival": { label: "Vanguard", description: "You combine availability with high measurable control and utility." },
  "objectives_macro+positioning_survival": { label: "Bulwark", description: "You combine availability with objective and structure pressure." },
  "economy+positioning_survival": { label: "Scaling Anchor", description: "You combine efficient income with fewer costly deaths." },
  "positioning_survival+vision_setup": { label: "Guardian", description: "You combine availability with vision and setup work." },
  "economy+objectives_macro": { label: "Macro Player", description: "You build resources and convert them into objective pressure." },
  "objectives_macro+vision_setup": { label: "Map Controller", description: "You prepare important areas and convert that setup into objectives." },
  "economy+vision_setup": { label: "Resourceful Scout", description: "You balance efficient income with vision and setup work." },
}

const pairKey = (left: string, right: string) => [left, right].sort().join("+")

/** Classifies the shape of the measured RVI dimensions—not the retired playstyle radar. */
export function classifyRviIdentity(profile: PerformanceProfile): RviIdentity {
  if (profile.measuredGames < MIN_GAMES || profile.dimensions.length < 2) {
    const needed = Math.max(0, MIN_GAMES - profile.measuredGames)
    return {
      label: "Developing Identity",
      description: needed
        ? `${needed} more ${needed === 1 ? "measured game" : "measured games"} will make this RVI identity more stable.`
        : "Recall needs more measured arms before naming this performance style.",
      arms: [],
    }
  }

  const ranked = profile.dimensions
    .filter((dimension) => dimension.headlineEligible && dimension.score !== null && dimension.games > 0)
    .sort((left, right) => right.score! - left.score!)
  if (ranked.length < 2) {
    return {
      label: "Developing Identity",
      description: "Recall needs at least two measured arms before naming this performance style.",
      arms: [],
    }
  }
  const first = ranked[0]
  const second = ranked[1]
  const last = ranked.at(-1)!

  if (first.score! - last.score! <= BALANCED_SPREAD) {
    return {
      label: profile.score >= 58 ? "All-Rounder" : "Flexible",
      description: profile.score >= 58
        ? "You influence games in several ways and can shift between fighting, map play, and adaptation as needed."
        : "Your approach is balanced, with no single habit dominating how you play your games.",
      arms: ranked.map((dimension) => dimension.key),
    }
  }

  if (first.score! - second.score! >= DOMINANT_GAP || second.score! < SECONDARY_FLOOR) {
    const identity = SINGLE[first.key] ?? {
      label: `${first.label} Specialist`,
      description: `Your approach to games is most clearly shaped by how you use ${first.label.toLowerCase()}.`,
    }
    return { ...identity, arms: [first.key] }
  }

  const identity = PAIRS[pairKey(first.key, second.key)] ?? {
    label: "Hybrid",
    description: `You blend ${first.label.toLowerCase()} with ${second.label.toLowerCase()} instead of following one narrow game plan.`,
  }
  return { ...identity, arms: [first.key, second.key] }
}
