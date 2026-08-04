<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import RankGraph from "../components/RankGraph.vue"
import {
  Button as UiButton,
  EmptyState,
  Field as UiField,
  PageHeader,
  Panel,
  Surface,
  Tabs as UiTabs,
} from "../components/ui"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import { reviewMatch } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatRecordValue,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type {
  ChallengeRow,
  Goal,
  PersonalRecord,
  RankedHistory,
  StatsFilter,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()
const events = useApiEvents()

const QUEUE_LABELS: Record<string, string> = {
  RANKED_SOLO_5x5: "Solo/Duo",
  RANKED_FLEX_SR: "Flex",
  RANKED_PREMADE_5x5: "Flex",
}

/** Ladder points per tier, matching how the main process scores a rank. */
const POINTS_PER_TIER = 400

const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
]

type RecordScopeId = "rankedSolo" | "aram" | "mayhem" | "leagueClassic" | "allRift"

const RECORD_SCOPES: readonly {
  id: RecordScopeId
  label: string
  filter: Partial<StatsFilter>
}[] = [
  {
    id: "rankedSolo",
    label: "Solo/Duo Ranked",
    filter: { mode: "sr_ranked_solo" },
  },
  {
    id: "aram",
    label: "ARAM",
    filter: { mode: "aram" },
  },
  {
    id: "mayhem",
    label: "Mayhem",
    filter: { mode: "mayhem" },
  },
  {
    id: "leagueClassic",
    label: "League Classic",
    filter: { mode: "league_classic" },
  },
  {
    id: "allRift",
    label: "All Rift",
    filter: {
      modes: [
        "sr_ranked_solo",
        "sr_ranked_flex",
        "sr_normal",
        "sr_quickplay",
        "sr_swiftplay",
      ],
    },
  },
]

const ranked = ref<RankedHistory[]>([])
const records = ref<PersonalRecord[]>([])
const recordScope = ref<RecordScopeId>("rankedSolo")
const recordCategory = ref<PersonalRecord["category"] | null>(null)
const recordsLoading = ref(false)
const goals = ref<Goal[]>([])
const challenges = ref<ChallengeRow[]>([])

const adding = ref(false)
const goalKind = ref<"challenge" | "rank">("rank")
const targetTier = ref("GOLD")
const challengeSearch = ref("")
const chosenChallenge = ref<ChallengeRow | null>(null)
const goalKindModel = computed<string>({
  get: () => goalKind.value,
  set: (value) => { goalKind.value = value as "challenge" | "rank" },
})
const goalKindOptions = [
  { value: "rank", label: "A rank" },
  { value: "challenge", label: "A challenge" },
]
const recordScopeModel = computed<string>({
  get: () => recordScope.value,
  set: (value) => { void selectRecordScope(value as RecordScopeId) },
})
const recordScopeOptions = RECORD_SCOPES.map((scope) => ({
  value: scope.id,
  label: scope.label,
}))

const selectedRecordScope = computed(() =>
  RECORD_SCOPES.find((scope) => scope.id === recordScope.value)!,
)

let recordsRequest = 0

async function loadRecords() {
  const request = ++recordsRequest
  recordsLoading.value = true

  try {
    const nextRecords = await api.getRecords(selectedRecordScope.value.filter)
    if (request === recordsRequest) records.value = nextRecords
  } finally {
    if (request === recordsRequest) recordsLoading.value = false
  }
}

async function selectRecordScope(scope: RecordScopeId) {
  if (scope === recordScope.value) return
  recordScope.value = scope
  records.value = []
  await loadRecords()
}

async function load() {
  try {
    const [nextRanked, nextGoals, nextChallenges] =
      await Promise.all([
        api.getRankedHistory(),
        api.listGoals(),
        api.listChallenges({ includeRetired: false }),
        loadRecords(),
      ])

    ranked.value = nextRanked
    goals.value = nextGoals
    challenges.value = nextChallenges
  } catch {
    // No account seen yet; the empty states cover this.
  }
}

const refresh = useCoalescedTask(load)

onMounted(() => {
  void refresh()
  events.on("stats:updated", () => void refresh())
  events.on("ranked:updated", () => void refresh())
  events.on("challenges:updated", () => void refresh())
  events.on("lcu:status", () => void refresh())
})

const rankedQueues = computed(() =>
  ranked.value
    .filter((entry) => QUEUE_LABELS[entry.queue] && entry.points.length > 0)
    .map((entry) => ({
      ...entry,
      label: QUEUE_LABELS[entry.queue],
      latest: entry.points[entry.points.length - 1],
      change:
        entry.points.length > 1
          ? entry.points[entry.points.length - 1].points - entry.points[0].points
          : 0,
    })),
)

