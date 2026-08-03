<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import ChallengeRowView from "../components/ChallengeRow.vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import {
  challengeGameModeLabel,
  challengeGameModes,
  challengeMapForGameMode,
  challengeMatchesCategory,
  challengeMatchesGameMode,
  challengeMatchesMap,
  isChallengeCompleted,
  sortChallenges,
  type ChallengeSortDirection,
  type ChallengeSortKey,
} from "../helpers/challenges"
import { championIconUrl } from "../helpers/format"
import { focusChallengeId, openChampion } from "../helpers/navigation"
import type { Champion } from "../types/lol"
import type { ChallengeRow } from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
  isColoredWhenDone?: boolean
  showChampionNames?: boolean
}>()
const events = useApiEvents()

const CATEGORIES = [
  "All",
  "TEAMWORK",
  "EXPERTISE",
  "VETERANCY",
  "COLLECTION",
  "IMAGINATION",
  "LEGACY",
]

const LEVELS = [
  "All",
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
]

const SORTS: { value: ChallengeSortKey; label: string }[] = [
  { value: "closest", label: "Closest to next tier" },
  { value: "level", label: "Current tier" },
  { value: "name", label: "Name" },
  { value: "category", label: "Category" },
  { value: "updated", label: "Recently updated" },
]

const challenges = ref<ChallengeRow[]>([])
const pinned = ref<number[]>([])
const search = ref("")
const category = ref("All")
const level = ref("All")
const gameMode = ref("")
const challengeMap = ref("")
const championOnly = ref(false)
const showRetired = ref(false)
const hideCompleted = ref(true)
const sortBy = ref<ChallengeSortKey>("closest")
const sortDirection = ref<ChallengeSortDirection>("desc")
const expandedId = ref<number | null>(null)
/** Rendering all 399 rows at once is slow and pointless; more load on demand. */
const visibleCount = ref(40)

async function load() {
  try {
    challenges.value = await api.listChallenges({ includeRetired: true })
  } catch {
    challenges.value = []
  }

  try {
    pinned.value = await api.getPinnedChallenges()
  } catch {
    pinned.value = []
  }
}

/**
 * Pinned challenges are the ones checked in champion select, so the star is
 * the control that makes the whole feature reachable.
 */
async function togglePin(challengeId: number) {
  pinned.value = pinned.value.includes(challengeId)
    ? await api.unpinChallenge(challengeId)
    : await api.pinChallenge(challengeId)
}

const refresh = useCoalescedTask(load)

onMounted(() => {
  void refresh()
  events.on("challenges:updated", () => void refresh())
  events.on("lcu:status", () => void refresh())
})

/**
 * Opens a challenge that was clicked somewhere else in the app.
 *
 * The filters are cleared first, because a challenge arrived at from the
 * dashboard is very often hidden by whatever was being browsed before.
 */
