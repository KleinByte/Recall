<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import ChallengeRowView from "../components/ChallengeRow.vue"
import {
  Button,
  EmptyState,
  Field,
  PageHeader,
  Surface,
} from "../components/ui"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import {
  buildChallengeGroups,
  challengeCategoryLabel,
  challengeGameModeLabel,
  challengeGameModes,
  challengeMapForGameMode,
  challengeMatchesCategory,
  challengeMatchesGameMode,
  challengeMatchesGroup,
  challengeMatchesKind,
  challengeMatchesMap,
  isChallengeCompleted,
  selectIncompleteChallenges,
  sortChallenges,
  type ChallengeKindFilter,
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

const KINDS: { value: ChallengeKindFilter; label: string }[] = [
  { value: "all", label: "All challenge types" },
  { value: "capstone", label: "Capstones only" },
  { value: "grouped", label: "Challenges in groups" },
  { value: "standalone", label: "Standalone challenges" },
]

const challenges = ref<ChallengeRow[]>([])
const pinned = ref<number[]>([])
const search = ref("")
const category = ref("All")
const level = ref("All")
const gameMode = ref("")
const challengeMap = ref("")
const challengeKind = ref<ChallengeKindFilter>("all")
const challengeGroupId = ref<number | null>(null)
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
  challengeKind.value = "all"
  challengeGroupId.value = null
  championOnly.value = false
  showRetired.value = challenge.isRetired === 1
  hideCompleted.value = !isChallengeCompleted(challenge)
  category.value = challenge.category === "LEGACY" ? "LEGACY" : "All"

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

const incompleteChallenges = computed(() =>
  selectIncompleteChallenges(challenges.value),
)

const challengeGroups = computed(() => buildChallengeGroups(challenges.value))
const capstoneIds = computed(() => new Set(
  challengeGroups.value.map((group) => group.capstone.challengeId),
))
const groupsById = computed(() => new Map(
  challengeGroups.value.map((group) => [group.capstone.challengeId, group]),
))

const groupOptions = computed(() => challengeGroups.value.filter(({ capstone }) => {
  if (!showRetired.value && capstone.isRetired === 1) return false
  return challengeMatchesCategory(capstone, category.value)
}))

const groupNameFor = (challenge: ChallengeRow) => {
  if (challenge.isCapstone === 1) return challenge.name
  if (challenge.parentId === null) return undefined
  return groupsById.value.get(challenge.parentId)?.capstone.name
}

const membersFor = (challenge: ChallengeRow) =>
  groupsById.value.get(challenge.challengeId)?.members ?? []

const selectedGroup = computed(() => challengeGroupId.value === null
  ? undefined
  : groupsById.value.get(challengeGroupId.value))
const selectedGroupMemberIds = computed(() => new Set(
  selectedGroup.value?.members.map((member) => member.challengeId) ?? [],
))

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const source = hideCompleted.value
    ? incompleteChallenges.value
    : challenges.value

  const matches = source.filter((challenge) => {
    const retired = challenge.isRetired === 1
    if (!showRetired.value && retired) return false

    if (!challengeMatchesCategory(challenge, category.value)) return false
    if (!challengeMatchesKind(challenge, challengeKind.value, capstoneIds.value)) {
      return false
    }
    if (!challengeMatchesGroup(
      challenge,
      challengeGroupId.value,
      selectedGroupMemberIds.value,
    )) return false
    if (level.value !== "All" && challenge.currentLevel !== level.value) {
      return false
    }
    if (!challengeMatchesGameMode(challenge, gameMode.value)) return false
    if (!challengeMatchesMap(challenge, challengeMap.value)) return false
    if (championOnly.value && challenge.idListType !== "CHAMPION") return false

    if (needle) {
      return (
        challenge.name.toLowerCase().includes(needle) ||
        challenge.description.toLowerCase().includes(needle) ||
        groupNameFor(challenge)?.toLowerCase().includes(needle)
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

const filterCount = computed(() => [
  search.value.trim() !== "",
  category.value !== "All",
  level.value !== "All",
  gameMode.value !== "",
  challengeMap.value !== "",
  challengeKind.value !== "all",
  challengeGroupId.value !== null,
  championOnly.value,
  showRetired.value,
  !hideCompleted.value,
].filter(Boolean).length)

const resetFilters = () => {
  search.value = ""
  category.value = "All"
  level.value = "All"
  gameMode.value = ""
  challengeMap.value = ""
  challengeKind.value = "all"
  challengeGroupId.value = null
  championOnly.value = false
  showRetired.value = false
  hideCompleted.value = true
  sortBy.value = "closest"
  sortDirection.value = "desc"
}

const pinnedChallenges = computed(() =>
  (hideCompleted.value ? incompleteChallenges.value : challenges.value).filter(
    (challenge) =>
      pinned.value.includes(challenge.challengeId) &&
      challengeMatchesCategory(challenge, category.value) &&
      (showRetired.value || challenge.isRetired !== 1),
  ),
)

watch(groupOptions, (options) => {
  if (
    challengeGroupId.value !== null &&
    !options.some((group) => group.capstone.challengeId === challengeGroupId.value)
  ) {
    challengeGroupId.value = null
  }
})

watch(
  [
    search,
    category,
    level,
    gameMode,
    challengeMap,
    challengeKind,
    challengeGroupId,
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
    <PageHeader
      title="Challenges"
      eyebrow="League challenge tracker"
      description="Find the next milestone worth chasing, browse a capstone as a complete group, and open any challenge for its full briefing."
    >
      <template #actions>
        <div class="result-readout" aria-live="polite">
          <span>In view</span>
          <strong class="numeric">{{ filtered.length }}</strong>
          <small>of {{ challenges.length }} synced</small>
        </div>
      </template>
    </PageHeader>

    <Surface
      as="section"
      variant="toolbar"
      padding="compact"
      class="filter-deck"
      aria-label="Challenge filters"
    >
      <div class="browser-top">
        <Field label="Search challenges" compact class="search-field">
          <input
            v-model="search"
            class="league-input search"
            type="search"
            placeholder="Search a name, objective, or capstone group"
          />
        </Field>

        <div v-if="selectedGroup" class="selected-group">
          <span>Browsing group</span>
          <strong>{{ selectedGroup.capstone.name }}</strong>
          <small>
            {{ selectedGroup.members.length }} member
            {{ selectedGroup.members.length === 1 ? "challenge" : "challenges" }}
          </small>
        </div>
        <div v-else class="selected-group default-scope">
          <span>Default scope</span>
          <strong>Active progress</strong>
          <small>Completed, legacy, and retired are hidden</small>
        </div>
      </div>

      <div class="filter-grid primary-filters">
        <Field label="Challenge group" compact class="group-field">
          <select v-model="challengeGroupId" class="league-select">
            <option :value="null">All challenge groups</option>
            <option
              v-for="group in groupOptions"
              :key="group.capstone.challengeId"
              :value="group.capstone.challengeId"
            >
              {{ group.capstone.name }} ({{ group.members.length }})
            </option>
          </select>
        </Field>

        <Field label="Challenge type" compact>
          <select v-model="challengeKind" class="league-select">
            <option
              v-for="option in KINDS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </Field>

        <Field label="Category" compact>
          <select v-model="category" class="league-select">
            <option v-for="option in CATEGORIES" :key="option" :value="option">
              {{ option === "All" ? "All active categories" : challengeCategoryLabel(option) }}
            </option>
          </select>
        </Field>

        <Field label="Tier" compact>
          <select v-model="level" class="league-select">
            <option v-for="option in LEVELS" :key="option" :value="option">
              {{ option === "All" ? "All tiers" : option }}
            </option>
          </select>
        </Field>
      </div>

      <div class="filter-grid secondary-filters">
        <Field label="Game mode" compact>
          <select v-model="gameMode" class="league-select">
            <option value="">All game modes</option>
            <option v-for="mode in gameModeOptions" :key="mode" :value="mode">
              {{ challengeGameModeLabel(mode) }}
            </option>
          </select>
        </Field>

        <Field label="Map" compact>
          <select v-model="challengeMap" class="league-select">
            <option value="">All maps</option>
            <option v-for="map in mapOptions" :key="map" :value="map">
              {{ map }}
            </option>
          </select>
        </Field>

        <div class="sort-stack">
          <Field label="Sort" compact>
            <select v-model="sortBy" class="league-select">
              <option
                v-for="option in SORTS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </Field>
          <Button
            class="direction"
            size="compact"
            icon-only
            type="button"
            :title="sortDirection === 'desc' ? 'Sort descending' : 'Sort ascending'"
            :aria-label="
              sortDirection === 'desc' ? 'Sort descending' : 'Sort ascending'
            "
            @click="sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'"
          >
            {{ sortDirection === "desc" ? "↓" : "↑" }}
          </Button>
        </div>
      </div>

      <footer class="filter-footer">
        <div class="filter-toggles" aria-label="Challenge visibility">
          <label class="filter-toggle" :class="{ active: hideCompleted }">
            <input v-model="hideCompleted" type="checkbox" />
            <span>
              <strong>Incomplete only</strong>
              <small>Completed hidden</small>
            </span>
          </label>

          <label class="filter-toggle" :class="{ active: championOnly }">
            <input v-model="championOnly" type="checkbox" />
            <span>
              <strong>Champion tracked</strong>
              <small>Champion pools only</small>
            </span>
          </label>

          <label class="filter-toggle" :class="{ active: showRetired }">
            <input v-model="showRetired" type="checkbox" />
            <span>
              <strong>Include retired</strong>
              <small>Reference only</small>
            </span>
          </label>
        </div>

        <Button
          v-if="filterCount"
          variant="ghost"
          size="compact"
          class="reset-filters"
          @click="resetFilters"
        >
          Reset filters <span class="filter-count">{{ filterCount }}</span>
        </Button>
      </footer>
    </Surface>

    <Surface
      v-if="pinnedChallenges.length"
      as="section"
      variant="quiet"
      padding="compact"
      class="pinned-panel"
    >
      <div class="pinned-copy">
        <span class="pinned-kicker">Pinned goals</span>
        <h2>Chasing {{ pinnedChallenges.length }}</h2>
        <p class="muted note">
          Champion select checks the champion you are holding against these.
        </p>
      </div>
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
    </Surface>

    <EmptyState
      v-if="challenges.length === 0"
      class="notice"
      title="No challenge data yet"
      :description="connected
        ? 'Recall is importing your challenges — this takes a moment.'
        : 'Start the League client and Recall will import all of your challenges.'"
    />

    <div v-if="filtered.length" class="ledger-head">
      <div>
        <span>{{ selectedGroup ? "Challenge group" : "Challenge ledger" }}</span>
        <strong>
          {{ selectedGroup?.capstone.name ?? "Your next milestones" }}
        </strong>
      </div>
      <p>
        {{ filtered.length }} matching · {{ visible.length }} loaded
      </p>
    </div>

    <div class="challenge-grid">
      <ChallengeRowView
        v-for="challenge in visible"
        :id="`challenge-${challenge.challengeId}`"
        :key="challenge.challengeId"
        :challenge="challenge"
        :expanded="expandedId === challenge.challengeId"
        :pinned="pinned.includes(challenge.challengeId)"
        :members="membersFor(challenge)"
        :group-name="groupNameFor(challenge)"
        @toggle="toggle(challenge.challengeId)"
        @pin="togglePin(challenge.challengeId)"
        @open-member="focusOn"
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

    <Button
      v-if="visible.length < filtered.length"
      class="more"
      @click="visibleCount += 60"
    >
      Show more ({{ filtered.length - visible.length }} remaining)
    </Button>

    <EmptyState
      v-if="filtered.length === 0 && challenges.length > 0"
      compact
      :title="hideCompleted ? 'No unfinished challenges match' : 'No challenges match these filters'"
      :description="hideCompleted
        ? 'The matching challenges are complete, legacy, retired, or outside the selected filters. Turn off Incomplete only or reset the browser to widen the ledger.'
        : 'Adjust the group, type, category, tier, mode, or map filters to widen the ledger.'"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.result-readout {
  display: grid;
  grid-template-columns: auto auto;
  align-items: end;
  gap: 0 8px;
  min-width: 112px;
  padding: 7px 10px;
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
}

.result-readout span {
  color: var(--ui-text-muted);
  font: var(--ui-text-micro) var(--ui-font-heading);
  letter-spacing: 1px;
  text-transform: uppercase;
}

.result-readout strong {
  grid-row: 1 / span 2;
  grid-column: 2;
  color: var(--ui-accent-strong);
  font-size: 22px;
  line-height: 1;
}

.result-readout small { color: var(--ui-text-subtle); font-size: 10px; }

.filter-deck {
  position: relative;
  display: grid;
  gap: var(--ui-space-3);
  overflow: hidden;
}

.filter-deck::before {
  position: absolute;
  inset: 0 auto auto 0;
  width: 150px;
  height: 1px;
  background: linear-gradient(90deg, var(--ui-accent), transparent);
  opacity: .55;
  content: "";
}

.browser-top {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(230px, 300px);
  align-items: end;
  gap: var(--ui-space-3);
  padding-bottom: var(--ui-space-3);
  border-bottom: 1px solid var(--ui-divider);
}

.search-field { width: 100%; }
.search { width: 100%; min-height: 40px; font-size: var(--ui-text-support); }

.selected-group {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--instrument-energy) 34%, var(--ui-divider));
  border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--instrument-energy) 6%, var(--ui-surface-panel));
  box-shadow: inset 2px 0 color-mix(in srgb, var(--instrument-energy) 64%, transparent);
}

.selected-group > span {
  color: var(--instrument-energy);
  font: var(--ui-text-micro) var(--ui-font-heading);
  letter-spacing: .9px;
  text-transform: uppercase;
}

.selected-group strong {
  overflow: hidden;
  color: var(--ui-text-heading);
  font-size: var(--ui-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-group small { color: var(--ui-text-muted); font-size: 10px; }
.selected-group.default-scope { border-color: var(--ui-divider); box-shadow: inset 2px 0 color-mix(in srgb, var(--ui-accent) 38%, transparent); }
.selected-group.default-scope > span { color: var(--ui-accent); }

.filter-grid {
  display: grid;
  gap: var(--ui-space-3);
}

.primary-filters {
  grid-template-columns: minmax(220px, 1.35fr) repeat(3, minmax(145px, 1fr));
}

.secondary-filters {
  grid-template-columns: repeat(2, minmax(155px, 1fr)) minmax(240px, 1.35fr);
}

.sort-stack {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  align-items: end;
  gap: var(--ui-space-2);
}

.direction {
  width: 32px;
  padding-inline: 0;
  font-size: 16px;
}

.filter-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding-top: var(--ui-space-3);
  border-top: 1px solid var(--ui-divider);
}

.filter-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-2);
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
  padding: 6px 9px;
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-panel-quiet);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}