const challengeMatches = computed(() => {
  const needle = challengeSearch.value.trim().toLowerCase()
  if (needle.length < 2) return []

  return challenges.value
    .filter((challenge) => challenge.name.toLowerCase().includes(needle))
    .slice(0, 6)
})

const outstanding = computed(() => goals.value.filter((g) => !g.achievedAt))
const achieved = computed(() => goals.value.filter((g) => g.achievedAt))

function chooseChallenge(challenge: ChallengeRow) {
  chosenChallenge.value = challenge
  challengeSearch.value = challenge.name
}

async function saveGoal() {
  if (goalKind.value === "rank") {
    const tier = targetTier.value
    await api.addGoal({
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: TIERS.indexOf(tier) * POINTS_PER_TIER,
      label: `Reach ${tier.charAt(0)}${tier.slice(1).toLowerCase()}`,
    })
  } else {
    const challenge = chosenChallenge.value
    if (!challenge) return

    const target = challenge.nextThreshold ?? challenge.currentThreshold ?? 0

    await api.addGoal({
      kind: "challenge",
      targetKey: String(challenge.challengeId),
      targetValue: target,
      label: `${challenge.name} — reach ${formatCompact(target)}`,
    })
  }

  resetForm()
  await load()
}

function resetForm() {
  adding.value = false
  challengeSearch.value = ""
  chosenChallenge.value = null
}

async function removeGoal(id: number) {
  await api.removeGoal(id)
  await load()
}

const canSave = computed(
  () => goalKind.value === "rank" || chosenChallenge.value !== null,
)

const championName = (id: number) => championNameById(props.champions, id)

const RECORD_CATEGORY_ORDER: PersonalRecord["category"][] = [
  "Performance",
  "Combat",
  "Economy",
  "Objectives",
  "Vision",
  "Timeline",
  "Special modes",
]
const recordGroups = computed(() => RECORD_CATEGORY_ORDER.flatMap((category) => {
  const entries = records.value.filter((record) => record.category === category)
  return entries.length ? [{ category, entries }] : []
}))
const activeRecordGroup = computed(() =>
  recordGroups.value.find((group) => group.category === recordCategory.value) ??
  recordGroups.value[0],
)
</script>

