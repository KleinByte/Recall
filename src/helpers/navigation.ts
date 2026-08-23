import { computed, ref } from "vue"
import type { MatchRow } from "../types/stats"

export type PageId =
  | "dashboard"
  | "live"
  | "review"
  | "challenges"
  | "matches"
  | "skill"
  | "progress"
  | "champions"
  | "champion"
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

/** The champion selected by the current champion-detail history entry. */
export const detailChampionId = ref<number | null>(null)

export const focusReviewGameId = ref<number | null>(null)

export interface NavigationEntry {
  page: PageId
  reviewGameId?: number
  championId?: number
}

const entries = ref<NavigationEntry[]>([{ page: "dashboard" }])
const entryIndex = ref(0)

export const canGoBack = computed(() => entryIndex.value > 0)
export const canGoForward = computed(() => entryIndex.value < entries.value.length - 1)

const sameEntry = (left: NavigationEntry, right: NavigationEntry) =>
  left.page === right.page &&
  left.reviewGameId === right.reviewGameId &&
  left.championId === right.championId

function applyEntry(entry: NavigationEntry) {
  page.value = entry.page
  focusReviewGameId.value = entry.page === "review"
    ? entry.reviewGameId ?? null
    : null
  detailChampionId.value = entry.page === "champion"
    ? entry.championId ?? null
    : null
}

function navigate(entry: NavigationEntry) {
  const current = entries.value[entryIndex.value]
  if (current && sameEntry(current, entry)) {
    applyEntry(entry)
    return
  }

  entries.value = [
    ...entries.value.slice(0, entryIndex.value + 1),
    entry,
  ]
  entryIndex.value = entries.value.length - 1
  applyEntry(entry)
}

export function goTo(target: PageId) {
  navigate({ page: target })
}

export function goBack() {
  if (!canGoBack.value) return
  entryIndex.value -= 1
  applyEntry(entries.value[entryIndex.value])
}

export function goForward() {
  if (!canGoForward.value) return
  entryIndex.value += 1
  applyEntry(entries.value[entryIndex.value])
}

export function openChallenge(challengeId: number) {
  focusChallengeId.value = challengeId
  navigate({ page: "challenges" })
}

export function openChampion(championId: number) {
  navigate({ page: "champion", championId })
}

export function closeChampion() {
  if (page.value === "champion") goBack()
  else detailChampionId.value = null
}

export function openMatch(match: MatchRow) {
  reviewMatch(match.gameId)
}

export function reviewMatch(gameId: number) {
  navigate({ page: "review", reviewGameId: gameId })
}