.filter-toggle:hover { border-color: var(--ui-border-emphasis); }
.filter-toggle.active { border-color: color-mix(in srgb, var(--ui-accent) 48%, var(--ui-divider)); background: color-mix(in srgb, var(--ui-accent) 6%, var(--ui-surface-panel)); }
.filter-toggle input { margin: 0; accent-color: var(--ui-accent); }
.filter-toggle span { display: grid; gap: 1px; }
.filter-toggle strong { color: var(--ui-text); font-size: var(--ui-text-label); font-weight: 500; }
.filter-toggle small { color: var(--ui-text-muted); font-size: 9px; }

.reset-filters { flex: 0 0 auto; }
.filter-count {
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  border-radius: var(--ui-radius-pill);
  background: color-mix(in srgb, var(--ui-accent) 13%, var(--ui-surface-selected));
  color: var(--ui-accent-strong);
  font: 10px var(--ui-font-numeric);
}

.ledger-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding: 0 3px;
}

.ledger-head > div { display: grid; gap: 2px; }
.ledger-head span { color: var(--ui-text-muted); font: var(--ui-text-micro) var(--ui-font-heading); letter-spacing: 1.1px; text-transform: uppercase; }
.ledger-head strong { color: var(--ui-text-heading); font: 16px var(--ui-font-display); }
.ledger-head p { margin: 0; color: var(--ui-text-muted); font-size: var(--ui-text-micro); }

