import type { StyleAxis } from "../types/stats"

export interface PlaystyleIdentity {
  label: string
  description: string
  axes: string[]
}

const MIN_GAMES = 10
const EVEN_SPREAD = 0.12
const SINGLE_AXIS_GAP = 0.2
const SECONDARY_AXIS_MIN = 0.45

const SINGLE_AXIS: Record<string, Omit<PlaystyleIdentity, "axes">> = {
  aggression: { label: "Executioner", description: "You tend to finish fights yourself rather than set up the final blow." },
  damage: { label: "Damage Dealer", description: "Dealing champion damage is the clearest feature of your games." },
  durability: { label: "Frontliner", description: "Absorbing and mitigating pressure is the clearest feature of your games." },
  farming: { label: "Power Farmer", description: "You consistently turn waves and camps into resources." },
  objectives: { label: "Objective Specialist", description: "You put an unusually large share of your damage into neutral objectives." },
  vision: { label: "Scout", description: "Vision control is the clearest feature of your Rift games." },
  sustain: { label: "Survivor", description: "Healing through incoming pressure is the clearest feature of your games." },
  teamfighting: { label: "Disruptor", description: "Crowd control is the clearest feature of your teamfights." },
}

const PAIRS: Record<string, Omit<PlaystyleIdentity, "axes">> = {
  "aggression+damage": { label: "Duelist", description: "You pair champion damage with a strong instinct for securing kills." },
  "aggression+durability": { label: "Vanguard", description: "You start from the front and stay involved when fights turn dangerous." },
  "aggression+farming": { label: "Snowballer", description: "You build resources and turn them into direct kill pressure." },
  "aggression+objectives": { label: "Objective Hunter", description: "You convert fighting pressure into damage on major objectives." },
  "aggression+vision": { label: "Ambusher", description: "Vision control and kill pressure shape how you approach the Rift." },
  "damage+durability": { label: "Juggernaut", description: "You deal heavy damage while standing up to punishment in return." },
  "damage+farming": { label: "Carry", description: "You turn a strong flow of resources into champion damage." },
  "damage+objectives": { label: "Siegebreaker", description: "Your damage threatens champions and objectives alike." },
  "damage+vision": { label: "Tactical Carry", description: "You combine damage output with consistent vision control." },
  "durability+farming": { label: "Scaling Frontliner", description: "You gather resources to become a durable presence in later fights." },
  "durability+objectives": { label: "Bulwark", description: "You absorb pressure while helping secure major objectives." },
  "durability+vision": { label: "Guardian", description: "You protect space through durability and vision control." },
  "farming+objectives": { label: "Macro Player", description: "Your games revolve around resources and objective pressure." },
  "farming+vision": { label: "Resourceful Scout", description: "You balance resource collection with map information." },
  "objectives+vision": { label: "Map Controller", description: "Vision and objective pressure are the center of your Rift playstyle." },
  "aggression+sustain": { label: "Drain Fighter", description: "You keep attacking while healing through the return damage." },
  "aggression+teamfighting": { label: "Playmaker", description: "You create openings with control and help finish the fights you start." },
  "damage+sustain": { label: "Sustained Carry", description: "You combine champion damage with the healing to remain in the fight." },
  "damage+teamfighting": { label: "Battle Mage", description: "Damage and crowd control make you influential throughout teamfights." },
  "durability+sustain": { label: "Drain Tank", description: "You endure pressure by combining mitigation with sustained healing." },
  "durability+teamfighting": { label: "Disruptor", description: "You stay in the middle of fights and keep enemies under control." },
  "farming+sustain": { label: "Resourceful Survivor", description: "You gather resources while maintaining the sustain to keep fighting." },
  "farming+teamfighting": { label: "Wave Controller", description: "You pair wave access with reliable control in teamfights." },
  "sustain+teamfighting": { label: "Battle Medic", description: "Healing and crowd control let you keep your side fighting longer." },
}

const pairKey = (left: string, right: string) => [left, right].sort().join("+")

/** Names a radar shape without treating its display scales as population benchmarks. */
export function classifyPlaystyle(axes: StyleAxis[], games: number): PlaystyleIdentity {
  if (games < MIN_GAMES) {
    const needed = MIN_GAMES - games
    return {
      label: "Developing Identity",
      description: `${needed} more ${needed === 1 ? "game" : "games"} will make this read more stable.`,
      axes: [],
    }
  }

  const ranked = [...axes].sort((left, right) => right.value - left.value)
  const first = ranked[0]
  const second = ranked[1]
  const last = ranked.at(-1)

  if (!first || !second || !last) {
    return { label: "Developing Identity", description: "There is not enough radar data to name this playstyle yet.", axes: [] }
  }

  if (first.value - last.value <= EVEN_SPREAD) {
    const average = ranked.reduce((total, axis) => total + axis.value, 0) / ranked.length
    const strong = average >= 0.58
    return {
      label: strong ? "All-Rounder" : "Flexible",
      description: strong
        ? "Your radar is broad and even, without one tendency defining your games."
        : "Your radar is balanced, with no single tendency dominating the others.",
      axes: ranked.map((axis) => axis.key),
    }
  }

  if (first.value - second.value >= SINGLE_AXIS_GAP || second.value < SECONDARY_AXIS_MIN) {
    const identity = SINGLE_AXIS[first.key] ?? {
      label: "Specialist",
      description: `${first.label} is the defining feature of your games.`,
    }
    return { ...identity, axes: [first.key] }
  }

  const identity = PAIRS[pairKey(first.key, second.key)]
  if (identity) return { ...identity, axes: [first.key, second.key] }

  return {
    label: "Specialist",
    description: `${first.label} and ${second.label} are the defining features of your games.`,
    axes: [first.key, second.key],
  }
}
