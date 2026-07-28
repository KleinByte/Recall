<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import RankGraph from "../components/RankGraph.vue"
import { api } from "../helpers/api"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type {
  ChallengeRow,
  Goal,
  PersonalRecord,
  RankedHistory,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

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

const ranked = ref<RankedHistory[]>([])
const records = ref<PersonalRecord[]>([])
const goals = ref<Goal[]>([])
const challenges = ref<ChallengeRow[]>([])

const adding = ref(false)
const goalKind = ref<"challenge" | "rank">("rank")
const targetTier = ref("GOLD")
const challengeSearch = ref("")
const chosenChallenge = ref<ChallengeRow | null>(null)

async function load() {
  try {
    const [nextRanked, nextRecords, nextGoals, nextChallenges] =
      await Promise.all([
        api.getRankedHistory(),
        api.getRecords({}),
        api.listGoals(),
        api.listChallenges({ includeRetired: false }),
      ])

    ranked.value = nextRanked
    records.value = nextRecords
    goals.value = nextGoals
    challenges.value = nextChallenges
  } catch {
    // No account seen yet; the empty states cover this.
  }
}

onMounted(() => {
  void load()
  api.on("stats:updated", () => void load())
  api.on("ranked:updated", () => void load())
  api.on("challenges:updated", () => void load())
  api.on("lcu:status", () => void load())
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

const formatRecord = (record: PersonalRecord) =>
  record.key === "kda"
    ? formatDecimal(record.value, 2)
    : formatCompact(record.value)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Progress</h1>
        <p class="muted subtitle">
          Where you are heading, and the best you have managed so far.
        </p>
      </div>
    </header>

    <section v-if="rankedQueues.length" class="card">
      <h2 class="section-title">Ranked</h2>
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
    </section>

    <div v-else class="card notice">
      <h2 class="section-title">No ranked history yet</h2>
      <p class="muted">
        Recall notes where you stand each time it syncs, so a climb draws itself
        from here on. Nothing before today can be recovered — the client only
        reports where you are now.
      </p>
    </div>

    <section class="card">
      <div class="panel-head">
        <h2 class="section-title flush">Goals</h2>
        <button
          v-if="!adding"
          class="league-button small"
          @click="adding = true"
        >
          Set a goal
        </button>
      </div>

      <div v-if="adding" class="goal-form">
        <div class="kind-row">
          <button
            class="league-button chip"
            :class="{ active: goalKind === 'rank' }"
            @click="goalKind = 'rank'"
          >
            A rank
          </button>
          <button
            class="league-button chip"
            :class="{ active: goalKind === 'challenge' }"
            @click="goalKind = 'challenge'"
          >
            A challenge
          </button>
        </div>

        <label v-if="goalKind === 'rank'" class="field">
          <span class="muted field-label">Target</span>
          <select v-model="targetTier" class="league-select">
            <option v-for="tier in TIERS" :key="tier" :value="tier">
              {{ tier.charAt(0) + tier.slice(1).toLowerCase() }}
            </option>
          </select>
        </label>

        <div v-else class="field">
          <span class="muted field-label">Challenge</span>
          <input
            v-model="challengeSearch"
            class="league-input"
            placeholder="Search your challenges"
            @input="chosenChallenge = null"
          />
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
          <button
            class="league-button"
            :disabled="!canSave"
            @click="saveGoal"
          >
            Save
          </button>
          <button class="league-button ghost" @click="resetForm">Cancel</button>
        </div>
      </div>

      <p v-if="!outstanding.length && !achieved.length && !adding" class="muted">
        Nothing set yet. A goal turns a number into something to aim at.
      </p>

      <ul v-if="outstanding.length" class="goal-list">
        <li v-for="goal in outstanding" :key="goal.id">
          <div class="goal-head">
            <span class="goal-label">{{ goal.label }}</span>
            <button
              class="link remove"
              title="Remove this goal"
              @click="removeGoal(goal.id)"
            >
              Remove
            </button>
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
            <button class="link remove" @click="removeGoal(goal.id)">
              Remove
            </button>
          </div>
          <div class="muted goal-meta">
            Reached {{ formatRelativeDate(goal.achievedAt!) }}
          </div>
        </li>
      </ul>
    </section>

    <section v-if="records.length" class="card">
      <h2 class="section-title">Personal records</h2>
      <div class="records">
        <div v-for="record in records" :key="record.key" class="record">
          <div class="muted record-label">{{ record.label }}</div>
          <div class="numeric record-value">{{ formatRecord(record) }}</div>
          <div class="record-game">
            <img
              :src="championIconUrl(record.championId)"
              :alt="championName(record.championId)"
              class="portrait"
            />
            <span class="muted record-meta">
              {{ modeLabel(record.mode) }} ·
              {{ formatRelativeDate(record.playedAt) }}
            </span>
          </div>
        </div>
      </div>
    </section>
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
  gap: var(--space-5);
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

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.section-title.flush {
  margin: 0;
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
  color: var(--gold);
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

.change.up {
  color: var(--win);
}

.change.down {
  color: var(--loss);
}

.footnote {
  font-size: 11px;
  margin: 0;
}

.goal-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.kind-row {
  display: flex;
  gap: var(--space-1);
}

.chip {
  padding: var(--space-2) var(--space-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  position: relative;
  max-width: 420px;
}

.field-label {
  font-size: 10px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
}

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

.records {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-4);
}

.record {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.record-label {
  font-size: 10px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
}

.record-value {
  font-size: 24px;
  color: var(--gold-bright);
  margin: var(--space-1) 0 var(--space-2);
}

.record-game {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.portrait {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.record-meta {
  font-size: 11px;
}

.notice {
  padding: var(--space-5);
}
</style>
