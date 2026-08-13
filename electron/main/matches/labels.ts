import type {
  MatchRow,
  ParticipantRow,
  PerformanceLabel,
  PerformanceLabelConfidence,
  PerformanceLabelPolarity,
} from "./types.js"

export const LABEL_EVALUATOR_VERSION = 2
export const MAX_LABELS_PER_GAME = 6

interface LabelContext {
  match: MatchRow
  player: ParticipantRow
  participants: ParticipantRow[]
}

interface CandidateInput {
  id: string
  name: string
  category: string
  polarity: PerformanceLabelPolarity
  tooltip: string
  evidence: Record<string, string | number | boolean>
  priority: number
  confidence?: PerformanceLabelConfidence
  group?: string
}

export interface PrioritizablePerformanceLabel extends PerformanceLabel {
  group?: string
}

type Candidate = PrioritizablePerformanceLabel

export function prioritizePerformanceLabels(
  labels: PrioritizablePerformanceLabel[],
  limit = MAX_LABELS_PER_GAME,
): PerformanceLabel[] {
  const usedIds = new Set<string>()
  const usedGroups = new Set<string>()
  return labels
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .filter((candidate) => {
      if (usedIds.has(candidate.id)) return false
      usedIds.add(candidate.id)
      if (!candidate.group) return true
      if (usedGroups.has(candidate.group)) return false
      usedGroups.add(candidate.group)
      return true
    })
    .slice(0, limit)
    .map(({ group: _group, ...label }) => label)
}

const pct = (value: number) => `${Math.round(value * 100)}%`
const compact = (value: number) => Math.round(value).toLocaleString("en-US")
const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0
const role = (row: ParticipantRow) => (row.role ?? row.lane ?? "").toUpperCase()
const isSupport = (row: ParticipantRow) => role(row) === "UTILITY"
const isJungle = (row: ParticipantRow) => role(row) === "JUNGLE"

function rank(
  player: ParticipantRow,
  rows: ParticipantRow[],
  value: (row: ParticipantRow) => number,
) {
  const mine = value(player)
  return 1 + rows.filter((row) => value(row) > mine).length
}

