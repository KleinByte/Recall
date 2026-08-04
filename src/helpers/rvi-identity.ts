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
  fighting: { label: "Brawler", description: "You look for combat often and make your largest impact once a fight has started." },
  survivability: { label: "Survivor", description: "You play around staying available, resisting pressure, and being difficult to remove." },
  objectives: { label: "Objective Hunter", description: "You orient your games around towers and neutral objectives, turning openings into permanent gains." },
  farming: { label: "Power Farmer", description: "You prioritize a steady flow of gold and experience so you can arrive at key moments with resources." },
  vision: { label: "Scout", description: "You shape the map through information, safer routes, and denying the enemy's view." },
  initiative: { label: "Instigator", description: "You prefer to create the next play instead of waiting for the game to come to you." },
  consistency: { label: "Steady Hand", description: "You favor repeatable decisions and tend to give your team a dependable performance floor." },
  versatility: { label: "Flex Player", description: "You change champions, roles, or game plans without losing the core of your impact." },
  teamPresence: { label: "Teamfighter", description: "You gravitate toward your team and are usually present when a game-changing fight begins." },
  sustain: { label: "Battle Medic", description: "You extend fights through recovery and support, keeping yourself or teammates in the action." },
  fightControl: { label: "Disruptor", description: "You influence fights by controlling space and limiting what opponents are allowed to do." },
}

const PAIRS: Record<string, Omit<RviIdentity, "vectors">> = {
  // Rift archetypes. These describe how the vectors work together, rather than
  // turning the two highest category names into an identity label.
  "farming+fighting": { label: "Carry", description: "You build a resource lead and expect to convert it into direct combat impact." },
  "fighting+initiative": { label: "Playmaker", description: "You create openings yourself and stay involved long enough to decide the fight you started." },
  "fighting+objectives": { label: "Siegebreaker", description: "You use combat pressure to open the map and quickly threaten structures or neutral objectives." },
  "fighting+survivability": { label: "Juggernaut", description: "You are comfortable fighting under pressure and try to outlast opponents while still threatening them." },
  "fighting+vision": { label: "Tactical Carry", description: "You use information and controlled space to choose fights where your damage can matter most." },
  "consistency+fighting": { label: "Reliable Carry", description: "Your team can count on you to contribute in fights without needing a perfect game first." },
  "fighting+versatility": { label: "Flex Carry", description: "You find ways to influence fights across different champions, roles, and game states." },
  "farming+survivability": { label: "Scaling Frontliner", description: "You protect your economy early so you can become a durable presence in later fights." },
  "objectives+survivability": { label: "Bulwark", description: "You stay available under pressure and use that presence to hold important ground for your team." },
  "survivability+vision": { label: "Guardian", description: "You protect valuable space through safe positioning, information, and controlled movement." },
  "initiative+survivability": { label: "Vanguard", description: "You are willing to step forward first and trust your positioning to survive the response." },
  "consistency+survivability": { label: "Anchor", description: "You play a stable, low-collapse style that gives your team someone dependable to play around." },
  "survivability+versatility": { label: "Warden", description: "You adapt to what the game needs while remaining a difficult piece for the enemy to remove." },
  "farming+objectives": { label: "Macro Player", description: "You build advantages through waves, camps, structures, and objective timing more than constant fighting." },
  "objectives+vision": { label: "Map Controller", description: "You prepare important areas with information and turn that control into objectives." },
  "initiative+objectives": { label: "Tempo Setter", description: "You push the pace, then turn the windows you create into lasting map progress." },
  "consistency+objectives": { label: "Closer", description: "You repeatedly turn small openings into objectives instead of letting advantages drift away." },
  "objectives+versatility": { label: "Shotcaller", description: "You adjust your route through the game while keeping the team pointed toward the next valuable objective." },
  "farming+vision": { label: "Resourceful Scout", description: "You balance income with map information, collecting resources without losing track of the wider game." },
  "farming+initiative": { label: "Snowballer", description: "You build early resources and quickly spend that advantage on proactive plays." },
  "consistency+farming": { label: "Economist", description: "You rely on repeatable resource advantages and rarely abandon your route without a clear return." },
  "farming+versatility": { label: "Adaptive Scaler", description: "You find a path to resources across changing matchups and grow into whatever the game requires." },
  "initiative+vision": { label: "Ambusher", description: "You use information gaps and proactive movement to make opponents feel unsafe on the map." },
  "consistency+vision": { label: "Sentinel", description: "You maintain dependable map information and make it difficult for threats to arrive unseen." },
  "versatility+vision": { label: "Map Reader", description: "You read the available information and adjust your position or plan before the map changes around you." },
  "consistency+initiative": { label: "Field General", description: "You create action with discipline, preferring repeatable pressure over low-odds gambles." },
  "initiative+versatility": { label: "Wildcard", description: "You attack games from different angles and are comfortable changing the plan to create an opening." },
  "consistency+versatility": { label: "All-Rounder", description: "You bring a stable foundation across different champions, roles, and match conditions." },

  // Mode-specific archetypes used when RVI substitutes ARAM/Mayhem vectors.
  "fightControl+fighting": { label: "Battle Mage", description: "You combine combat output with control that shapes where and how the fight happens." },
  "fighting+sustain": { label: "Sustained Carry", description: "You remain dangerous through extended fights by pairing output with recovery." },
  "fighting+teamPresence": { label: "Teamfight Carry", description: "You stay close to the action and turn full-team engagements into your main win condition." },
  "fightControl+survivability": { label: "Disruptor", description: "You occupy dangerous space, absorb the response, and interfere with the enemy's plan." },
  "fightControl+sustain": { label: "Battle Medic", description: "You combine control and recovery to keep your side functioning through long fights." },
  "fightControl+teamPresence": { label: "Teamfight Conductor", description: "You stay connected to your team and dictate the shape and timing of group fights." },
  "sustain+survivability": { label: "Drain Tank", description: "You endure pressure through a mix of durability and recovery, inviting opponents to overcommit." },
  "sustain+teamPresence": { label: "Enabler", description: "You stay with your team and extend their ability to keep fighting." },
  "survivability+teamPresence": { label: "Frontliner", description: "You remain near your team and take responsibility for the dangerous space in front of them." },
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

  const ranked = [...profile.dimensions].sort((left, right) => right.score - left.score)
  const first = ranked[0]
  const second = ranked[1]
  const last = ranked.at(-1)!

  if (first.score - last.score <= BALANCED_SPREAD) {
    return {
      label: profile.score >= 58 ? "All-Rounder" : "Flexible",
      description: profile.score >= 58
        ? "You influence games in several ways and can shift between fighting, map play, and adaptation as needed."
        : "Your approach is balanced, with no single habit dominating how you play your games.",
      vectors: ranked.map((dimension) => dimension.key),
    }
  }

  if (first.score - second.score >= DOMINANT_GAP || second.score < SECONDARY_FLOOR) {
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
