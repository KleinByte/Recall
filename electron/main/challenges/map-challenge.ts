import type { ChallengeRow, LcuChallenge } from "./types.js"

/**
 * Converts a challenge from the League client into a database row.
 *
 * Fields are copied explicitly rather than spread. The client payload includes
 * `friendsAtLevels`, which lists the PUUIDs of friends at each tier — other
 * people's data that Recall has no reason to keep. Building the row field by
 * field makes it impossible for that to be stored by accident.
 */
export function mapChallengeRow(
  raw: LcuChallenge,
  puuid: string,
  now = Date.now(),
): ChallengeRow {
  return {
    challengeId: raw.id,
    puuid,
    name: raw.name ?? "",
    description: raw.descriptionShort || raw.description || "",
    category: raw.category ?? "UNKNOWN",
    idListType: raw.idListType ?? "NONE",
    gameModes: JSON.stringify(raw.gameModes ?? []),
    currentLevel: raw.currentLevel ?? "NONE",
    nextLevel: raw.nextLevel ?? null,
    currentValue: raw.currentValue ?? 0,
    currentThreshold: raw.currentThreshold ?? null,
    nextThreshold: raw.nextThreshold ?? null,
    thresholds: JSON.stringify(raw.thresholds ?? {}),
    percentile: raw.percentile ?? null,
    pointsAwarded: raw.pointsAwarded ?? 0,
    isCapstone: raw.isCapstone ? 1 : 0,
    isApex: raw.isApex ? 1 : 0,
    isRetired: (raw.retireTimestamp ?? 0) > 0 ? 1 : 0,
    parentId: raw.parentId ?? null,
    iconPath: raw.iconPath ?? null,
    completedIds: JSON.stringify(raw.completedIds ?? []),
    updatedAt: now,
  }
}
