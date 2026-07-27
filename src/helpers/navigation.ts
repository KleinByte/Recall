import { ref } from "vue"
import type { MatchRow } from "../types/stats"

export type PageId =
  | "dashboard"
  | "challenges"
  | "matches"
  | "skill"
  | "progress"
  | "champions"
  | "settings"

/**
 * Where the app is, and what it was asked to show when it got there.
 *
 * Navigation is shared rather than passed down because anything on any page
 * may want to send you somewhere else — a challenge on the dashboard, a
 * champion on a scoreboard — and threading callbacks through every component
 * to achieve that would be worse than a single small piece of shared state.
 */
export const page = ref<PageId>("dashboard")

/** A challenge the Challenges page should open and scroll to on arrival. */
export const focusChallengeId = ref<number | null>(null)

/** A champion whose breakdown is open, shown over whatever page is beneath. */
export const detailChampionId = ref<number | null>(null)

/** A match whose full sheet is open, shown over whatever page is beneath. */
export const detailMatch = ref<MatchRow | null>(null)

export function goTo(target: PageId) {
  page.value = target
}

export function openChallenge(challengeId: number) {
  focusChallengeId.value = challengeId
  page.value = "challenges"
}

export function openChampion(championId: number) {
  detailChampionId.value = championId
}

export function closeChampion() {
  detailChampionId.value = null
}

export function openMatch(match: MatchRow) {
  detailMatch.value = match
}

export function closeMatch() {
  detailMatch.value = null
}
