/** Levels a challenge can reach, ordered from lowest to highest. */
export const CHALLENGE_LEVELS = [
  "NONE",
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const

export type ChallengeLevel = (typeof CHALLENGE_LEVELS)[number]

export interface ChallengeThreshold {
  value: number
  rewards: { category: string; quantity: number; name: string }[]
}

/**
 * A challenge as returned by
 * `/lol-challenges/v1/challenges/local-player`.
 *
 * The live payload also carries `friendsAtLevels`, listing the PUUIDs of
 * friends at each tier. It is declared here only so its presence is explicit;
 * it must never be persisted.
 */
export interface LcuChallenge {
  id: number
  name: string
  description: string
  descriptionShort: string
  category: string
  idListType: string
  gameModes: string[]
  currentLevel: string
  nextLevel?: string
  currentValue: number
  currentThreshold?: number
  nextThreshold?: number
  thresholds: Record<string, ChallengeThreshold>
  percentile?: number
  pointsAwarded: number
  isCapstone: boolean
  isApex: boolean
  retireTimestamp: number
  parentId?: number
  iconPath?: string
  completedIds: number[]
  availableIds: number[]
  friendsAtLevels?: { level: string; friends: string[] }[]
}

/** One row of the `challenges` table. */
export interface ChallengeRow {
  challengeId: number
  puuid: string
  name: string
  description: string
  category: string
  idListType: string
  gameModes: string
  currentLevel: string
  nextLevel: string | null
  currentValue: number
  currentThreshold: number | null
  nextThreshold: number | null
  thresholds: string
  percentile: number | null
  pointsAwarded: number
  isCapstone: number
  isApex: number
  isRetired: number
  parentId: number | null
  iconPath: string | null
  completedIds: string
  updatedAt: number
}

export interface ChallengeHistoryRow {
  challengeId: number
  puuid: string
  recordedAt: number
  currentValue: number
  currentLevel: string
}

export interface ProfileSnapshotRow {
  puuid: string
  recordedAt: number
  overallLevel: string
  totalScore: number
  percentile: number | null
  categoryJson: string
}