<template>
  <div class="page">
    <PageHeader
      title="Progress"
      eyebrow="Long-term archive"
      description="Where you are heading, and the best you have managed so far."
    />

    <Panel v-if="rankedQueues.length" title="Ranked" class="ranked-panel">
      <div class="queues">
        <div v-for="queue in rankedQueues" :key="queue.queue" class="queue">
          <div class="queue-head">
            <div>
              <div class="muted queue-label">{{ queue.label }}</div>
              <div class="queue-rank">{{ queue.latest.label }}</div>
            </div>
            <div class="queue-meta">
              <div class="numeric">{{ queue.latest.leaguePoints }} LP</div>
              <div
                v-if="queue.change !== 0"
                class="numeric change"
                :class="queue.change > 0 ? 'up' : 'down'"
              >
                {{ queue.change > 0 ? "+" : "" }}{{ queue.change }} since recording
                began
              </div>
            </div>
          </div>
          <RankGraph v-if="queue.points.length > 1" :points="queue.points" />
          <p v-else class="muted footnote">
            One reading so far. The line appears once your rank moves.
          </p>
        </div>
      </div>
    </Panel>

    <EmptyState
      v-else
      title="No ranked history yet"
      description="Recall notes where you stand each time it syncs, so a climb draws itself from here on. Nothing before today can be recovered — the client only reports where you are now."
    />

    <Panel title="Goals" class="goals-panel">
      <template #actions>
        <UiButton v-if="!adding" size="compact" @click="adding = true">
          Set a goal
        </UiButton>
      </template>

      <Surface v-if="adding" as="div" variant="inset" padding="compact" class="goal-form">
        <UiTabs
          v-model="goalKindModel"
          :options="goalKindOptions"
          label="Goal type"
          variant="compact"
          class="kind-tabs"
        />

        <UiField v-if="goalKind === 'rank'" label="Target" compact class="goal-field">
          <select v-model="targetTier" class="league-select">
            <option v-for="tier in TIERS" :key="tier" :value="tier">
              {{ tier.charAt(0) + tier.slice(1).toLowerCase() }}
            </option>
          </select>
        </UiField>

        <div v-else class="goal-field">
          <UiField label="Challenge" compact>
            <input
              v-model="challengeSearch"
              class="league-input"
              placeholder="Search your challenges"
              @input="chosenChallenge = null"
            />
          </UiField>
          <ul v-if="challengeMatches.length && !chosenChallenge" class="suggestions">
            <li v-for="challenge in challengeMatches" :key="challenge.challengeId">
              <button class="suggestion" @click="chooseChallenge(challenge)">
                <span>{{ challenge.name }}</span>
                <span class="muted numeric">
                  {{ formatCompact(challenge.currentValue) }} /
                  {{ formatCompact(challenge.nextThreshold ?? 0) }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div class="form-actions">
          <UiButton
            variant="primary"
            :disabled="!canSave"
            @click="saveGoal"
          >
            Save
          </UiButton>
          <UiButton variant="ghost" @click="resetForm">Cancel</UiButton>
        </div>
      </Surface>

      <EmptyState
        v-if="!outstanding.length && !achieved.length && !adding"
        compact
        title="No goals set"
        description="A goal turns a number into something to aim at."
      />

      <ul v-if="outstanding.length" class="goal-list">
        <li v-for="goal in outstanding" :key="goal.id">
          <div class="goal-head">
            <span class="goal-label">{{ goal.label }}</span>
            <UiButton
              variant="ghost"
              size="compact"
              class="remove"
              title="Remove this goal"
              @click="removeGoal(goal.id)"
            >
              Remove
            </UiButton>
          </div>
          <div class="track">
            <span class="fill" :style="{ width: `${goal.progress * 100}%` }" />
          </div>
          <div class="muted numeric goal-meta">
            {{ formatCompact(goal.current) }} /
            {{ formatCompact(goal.targetValue) }}
            · {{ Math.round(goal.progress * 100) }}%
          </div>
        </li>
      </ul>

      <ul v-if="achieved.length" class="goal-list done">
        <li v-for="goal in achieved" :key="goal.id">
          <div class="goal-head">
            <span class="goal-label">✓ {{ goal.label }}</span>
            <UiButton variant="ghost" size="compact" class="remove" @click="removeGoal(goal.id)">
              Remove
            </UiButton>
          </div>
          <div class="muted goal-meta">
            Reached {{ formatRelativeDate(goal.achievedAt!) }}
          </div>
        </li>
      </ul>
    </Panel>

    <Panel title="Personal records" class="records-card">
      <template #actions>
        <UiField label="Mode" compact class="record-scope-field">
          <select v-model="recordScopeModel" class="league-select">
            <option v-for="option in recordScopeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </UiField>
      </template>
      <p class="muted records-note">
        Curated personal bests for {{ selectedRecordScope.label }}. Choose a category, then open any result in Review.
      </p>

      <div v-if="records.length && activeRecordGroup" class="record-browser">
        <nav class="record-categories" aria-label="Record categories">
          <button
            v-for="group in recordGroups"
            :key="group.category"
            type="button"
            :class="{ active: activeRecordGroup.category === group.category }"
            :aria-pressed="activeRecordGroup.category === group.category"
            @click="recordCategory = group.category"
          >
            <span>{{ group.category }}</span>
            <strong class="numeric">{{ group.entries.length }}</strong>
          </button>
        </nav>

        <section class="record-ledger">
          <header>
            <div>
              <span class="record-kicker">Record category</span>
              <h3>{{ activeRecordGroup.category }}</h3>
            </div>
            <span>{{ activeRecordGroup.entries.length }} bests</span>
          </header>
          <div class="record-rows">
            <button
              v-for="record in activeRecordGroup.entries"
              :key="record.key"
              type="button"
              class="record-row"
              @click="reviewMatch(record.gameId)"
            >
              <img
                :src="championIconUrl(record.championId)"
                :alt="championName(record.championId)"
                class="portrait"
              />
              <span class="record-copy">
                <strong>{{ record.label }}</strong>
                <small>
                  {{ championName(record.championId) }} · {{ modeLabel(record.mode) }} ·
                  {{ formatRelativeDate(record.playedAt) }}
                </small>
              </span>
              <strong class="numeric record-value">{{ formatRecordValue(record) }}</strong>
              <span class="record-open" aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </div>
      <EmptyState
        v-else-if="recordsLoading"
        compact
        title="Loading personal records"
        :description="`Recall is collecting ${selectedRecordScope.label} bests.`"
      />
      <EmptyState
        v-else
        compact
        title="No personal records yet"
        :description="`No ${selectedRecordScope.label} games have been recorded yet.`"
      />
    </Panel>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  container: recall-content / inline-size;
}

