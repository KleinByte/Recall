import type { PerformanceProfile } from "../types/stats"

export interface RviIdentity {
  label: string
  description: string
  vectors: string[]
}

const MIN_GAMES = 10
const BALANCED_SPREAD = 8
const DOMINANT_GAP = 10
const SECONDARY_FLOOR = 52

const SINGLE: Record<string, Omit<RviIdentity, "vectors">> = {
  threat: { label: "Damage Dealer", description: "Your clearest measured edge is damage pressure relative to your position and archetype." },
  teamfighting: { label: "Teamfighter", description: "Your clearest measured edge is contributing when teammates convert fights." },
  positioning_survival: { label: "Anchor", description: "Your clearest measured edge is staying available and avoiding costly deaths." },
  control_utility: { label: "Disruptor", description: "Your clearest measured edge is crowd control and utility for your assigned responsibilities." },
  economy: { label: "Scaler", description: "Your clearest measured edge is converting positional access into gold and farm." },
  objectives_macro: { label: "Objective Hunter", description: "Your clearest measured edge is converting pressure into structures and neutral objectives." },
  vision_setup: { label: "Scout", description: "Your clearest measured edge is vision and measurable setup work." },
}

const PAIRS: Record<string, Omit<RviIdentity, "vectors">> = {
  "control_utility+positioning_survival": { label: "Vanguard", description: "You combine availability with high measurable control and utility." },
  "positioning_survival+threat": { label: "Juggernaut", description: "You combine damage pressure with staying available for your team." },
  "objectives_macro+positioning_survival": { label: "Bulwark", description: "You combine availability with objective and structure pressure." },
  "economy+positioning_survival": { label: "Scaling Anchor", description: "You combine efficient income with fewer costly deaths." },
  "positioning_survival+vision_setup": { label: "Guardian", description: "You combine availability with vision and setup work." },
  "control_utility+teamfighting": { label: "Playmaker", description: "You combine teamfight involvement with measurable control and utility." },
  "control_utility+threat": { label: "Battle Mage", description: "You combine damage pressure with measurable control and utility." },
  "economy+threat": { label: "Carry", description: "You build a resource edge and convert it into direct damage pressure." },
  "teamfighting+threat": { label: "Combat Carry", description: "You combine damage pressure with consistent teamfight involvement." },
  "objectives_macro+threat": { label: "Siegebreaker", description: "You convert damage pressure into structures and neutral objectives." },
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
        : "Recall needs more measured vectors before naming this RVI identity.",
      vectors: [],
    }
  }

  const ranked = profile.dimensions
    .filter((dimension) => dimension.headlineEligible && dimension.score !== null && dimension.games > 0)
    .sort((left, right) => right.score! - left.score!)
  if (ranked.length < 2) {
    return {
      label: "Developing Identity",
      description: "Recall needs at least two responsibility-weighted vectors before naming this RVI identity.",
      vectors: [],
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
      vectors: ranked.map((dimension) => dimension.key),
    }
  }

  if (first.score! - second.score! >= DOMINANT_GAP || second.score! < SECONDARY_FLOOR) {
    const identity = SINGLE[first.key] ?? {
      label: `${first.label} Specialist`,
      description: `Your approach to games is most clearly shaped by how you use ${first.label.toLowerCase()}.`,
    }
    return { ...identity, vectors: [first.key] }
  }

  const identity = PAIRS[pairKey(first.key, second.key)] ?? {
    label: "Hybrid",
    description: `You blend ${first.label.toLowerCase()} with ${second.label.toLowerCase()} instead of following one narrow game plan.`,
  }
  return { ...identity, vectors: [first.key, second.key] }
}