function challenge(row: ParticipantRow, key: string) {
  const value = row.extendedMetrics?.[`challenge.${key}`]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Awards only labels supportable by the Match-V5 match summary. Behavioral
 * labels that need casts, cooldowns, continuous positions, health, waves, or
 * vision state intentionally do not appear here.
 */
export function evaluateMatchLabels(context: LabelContext): PerformanceLabel[] {
  const { match, player, participants } = context
  if (match.isMatched !== 1 || participants.length < 2 || match.durationSecs <= 0) {
    return []
  }

  const candidates: Candidate[] = []
  const add = (input: CandidateInput) => candidates.push({
    ...input,
    source: "match_v5",
    confidence: input.confidence ?? "exact",
  })
  const minutes = Math.max(1, match.durationSecs / 60)
  const myTeam = participants.filter((row) => row.teamId === player.teamId)
  const teamKills = myTeam.reduce((sum, row) => sum + row.kills, 0)
  const teamDamage = myTeam.reduce((sum, row) => sum + row.damageToChampions, 0)
  const teamGold = myTeam.reduce((sum, row) => sum + row.goldEarned, 0)
  const killParticipation = Math.min(1, ratio(player.kills + player.assists, teamKills))
  const damageShare = ratio(player.damageToChampions, teamDamage)
  const goldShare = ratio(player.goldEarned, teamGold)
  const cs = player.totalMinionsKilled + player.neutralMinions
  const csPerMinute = cs / minutes
  const damageRank = rank(player, participants, (row) => row.damageToChampions)
  const damageTakenRank = rank(player, participants, (row) => row.damageTaken)
  const objectiveRank = rank(player, participants, (row) => row.damageObjectives)
  const turretDamageRank = rank(player, participants, (row) => row.damageTurrets)
  const visionRank = rank(player, participants, (row) => row.visionScore)
  const ccRank = rank(player, participants, (row) => row.timeCcingOthers)
  const healingRank = rank(player, participants, (row) => row.totalHeal)
  const efficiencyRank = rank(
    player,
    participants,
    (row) => ratio(row.damageToChampions, row.goldEarned),
  )

  if (player.pentaKills > 0) add({
    id: "pentakill", name: "Pentakill", category: "Kills", polarity: "positive",
    tooltip: `You secured ${player.pentaKills === 1 ? "a pentakill" : `${player.pentaKills} pentakills`}.`,
    evidence: { pentaKills: player.pentaKills }, priority: 100, group: "multikill",
  })
  if (player.quadraKills > 0) add({
    id: "quadra_kill", name: "Quadra Threat", category: "Kills", polarity: "positive",
    tooltip: `You secured ${player.quadraKills} quadra ${player.quadraKills === 1 ? "kill" : "kills"}.`,
    evidence: { quadraKills: player.quadraKills }, priority: 94, group: "multikill",
  })
  if (player.tripleKills > 0) add({
    id: "triple_kill", name: "Threefold", category: "Kills", polarity: "positive",
    tooltip: `You secured ${player.tripleKills} triple ${player.tripleKills === 1 ? "kill" : "kills"}.`,
    evidence: { tripleKills: player.tripleKills }, priority: 88, group: "multikill",
  })
  if (player.kills >= 10) add({
    id: "rampage", name: "Double-Digit Menace", category: "Kills", polarity: "positive",
    tooltip: `You finished with ${player.kills} kills.`, evidence: { kills: player.kills },
    priority: 75, group: "kills",
  })
  if (player.largestKillingSpree >= 5) add({
    id: "killing_spree", name: "Unbroken Momentum", category: "Kills", polarity: "positive",
    tooltip: `Your longest killing spree reached ${player.largestKillingSpree}.`,
    evidence: { largestKillingSpree: player.largestKillingSpree }, priority: 72, group: "kills",
  })
  if (player.assists >= 15) add({
    id: "assist_machine", name: "Assist Machine", category: "Teamplay", polarity: "positive",
    tooltip: `You recorded ${player.assists} assists.`, evidence: { assists: player.assists }, priority: 67,
  })
  if (player.firstBlood === 1) add({
    id: "first_blood", name: "First Blood", category: "Kills", polarity: "positive",
    tooltip: "You secured the first kill of the game.", evidence: { firstBlood: true }, priority: 76,
  })
  if (player.deaths === 0 && minutes >= 15 && player.kills + player.assists >= 3) add({
    id: "deathless", name: "Deathless", category: "Survival", polarity: "positive",
    tooltip: `You completed a ${Math.round(minutes)}-minute game without dying.`,
    evidence: { deaths: 0, minutes: Math.round(minutes) }, priority: 86, group: "survival",
  })
  if (player.deaths <= 2 && minutes >= 25) add({
    id: "hard_to_kill", name: "Hard to Kill", category: "Survival", polarity: "positive",
    tooltip: `You died only ${player.deaths} times in ${Math.round(minutes)} minutes.`,
    evidence: { deaths: player.deaths, minutes: Math.round(minutes) }, priority: 68, group: "survival",
  })
  if (player.deaths >= 10) add({
    id: "frequent_flyer", name: "Gray Screen Regular", category: "Survival", polarity: "negative",
    tooltip: `You died ${player.deaths} times.`, evidence: { deaths: player.deaths }, priority: 78, group: "deaths",
  })

  if (damageRank === 1 && player.damageToChampions >= 5_000) add({
    id: "top_damage", name: "Damage Crown", category: "Damage", polarity: "positive",
    tooltip: `You led the lobby with ${compact(player.damageToChampions)} champion damage.`,
    evidence: { damage: player.damageToChampions, lobbyRank: 1 }, priority: 84, group: "damage",
  })
  if (damageShare >= 0.30 && player.damageToChampions >= 5_000) add({
    id: "heavy_hitter", name: "Heavy Hitter", category: "Damage", polarity: "positive",
    tooltip: `You dealt ${pct(damageShare)} of your team's champion damage.`,
    evidence: { damage: player.damageToChampions, teamDamageShare: damageShare },
    priority: 73, confidence: "strong", group: "damage",
  })
  if (damageRank <= 2 && player.deaths <= 2 && player.damageToChampions >= 8_000) add({
    id: "untouchable_artillery", name: "Untouchable Artillery", category: "Damage", polarity: "positive",
    tooltip: `You ranked #${damageRank} in damage while dying ${player.deaths} times.`,
    evidence: { damageRank, deaths: player.deaths }, priority: 81, group: "damage_survival",
  })
  if (damageRank <= 2 && player.deaths >= 7) add({
    id: "glass_cannon", name: "Glass Cannon", category: "Damage", polarity: "mixed",
    tooltip: `You ranked #${damageRank} in damage, but died ${player.deaths} times.`,
    evidence: { damageRank, deaths: player.deaths }, priority: 77, group: "damage_survival",
  })
  if (efficiencyRank === 1 && player.damageToChampions >= 8_000) add({
    id: "damage_efficiency", name: "Punching Up", category: "Economy", polarity: "positive",
    tooltip: `You led the lobby with ${Math.round(ratio(player.damageToChampions, player.goldEarned) * 100) / 100} champion damage per gold earned.`,
    evidence: { damagePerGold: ratio(player.damageToChampions, player.goldEarned), lobbyRank: 1 },
    priority: 70, confidence: "strong", group: "efficiency",
  })
  if (damageTakenRank === 1 && player.deaths <= 5 && player.damageTaken >= 8_000) add({
    id: "damage_sponge", name: "Damage Sponge", category: "Durability", polarity: "positive",
    tooltip: `You absorbed a lobby-high ${compact(player.damageTaken)} damage and died ${player.deaths} times.`,
    evidence: { damageTaken: player.damageTaken, deaths: player.deaths, lobbyRank: 1 }, priority: 78,
  })
  if (damageRank === participants.length && damageShare <= 0.12 && !isSupport(player) && minutes >= 20) add({
    id: "low_damage", name: "Wet Noodle", category: "Damage", polarity: "negative",
    tooltip: `You ranked last in champion damage with ${pct(damageShare)} of your team's total.`,
    evidence: { damage: player.damageToChampions, teamDamageShare: damageShare, lobbyRank: damageRank },
    priority: 65, confidence: "strong", group: "damage",
  })
  if (player.trueDamageToChampions >= 5_000 && rank(player, participants, (row) => row.trueDamageToChampions) === 1) add({
    id: "true_damage", name: "True Damage Menace", category: "Damage", polarity: "positive",
    tooltip: `You led the lobby with ${compact(player.trueDamageToChampions)} true damage to champions.`,
    evidence: { trueDamage: player.trueDamageToChampions, lobbyRank: 1 }, priority: 69,
  })

  if ((match.modeFamily === "sr" || match.modeFamily === "classic") && !isSupport(player) && !isJungle(player) && (cs >= 250 || csPerMinute >= 8.5)) add({
    id: "farm_machine", name: "Farm Machine", category: "Economy", polarity: "positive",
    tooltip: `You collected ${cs} CS (${csPerMinute.toFixed(1)} per minute).`,
    evidence: { cs, csPerMinute }, priority: 69,
  })
  if (goldShare <= 0.17 && killParticipation >= 0.70 && teamKills >= 10) add({
    id: "low_economy_hero", name: "Low-Economy Hero", category: "Economy", polarity: "positive",
    tooltip: `You joined ${pct(killParticipation)} of team kills on ${pct(goldShare)} of team gold.`,
    evidence: { killParticipation, teamGoldShare: goldShare }, priority: 74, confidence: "strong",
  })
  if (goldShare >= 0.24 && damageShare <= 0.14 && teamDamage >= 10_000) add({
    id: "low_return", name: "All Bark, No Bite", category: "Economy", polarity: "negative",
    tooltip: `You took ${pct(goldShare)} of team gold but dealt ${pct(damageShare)} of team champion damage.`,
    evidence: { teamGoldShare: goldShare, teamDamageShare: damageShare },
    priority: 72, confidence: "strong", group: "efficiency",
  })

  if (visionRank <= 2 && player.visionScore / minutes >= (isSupport(player) ? 1.5 : 0.8) && (match.modeFamily === "sr" || match.modeFamily === "classic")) add({
    id: "visionary", name: "Visionary", category: "Vision", polarity: "positive",
    tooltip: `You ranked #${visionRank} with ${player.visionScore} vision score (${(player.visionScore / minutes).toFixed(1)} per minute).`,
    evidence: { visionScore: player.visionScore, visionPerMinute: player.visionScore / minutes, lobbyRank: visionRank },
    priority: 68, confidence: "strong", group: "vision",
  })
  if (player.wardsKilled >= 6) add({
    id: "sweeper", name: "Sweeper", category: "Vision", polarity: "positive",
    tooltip: `You destroyed ${player.wardsKilled} enemy wards.`, evidence: { wardsKilled: player.wardsKilled }, priority: 66,
  })
  if (player.controlWards >= 5) add({
    id: "control_freak", name: "Control Freak", category: "Vision", polarity: "positive",
    tooltip: `You purchased ${player.controlWards} control wards.`, evidence: { controlWards: player.controlWards }, priority: 62,
  })
  if ((match.modeFamily === "sr" || match.modeFamily === "classic") && minutes >= 25 && player.controlWards === 0 && (isSupport(player) || isJungle(player))) add({
    id: "no_control_wards", name: "No Pink Budget", category: "Vision", polarity: "negative",
    tooltip: `You purchased no control wards in a ${Math.round(minutes)}-minute game.`,
    evidence: { controlWards: 0, minutes: Math.round(minutes) }, priority: 64,
  })

  if (objectiveRank === 1 && player.damageObjectives >= 5_000) add({
    id: "objective_force", name: "Objective Force", category: "Objectives", polarity: "positive",
    tooltip: `You led the lobby with ${compact(player.damageObjectives)} damage to objectives.`,
    evidence: { objectiveDamage: player.damageObjectives, lobbyRank: 1 }, priority: 73, group: "objectives",
  })
  if (turretDamageRank === 1 && player.damageTurrets >= 4_000) add({
    id: "demolition_crew", name: "Demolition Crew", category: "Objectives", polarity: "positive",
    tooltip: `You led the lobby with ${compact(player.damageTurrets)} damage to turrets.`,
    evidence: { turretDamage: player.damageTurrets, lobbyRank: 1 }, priority: 72, group: "structures",
  })
  const turretTakedowns = Math.max(player.turretKills, challenge(player, "turretTakedowns"))
  if (turretTakedowns >= 4) add({
    id: "tower_taker", name: "Tower Taker", category: "Objectives", polarity: "positive",
    tooltip: `You contributed to ${Math.round(turretTakedowns)} turret takedowns.`,
    evidence: { turretTakedowns: Math.round(turretTakedowns) }, priority: 74, group: "structures",
  })
  if (player.damageTurrets === 0 && (match.modeFamily === "sr" || match.modeFamily === "classic") && !isSupport(player) && minutes >= 20) add({
    id: "no_structure_damage", name: "No Structure Damage", category: "Objectives", polarity: "negative",
    tooltip: "You dealt no damage to enemy turrets.", evidence: { turretDamage: 0 }, priority: 63, group: "structures",
  })
  const plates = challenge(player, "turretPlatesTaken")
  if (plates >= 3) add({
    id: "plate_collector", name: "Plate Collector", category: "Objectives", polarity: "positive",
    tooltip: `You took ${Math.round(plates)} turret plates.`, evidence: { turretPlatesTaken: Math.round(plates) }, priority: 71,
  })
  const steals = Number(player.extendedMetrics?.objectivesStolen ?? 0)
  if (steals >= 1) add({
    id: "objective_thief", name: "Objective Thief", category: "Objectives", polarity: "positive",
    tooltip: `You stole ${steals} major ${steals === 1 ? "objective" : "objectives"}.`,
    evidence: { objectivesStolen: steals }, priority: 90,
  })
  if (player.firstTower === 1) add({
    id: "first_tower", name: "First Tower", category: "Objectives", polarity: "positive",
    tooltip: "You secured the game's first turret kill.", evidence: { firstTower: true }, priority: 70,
  })

  if (killParticipation >= 0.75 && teamKills >= 10) add({
    id: "team_player", name: "Always There", category: "Teamplay", polarity: "positive",
    tooltip: `You participated in ${pct(killParticipation)} of your team's ${teamKills} kills.`,
    evidence: { killParticipation, teamKills }, priority: 71, confidence: "strong", group: "participation",
  })
  if (killParticipation <= 0.30 && teamKills >= 10) add({
    id: "low_participation", name: "Out of the Action", category: "Teamplay", polarity: "negative",
    tooltip: `You participated in ${pct(killParticipation)} of your team's ${teamKills} kills.`,
    evidence: { killParticipation, teamKills }, priority: 66, confidence: "strong", group: "participation",
  })
  if (ccRank === 1 && player.timeCcingOthers >= 20) add({
    id: "crowd_controller", name: "Crowd Controller", category: "Teamplay", polarity: "positive",
    tooltip: `You led the lobby with ${Math.round(player.timeCcingOthers)} seconds of champion crowd control.`,
    evidence: { crowdControlSeconds: player.timeCcingOthers, lobbyRank: 1 }, priority: 70,
  })
  if (healingRank === 1 && player.totalHeal >= 10_000) add({
    id: "healing_leader", name: "Field Medic", category: "Utility", polarity: "positive",
    tooltip: `You led the lobby with ${compact(player.totalHeal)} total healing.`,
    evidence: { totalHealing: player.totalHeal, lobbyRank: 1 }, priority: 67,
  })
  const allyHealing = Number(player.extendedMetrics?.totalHealsOnTeammates ?? 0)
  if (allyHealing >= 5_000) add({
    id: "ally_healer", name: "Team Medic", category: "Utility", polarity: "positive",
    tooltip: `You restored ${compact(allyHealing)} health to teammates.`,
    evidence: { teammateHealing: allyHealing }, priority: 72,
  })
  const allyShielding = Number(player.extendedMetrics?.totalDamageShieldedOnTeammates ?? 0)
  if (allyShielding >= 5_000) add({
    id: "shield_wall", name: "Shield Wall", category: "Utility", polarity: "positive",
    tooltip: `You shielded teammates from ${compact(allyShielding)} damage.`,
    evidence: { teammateShielding: allyShielding }, priority: 72,
  })
  const soloKills = challenge(player, "soloKills")
  if (soloKills >= 2) add({
    id: "solo_advantage", name: "Solo Advantage", category: "Kills", polarity: "positive",
    tooltip: `You earned ${Math.round(soloKills)} solo kills.`, evidence: { soloKills: Math.round(soloKills) }, priority: 75,
  })

  // One label per overlapping story keeps the result readable. Exact, rare
  // feats naturally outrank broader summaries inside the same group.
  return prioritizePerformanceLabels(candidates)
}