.queues {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--space-3);
}

.queue-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
}

.queue-rank {
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--ui-accent-strong);
}

.queue-meta {
  text-align: right;
  font-size: 12px;
  color: var(--text-primary);
}

.change {
  font-size: 11px;
  margin-top: 2px;
}

.change.up { color: var(--ui-positive); }

.change.down { color: var(--ui-negative); }

.footnote {
  font-size: 11px;
  margin: 0;
}

.goal-form {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-3);
  margin-bottom: var(--ui-space-3);
}

.kind-tabs { align-self: flex-start; }
.goal-field { position: relative; max-width: 420px; }

.suggestions {
  list-style: none;
  margin: var(--space-1) 0 0;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  overflow: hidden;
}

.suggestion {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  background: none;
  border: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  text-align: left;
}

.suggestion:hover {
  background: var(--surface-3);
}

.form-actions {
  display: flex;
  gap: var(--space-2);
}

.goal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.goal-list.done {
  margin-top: var(--space-4);
  opacity: 0.65;
}

.goal-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.goal-label {
  font-size: 13px;
  color: var(--text-primary);
}

.remove {
  font-size: 11px;
}

.goal-meta {
  font-size: 11px;
  margin-top: var(--space-1);
}

.records-note {
  max-width: 58ch;
  margin: 0 0 var(--ui-space-4);
  font-size: 11px;
  line-height: 1.5;
}

.record-scope-field { width: min(220px, 100%); }

.record-browser {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(0, 1fr);
  gap: var(--ui-space-4);
  align-items: stretch;
}

.record-categories {
  display: grid;
  align-content: start;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
}

.record-categories button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-2);
  min-height: 35px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-subtle);
  font: 11px var(--ui-font-heading);
  text-align: left;
  cursor: pointer;
}

.record-categories button:hover { background: var(--ui-surface-hover-subtle); color: var(--ui-text); }
.record-categories button.active { border-color: var(--ui-border-emphasis); background: color-mix(in srgb, var(--ui-accent) 10%, var(--ui-surface-hover)); color: var(--ui-text-heading); }
.record-categories strong { color: var(--ui-text-muted); font-size: 10px; }

.record-ledger {
  display: flex;
  flex-direction: column;
  min-width: 0;
  block-size: 365px;
  overflow: hidden;
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
  box-shadow: var(--ui-shadow-inset);
}

.record-ledger > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding: 9px 11px;
  border-bottom: 1px solid var(--ui-divider);
  background: var(--ui-surface-hover-subtle);
}

.record-kicker { color: var(--ui-text-muted); font-size: 8px; letter-spacing: 1.2px; text-transform: uppercase; }
.record-ledger h3 { margin: 1px 0 0; color: var(--ui-text-heading); font: 13px var(--ui-font-heading); letter-spacing: .65px; text-transform: uppercase; }
.record-ledger > header > span { color: var(--ui-text-muted); font-size: 11px; }
.record-rows {
  display: grid;
  align-content: start;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.record-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: var(--ui-space-3);
  min-width: 0;
  min-height: 52px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--ui-divider);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.record-row:last-child { border-bottom: 0; }
.record-row:hover { background: color-mix(in srgb, var(--ui-live) 5%, var(--ui-surface-hover-subtle)); }
.record-copy { display: flex; flex-direction: column; min-width: 0; }
.record-copy strong { overflow: hidden; color: var(--ui-text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.record-copy small { overflow: hidden; margin-top: 2px; color: var(--ui-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.record-value { color: var(--ui-accent-strong); font: 18px var(--ui-font-numeric); white-space: nowrap; }
.record-open { color: var(--ui-live); opacity: .65; }

.portrait {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

@container recall-content (max-width: 720px) {
  .records-card :deep(.head) { align-items: flex-start; flex-direction: column; }
  .record-scope-field { width: 100%; }
  .record-browser { grid-template-columns: minmax(0, 1fr); }
  .record-categories { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
  .queue-head { gap: var(--ui-space-3); }
}

@container recall-content (max-width: 480px) {
  .queue-head { flex-direction: column; }
  .queue-meta { text-align: left; }
  .kind-tabs { width: 100%; }
  .form-actions :deep(.ui-button) { flex: 1; }
  .record-row { grid-template-columns: 30px minmax(0, 1fr) auto; }
  .record-open { display: none; }
  .record-value { font-size: 15px; }
}
</style>