async function focusOn(challengeId: number) {
  const challenge = challenges.value.find(
    (entry) => entry.challengeId === challengeId,
  )
  if (!challenge) return

  search.value = ""
  category.value = "All"
  level.value = "All"
  gameMode.value = ""
  challengeMap.value = ""
  championOnly.value = false
  showRetired.value = challenge.isRetired === 1
  if (isChallengeCompleted(challenge)) hideCompleted.value = false

  // Make sure the row is inside the rendered window before scrolling to it.
  const index = filtered.value.findIndex(
    (entry) => entry.challengeId === challengeId,
  )
  if (index >= visibleCount.value) visibleCount.value = index + 10

  expandedId.value = challengeId
  focusChallengeId.value = null

  await nextTick()
  document
    .getElementById(`challenge-${challengeId}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" })
}

watch(
  [focusChallengeId, challenges],
  ([target]) => {
    if (target !== null) void focusOn(target)
  },
  { immediate: true },
)

const filtered = computed(() => {
  const needle = search.value.toLowerCase()

  const matches = challenges.value.filter((challenge) => {
    const retired = challenge.isRetired === 1
    if (showRetired.value !== retired) return false
    if (
      hideCompleted.value &&
      !retired &&
      isChallengeCompleted(challenge)
    ) {
      return false
    }

    if (!challengeMatchesCategory(challenge, category.value)) return false
    if (level.value !== "All" && challenge.currentLevel !== level.value) {
      return false
    }
    if (!challengeMatchesGameMode(challenge, gameMode.value)) return false
    if (!challengeMatchesMap(challenge, challengeMap.value)) return false
    if (championOnly.value && challenge.idListType !== "CHAMPION") return false

    if (needle) {
      return (
        challenge.name.toLowerCase().includes(needle) ||
        challenge.description.toLowerCase().includes(needle)
      )
    }
    return true
  })

  return sortChallenges(matches, sortBy.value, sortDirection.value)
})

const visible = computed(() => filtered.value.slice(0, visibleCount.value))

const gameModeOptions = computed(() => {
  const modes = new Set(challenges.value.flatMap(challengeGameModes))
  return [...modes].sort((left, right) =>
    challengeGameModeLabel(left).localeCompare(challengeGameModeLabel(right)),
  )
})

const mapOptions = computed(() => {
  const maps = new Set(gameModeOptions.value.map(challengeMapForGameMode))
  return [...maps].sort((left, right) => left.localeCompare(right))
})

const pinnedChallenges = computed(() =>
  challenges.value.filter(
    (challenge) =>
      pinned.value.includes(challenge.challengeId) &&
      challengeMatchesCategory(challenge, category.value) &&
      (!hideCompleted.value || !isChallengeCompleted(challenge)),
  ),
)

watch(
  [
    search,
    category,
    level,
    gameMode,
    challengeMap,
    championOnly,
    showRetired,
    hideCompleted,
    sortBy,
    sortDirection,
  ],
  () => {
    visibleCount.value = 40
    expandedId.value = null
  },
)

watch(sortBy, (key) => {
  sortDirection.value =
    key === "name" || key === "category" ? "asc" : "desc"
})

const toggle = (challengeId: number) => {
  expandedId.value = expandedId.value === challengeId ? null : challengeId
}

const splitChampions = (challenge: ChallengeRow) => {
  if (challenge.idListType !== "CHAMPION" || !props.champions) {
    return { missing: [], done: [] }
  }

  let completed: number[] = []
  try {
    completed = JSON.parse(challenge.completedIds) as number[]
  } catch {
    return { missing: [], done: [] }
  }

  const completedSet = new Set(completed)

  return {
    missing: props.champions.filter((c) => !completedSet.has(c.id)),
    done: props.champions.filter((c) => completedSet.has(c.id)),
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Challenges</h1>
        <p class="muted subtitle">
          Showing {{ filtered.length }} of {{ challenges.length }} tracked
          challenges
        </p>
      </div>

      <input
        v-model="search"
        class="league-input search"
        type="search"
        placeholder="Search challenges"
      />
    </header>

    <div class="filters card">
      <label class="field">
        <span class="muted field-label">Category</span>
        <select v-model="category" class="league-select">
          <option v-for="option in CATEGORIES" :key="option" :value="option">
            {{ option === "All" ? "All categories" : option }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="muted field-label">Tier</span>
        <select v-model="level" class="league-select">
          <option v-for="option in LEVELS" :key="option" :value="option">
            {{ option === "All" ? "All tiers" : option }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="muted field-label">Game mode</span>
        <select v-model="gameMode" class="league-select">
          <option value="">All game modes</option>
          <option v-for="mode in gameModeOptions" :key="mode" :value="mode">
            {{ challengeGameModeLabel(mode) }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="muted field-label">Map</span>
        <select v-model="challengeMap" class="league-select">
          <option value="">All maps</option>
          <option v-for="map in mapOptions" :key="map" :value="map">
            {{ map }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="muted field-label">Sort</span>
        <select v-model="sortBy" class="league-select">
          <option
            v-for="option in SORTS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <button
        class="league-button direction"
        type="button"
        :title="sortDirection === 'desc' ? 'Sort descending' : 'Sort ascending'"
        :aria-label="
          sortDirection === 'desc' ? 'Sort descending' : 'Sort ascending'
        "
        @click="sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'"
      >
        {{ sortDirection === "desc" ? "↓" : "↑" }}
      </button>

      <label class="toggle">
        <input type="checkbox" v-model="championOnly" />
        <span>Champion challenges only</span>
      </label>

      <label class="toggle">
        <input type="checkbox" v-model="hideCompleted" />
        <span>Hide completed challenges</span>
      </label>

      <label class="toggle">
        <input type="checkbox" v-model="showRetired" />
        <span>Retired challenges</span>
      </label>
    </div>

    <p v-if="showRetired" class="muted note">
      Retired challenges can no longer be progressed. They are kept for
      reference only.
    </p>

    <div v-if="pinnedChallenges.length" class="card pinned-panel">
      <h2 class="section-title">
        Chasing ({{ pinnedChallenges.length }})
      </h2>
      <p class="muted note">
        Champion select shows whether the champion you are holding counts
        towards these.
      </p>
      <div class="pinned-list">
        <button
          v-for="challenge in pinnedChallenges"
          :key="challenge.challengeId"
          class="pinned-chip"
          :title="`Stop chasing ${challenge.name}`"
          @click="togglePin(challenge.challengeId)"
        >
          <span class="pinned-name">{{ challenge.name }}</span>
          <span class="muted">×</span>
        </button>
      </div>
    </div>

    <div v-if="challenges.length === 0" class="card notice">
      <h2 class="section-title">No challenge data yet</h2>
      <p class="muted">
        {{
          connected
            ? "Recall is importing your challenges — this takes a moment."
            : "Start the League client and Recall will import all of your challenges."
        }}
      </p>
    </div>

    <div class="list">
      <ChallengeRowView
        v-for="challenge in visible"
        :id="`challenge-${challenge.challengeId}`"
        :key="challenge.challengeId"
        :challenge="challenge"
        :expanded="expandedId === challenge.challengeId"
        :pinned="pinned.includes(challenge.challengeId)"
        @toggle="toggle(challenge.challengeId)"
        @pin="togglePin(challenge.challengeId)"
      >
        <template #champions>
          <div
            v-if="challenge.idListType === 'CHAMPION' && champions"
            class="champion-section"
          >
            <div class="muted grid-label">
              Still needed ({{ splitChampions(challenge).missing.length }})
            </div>
            <div class="grid" :class="{ named: showChampionNames }">
              <button
                v-for="champion in splitChampions(challenge).missing"
                :key="champion.id"
                class="champion"
                :title="`${champion.name} — still needed`"
                @click.stop="openChampion(champion.id)"
              >
                <img
                  :src="championIconUrl(champion.id)"
                  :alt="champion.name"
                  loading="lazy"
                />
                <span v-if="showChampionNames" class="champion-name">
                  {{ champion.name }}
                </span>
              </button>
            </div>

            <div class="muted grid-label">
              Completed ({{ splitChampions(challenge).done.length }})
            </div>
            <div class="grid" :class="{ named: showChampionNames }">
              <button
                v-for="champion in splitChampions(challenge).done"
                :key="champion.id"
                class="champion done"
                :class="{ colored: isColoredWhenDone }"
                :title="`${champion.name} — done`"
                @click.stop="openChampion(champion.id)"
              >
                <img
                  :src="championIconUrl(champion.id)"
                  :alt="champion.name"
                  loading="lazy"
                />
                <span v-if="showChampionNames" class="champion-name">
                  {{ champion.name }}
                </span>
              </button>
            </div>
          </div>
        </template>
      </ChallengeRowView>
    </div>

    <button
      v-if="visible.length < filtered.length"
      class="league-button more"
      @click="visibleCount += 60"
    >
      Show more ({{ filtered.length - visible.length }} remaining)
    </button>

    <p v-if="filtered.length === 0 && challenges.length > 0" class="muted empty">
      No challenges match these filters.
    </p>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  flex-wrap: wrap;
}

h1 {
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: 1px;
  margin: 0;
  color: var(--gold-bright);
}

.subtitle {
  margin: var(--space-1) 0 0;
  font-size: 12px;
}

.search {
  width: 240px;
}

.filters {
  display: flex;
  gap: var(--space-4);
  align-items: flex-end;
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.field-label {
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  cursor: pointer;
  padding-bottom: var(--space-2);
}

.toggle input {
  accent-color: var(--gold);
}

.direction {
  width: 38px;
  padding-inline: 0;
  font-size: 17px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.more {
  align-self: center;
  padding: var(--space-2) var(--space-5);
}

.champion-section {
  margin-top: var(--space-2);
}

.grid-label {
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  margin: var(--space-3) 0 var(--space-2);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: var(--space-1);
}

/* Names need room to breathe, so the tiles grow when they are shown. */
.grid.named {
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: var(--space-2);
}

.champion {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.champion img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: border-color 0.12s ease;
}

.champion:hover img {
  border-color: var(--gold);
}

.champion-name {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* Completed champions recede so the ones still needed stand out. */
.champion.done img {
  filter: grayscale(1);
  opacity: 0.4;
}

/* Unless you would rather see them marked in colour. */
.champion.done.colored img {
  filter: none;
  opacity: 1;
  border-color: var(--win);
}

.note {
  font-size: 12px;
  margin: 0;
}

.pinned-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.pinned-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.pinned-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-3);
  font-family: inherit;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.pinned-chip:hover {
  border-color: var(--gold);
}

.pinned-name {
  max-width: 30ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice {
  max-width: 60ch;
}

.notice p {
  margin: 0;
  font-size: 13px;
}

.empty {
  font-size: 12px;
  text-align: center;
  padding: var(--space-5);
}
</style>