.challenge-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 10px;
}

.challenge-grid > :deep(.challenge.is-expanded) { grid-column: 1 / -1; }

.more {
  align-self: center;
  padding: var(--space-2) var(--space-5);
}

.champion-section {
  margin-top: var(--ui-space-1);
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-panel-quiet);
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
  display: grid;
  grid-template-columns: minmax(190px, auto) minmax(0, 1fr);
  align-items: center;
  gap: var(--ui-space-4);
  border-color: color-mix(in srgb, var(--ui-accent) 26%, var(--ui-border));
  background:
    radial-gradient(circle at 3% 50%, color-mix(in srgb, var(--ui-accent) 7%, transparent), transparent 28%),
    var(--ui-surface-panel-quiet);
}

.pinned-copy { display: grid; gap: 2px; }
.pinned-copy h2 { margin: 0; color: var(--ui-text-heading); font: 16px var(--ui-font-display); }
.pinned-kicker { color: var(--ui-accent); font: var(--ui-text-micro) var(--ui-font-heading); letter-spacing: 1px; text-transform: uppercase; }

.pinned-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.pinned-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 28px;
  padding: 4px 8px 4px 10px;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 32%, var(--ui-border));
  border-radius: var(--ui-radius-pill);
  background: color-mix(in srgb, var(--ui-accent) 5%, var(--ui-surface-panel));
  color: var(--ui-text);
  font: var(--ui-text-label) var(--ui-font-body);
  cursor: pointer;
  box-shadow: inset 2px 0 color-mix(in srgb, var(--ui-accent) 56%, transparent);
  transition: border-color 120ms ease, background 120ms ease;
}

.pinned-chip:hover {
  border-color: var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 9%, var(--ui-surface-panel));
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

.empty {
  font-size: 12px;
  text-align: center;
  padding: var(--space-5);
}

@container recall-content (max-width: 1050px) {
  .primary-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .challenge-grid { grid-template-columns: 1fr; }
  .challenge-grid > :deep(.challenge.is-expanded) { grid-column: auto; }
}

@container recall-content (max-width: 760px) {
  .browser-top,
  .secondary-filters { grid-template-columns: 1fr; }
  .filter-footer,
  .pinned-panel { align-items: stretch; grid-template-columns: 1fr; }
  .filter-footer { flex-direction: column; }
  .filter-toggles { width: 100%; }
  .filter-toggle { flex: 1 1 145px; }
  .reset-filters { align-self: flex-end; }
}

@container recall-content (max-width: 520px) {
  .primary-filters { grid-template-columns: 1fr; }
  .filter-toggle { flex-basis: 100%; }
  .ledger-head { align-items: start; flex-direction: column; }
}
</style>
