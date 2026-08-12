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

export const PRIMARY_ARCHETYPE_LABELS: Readonly<Record<PrimaryArchetype, string>> =
  Object.freeze({
    assassin: "Assassin",
    artillery: "Artillery",
    battlemage: "Battlemage",
    burst_mage: "Burst Mage",
    catcher: "Catcher",
    diver: "Diver",
    enchanter: "Enchanter",
    juggernaut: "Juggernaut",
    marksman: "Marksman",
    skirmisher: "Skirmisher",
    vanguard: "Vanguard",
    warden: "Warden",
    specialist: "Specialist",
  })
