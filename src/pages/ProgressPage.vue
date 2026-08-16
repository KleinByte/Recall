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
import { selectIncompleteChallenges } from "../helpers/challenges"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import { reviewMatch } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatRecordValue,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"
import {
  isRecognizedRankedQueue,
  rankedQueueLabel,
} from "../helpers/ranked-queues"
import type { Champion } from "../types/lol"
import type {
  ChallengeRow,
  Goal,
  LifetimeTotals,
  PersonalRecord,
  RankedHistory,
  StatsFilter,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()
const events = useApiEvents()

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
const lifetime = ref<LifetimeTotals | null>(null)
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
    const [nextRanked, nextGoals, nextChallenges, nextLifetime] =
      await Promise.all([
        api.getRankedHistory(),
        api.listGoals(),
        api.listChallenges({ includeRetired: false }),
        api.getLifetimeTotals(),
        loadRecords(),
      ])

    ranked.value = nextRanked
    goals.value = nextGoals
    challenges.value = nextChallenges
    lifetime.value = nextLifetime
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
    .filter((entry) => isRecognizedRankedQueue(entry.queue) && entry.points.length > 0)
    .map((entry) => ({
      ...entry,
      label: rankedQueueLabel(entry.queue),
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

  return selectIncompleteChallenges(challenges.value)
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

function formatLifetimeDuration(totalSeconds: number) {
  const totalMinutes = Math.floor(Math.max(0, totalSeconds) / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${formatCompact(days)}d ${hours}h` : `${formatCompact(days)}d`
  if (totalHours > 0) return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`
  return `${minutes}m`
}

const playerLifetimeGroups = computed(() => {
  const totals = lifetime.value
  if (!totals) return []
  const detailCoverage = totals.recordedGames
    ? `${formatCompact(totals.detailContext.measuredGames)} of ${formatCompact(totals.recordedGames)} games have detailed scoreboards`
    : "No detailed scoreboards yet"
  return [
    {
      key: "combat",
      kicker: "Combat",
      title: "Fighting and durability",
      description: "Your credited combat totals from every stored match.",
      metrics: [
        { label: "Champion takedowns", value: formatCompact(totals.championTakedowns), hint: "Kills + assists" },
        { label: "Kills", value: formatCompact(totals.kills) },
        { label: "Deaths", value: formatCompact(totals.deaths) },
        { label: "Assists", value: formatCompact(totals.assists) },
        { label: "Largest killing spree", value: formatCompact(totals.largestKillingSpree), hint: "Best single match" },
        { label: "Largest multikill", value: formatCompact(totals.largestMultiKill), hint: "Best single fight" },
        { label: "Double kills", value: formatCompact(totals.doubleKills) },
        { label: "Triple kills", value: formatCompact(totals.tripleKills) },
        { label: "Quadra kills", value: formatCompact(totals.quadraKills) },
        { label: "Pentakills", value: formatCompact(totals.pentaKills) },
        { label: "Champion damage dealt", value: formatCompact(totals.damageToChampions) },
        { label: "Damage taken", value: formatCompact(totals.damageTaken) },
        { label: "Damage mitigated", value: formatCompact(totals.damageSelfMitigated) },
        { label: "Total healing", value: formatCompact(totals.totalHeal), hint: "Self and allied healing" },
        { label: "Units healed", value: formatCompact(totals.totalUnitsHealed) },
        { label: "Crowd control time", value: formatLifetimeDuration(totals.crowdControlSecs) },
        { label: "Surrenders", value: formatCompact(totals.surrenders) },
        { label: "Early surrenders", value: formatCompact(totals.earlySurrenders) },
      ],
    },
    {
      key: "economy",
      kicker: "Economy and vision",
      title: "Resources gathered",
      description: `Farm, gold, and vision work. ${detailCoverage}.`,
      metrics: [
        { label: "Recorded CS", value: formatCompact(totals.totalCs), hint: "Lane minions plus measured monsters" },
        { label: "Neutral monsters", value: formatCompact(totals.detailContext.neutralMinions), hint: "Detailed games" },
        { label: "Gold earned", value: formatCompact(totals.goldEarned) },
        { label: "Gold spent", value: formatCompact(totals.detailContext.goldSpent), hint: "Detailed games" },
        { label: "Vision score", value: formatCompact(totals.visionScore) },
        { label: "Wards placed", value: formatCompact(totals.wardsPlaced) },
        { label: "Wards cleared", value: formatCompact(totals.wardsKilled) },
        { label: "Control wards bought", value: formatCompact(totals.controlWards) },
      ],
    },
    {
      key: "detail",
      kicker: "Detailed scoreboards",
      title: "Additional combat totals",
      description: `${detailCoverage}. These values exclude games without detailed owner data.`,
      metrics: [
        { label: "All damage dealt", value: formatCompact(totals.detailContext.totalDamageDealt), hint: "Champions, units, and objectives" },
        { label: "Magic champion damage", value: formatCompact(totals.detailContext.magicDamageToChampions) },
        { label: "Physical champion damage", value: formatCompact(totals.detailContext.physicalDamageToChampions) },
        { label: "True champion damage", value: formatCompact(totals.detailContext.trueDamageToChampions) },
        { label: "Healing to teammates", value: formatCompact(totals.detailContext.teammateHealing) },
        { label: "Shields to teammates", value: formatCompact(totals.detailContext.teammateShielding) },
        { label: "Longest life", value: formatLifetimeDuration(totals.detailContext.longestLifeSecs), hint: "Best single match" },
      ],
    },
    {
      key: "objectives",
      kicker: "Objectives and structures",
      title: "Your direct contribution",
      description: `Damage and finishing credit attributed directly to you. ${detailCoverage}.`,
      metrics: [
        { label: "Neutral objective damage", value: formatCompact(totals.neutralObjectiveDamage), hint: "Excludes structures" },
        { label: "Structure damage", value: formatCompact(totals.structureDamage), hint: "Damage to turrets" },
        { label: "Turret kills", value: formatCompact(totals.turretKills), hint: "Scoreboard credit" },
        { label: "Inhibitor kills", value: formatCompact(totals.inhibitorKills), hint: "Scoreboard credit" },
        { label: "First bloods", value: formatCompact(totals.firstBloods) },
      ],
    },
  ]
})

const teamLifetimeMetrics = computed(() => {
  const totals = lifetime.value?.teamContext
  if (!totals || totals.measuredGames === 0) return []
  return [
    { label: "Dragons", value: formatCompact(totals.dragons) },
    { label: "Barons", value: formatCompact(totals.barons) },
    { label: "Heralds", value: formatCompact(totals.heralds) },
    { label: "Void grubs", value: formatCompact(totals.voidGrubs) },
    { label: "Turrets", value: formatCompact(totals.turrets) },
    { label: "Inhibitors", value: formatCompact(totals.inhibitors) },
  ]
})

const teamContextCoverage = computed(() => {
  const totals = lifetime.value
  if (!totals?.recordedGames) return "0% coverage"
  return `${Math.round(totals.teamContext.measuredGames / totals.recordedGames * 100)}% coverage`
})

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

    <Panel
      v-if="lifetime"
      title="Lifetime totals"
      meta="All recorded modes"
      class="lifetime-panel"
    >
      <EmptyState
        v-if="lifetime.recordedGames === 0"
        compact
        title="No completed games yet"
        description="Lifetime totals begin with the first completed matched game Recall stores."
      />

      <div v-else class="lifetime-board">
        <section class="lifetime-hero" aria-label="Recorded match archive">
          <div class="archive-anchor">
            <span class="archive-kicker">Complete match archive</span>
            <strong class="numeric archive-total">{{ formatCompact(lifetime.recordedGames) }}</strong>
            <span class="archive-unit">games stored</span>
          </div>
          <dl class="archive-summary">
            <div>
              <dt>Wins</dt>
              <dd class="numeric positive">{{ formatCompact(lifetime.wins) }}</dd>
              <span>Completed-match wins</span>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd class="numeric">{{ Math.round(lifetime.winRate * 100) }}%</dd>
              <span>Across the archive</span>
            </div>
            <div>
              <dt>Time played</dt>
              <dd class="numeric">{{ formatLifetimeDuration(lifetime.timePlayedSecs) }}</dd>
              <span>Completed matches</span>
            </div>
          </dl>
        </section>

        <details class="lifetime-details">
          <summary>
            <span>
              <strong>All lifetime totals</strong>
              <small>Combat, farming, vision, and objectives</small>
            </span>
            <span class="details-action">
              <span class="show-copy">Show all</span>
              <span class="hide-copy">Hide</span>
              <span class="details-chevron" aria-hidden="true" />
            </span>
          </summary>

          <div class="lifetime-detail-body">
            <section
              v-for="group in playerLifetimeGroups"
              :key="group.key"
              class="lifetime-row player-row"
              :aria-labelledby="`player-totals-${group.key}`"
            >
              <header class="lifetime-row-label">
                <span class="archive-kicker">{{ group.kicker }}</span>
                <strong :id="`player-totals-${group.key}`">{{ group.title }}</strong>
                <small>{{ group.description }}</small>
              </header>
              <dl class="lifetime-readings player-readings" :class="`${group.key}-readings`">
                <div v-for="metric in group.metrics" :key="metric.label">
                  <dt>{{ metric.label }}</dt>
                  <dd class="numeric">{{ metric.value }}</dd>
                  <span v-if="metric.hint">{{ metric.hint }}</span>
                </div>
              </dl>
            </section>

            <section class="lifetime-row team-row" aria-labelledby="team-totals-title">
              <header class="lifetime-row-label">
                <span class="archive-kicker team-kicker">Team context</span>
                <strong id="team-totals-title">Objectives secured</strong>
                <small v-if="lifetime.teamContext.measuredGames">
                  {{ formatCompact(lifetime.teamContext.measuredGames) }} games · {{ teamContextCoverage }} · not individual credit.
                </small>
                <small v-else>No stored team scoreboard is available yet.</small>
              </header>
              <dl v-if="teamLifetimeMetrics.length" class="lifetime-readings team-readings">
                <div v-for="metric in teamLifetimeMetrics" :key="metric.label">
                  <dt>{{ metric.label }}</dt>
                  <dd class="numeric">{{ metric.value }}</dd>
                </div>
              </dl>
              <div v-else class="team-unavailable muted">
                Team objective totals appear when Recall stores the owner's full team scoreboard.
              </div>
            </section>
          </div>
        </details>
      </div>
    </Panel>

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

.lifetime-board {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
  box-shadow: var(--ui-shadow-inset);
}

.lifetime-hero {
  display: grid;
  grid-template-columns: minmax(180px, .7fr) minmax(0, 1.3fr);
  min-width: 0;
}

.archive-anchor {
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 12px 14px;
  border-right: 1px solid var(--ui-divider);
  background: linear-gradient(120deg, color-mix(in srgb, var(--ui-accent) 8%, transparent), transparent 68%);
}

.archive-kicker {
  color: var(--ui-text-muted);
  font: var(--ui-text-label) var(--ui-font-heading);
  letter-spacing: 1px;
  text-transform: uppercase;
}

.archive-total {
  margin-top: 2px;
  color: var(--ui-accent-strong);
  font-size: clamp(25px, 4cqi, 34px);
  line-height: 1;
}

.archive-unit {
  margin-top: 3px;
  color: var(--ui-text-subtle);
  font-size: 11px;
}

.archive-summary,
.lifetime-readings {
  display: grid;
  min-width: 0;
  margin: 0;
}

.archive-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.archive-summary > div,
.lifetime-readings > div {
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 9px 11px;
}

.archive-summary > div + div,
.lifetime-readings > div + div { border-left: 1px solid var(--ui-divider); }

.archive-summary dt,
.lifetime-readings dt {
  overflow: hidden;
  color: var(--ui-text-muted);
  font: var(--ui-text-label) var(--ui-font-heading);
  letter-spacing: .7px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.archive-summary dd,
.lifetime-readings dd {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--ui-text);
  font-size: 18px;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-summary dd.positive { color: var(--ui-positive); }

.archive-summary span,
.lifetime-readings span {
  overflow: hidden;
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lifetime-details {
  border-top: 1px solid var(--ui-divider);
}

.lifetime-details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 54px;
  gap: var(--ui-space-3);
  padding: 9px 12px;
  color: var(--ui-text);
  cursor: pointer;
  list-style: none;
}

.lifetime-details > summary::-webkit-details-marker { display: none; }
.lifetime-details > summary:hover { background: var(--ui-surface-hover-subtle); }
.lifetime-details > summary:focus-visible { outline: 2px solid var(--ui-live); outline-offset: -2px; }
.lifetime-details > summary > span:first-child { display: grid; min-width: 0; }
.lifetime-details > summary strong { font: 12px var(--ui-font-heading); letter-spacing: .45px; text-transform: uppercase; }
.lifetime-details > summary small { margin-top: 2px; color: var(--ui-text-muted); font-size: var(--ui-text-label); }

.details-action {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
  color: var(--ui-accent-strong);
  font-size: var(--ui-text-label);
  font-weight: 600;
  text-transform: uppercase;
}

.hide-copy { display: none; }
.lifetime-details[open] .show-copy { display: none; }
.lifetime-details[open] .hide-copy { display: inline; }
.details-chevron { width: 8px; height: 8px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: translateY(-2px) rotate(45deg); transition: transform .16s ease; }
.lifetime-details[open] .details-chevron { transform: translateY(2px) rotate(225deg); }
.lifetime-detail-body { border-top: 1px solid var(--ui-divider); }

.lifetime-row {
  display: grid;
  grid-template-columns: minmax(170px, 210px) minmax(0, 1fr);
  min-width: 0;
  border-top: 1px solid var(--ui-divider);
}

.lifetime-row-label {
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 10px 12px;
  border-right: 1px solid var(--ui-divider);
  background: var(--ui-surface-hover-subtle);
}

.lifetime-row-label strong {
  margin-top: 2px;
  color: var(--ui-text-heading);
  font: 12px var(--ui-font-heading);
  letter-spacing: .45px;
  text-transform: uppercase;
}

.lifetime-row-label small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.35;
}

.player-readings { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.player-readings > div { border-top: 1px solid var(--ui-divider); border-left: 1px solid var(--ui-divider); }
.player-readings > div:nth-child(-n + 5) { border-top: 0; }
.player-readings > div:nth-child(5n + 1) { border-left: 0; }
.team-readings { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.team-kicker { color: var(--ui-live); }

.team-unavailable {
  display: grid;
  place-items: center start;
  min-height: 54px;
  padding: 10px 12px;
  font-size: 11px;
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
.record-categories strong { color: var(--ui-text-muted); font-size: var(--ui-text-label); }

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

.record-kicker { color: var(--ui-text-muted); font-size: var(--ui-text-label); letter-spacing: .8px; text-transform: uppercase; }
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
.record-copy small { overflow: hidden; margin-top: 2px; color: var(--ui-text-muted); font-size: var(--ui-text-label); text-overflow: ellipsis; white-space: nowrap; }
.record-value { color: var(--ui-accent-strong); font: 18px var(--ui-font-numeric); white-space: nowrap; }
.record-open { color: var(--ui-live); opacity: .65; }

.portrait {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

@container recall-content (max-width: 720px) {
  .lifetime-row { grid-template-columns: minmax(0, 1fr); }
  .lifetime-row-label { border-right: 0; border-bottom: 1px solid var(--ui-divider); }
  .player-readings { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .player-readings > div:nth-child(n) { border-top: 1px solid var(--ui-divider); border-left: 1px solid var(--ui-divider); }
  .player-readings > div:nth-child(-n + 3) { border-top: 0; }
  .player-readings > div:nth-child(3n + 1) { border-left: 0; }
  .team-readings { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .team-readings > div:nth-child(4) { border-left: 0; }
  .team-readings > div:nth-child(n + 4) { border-top: 1px solid var(--ui-divider); }
  .records-card :deep(.head) { align-items: flex-start; flex-direction: column; }
  .record-scope-field { width: 100%; }
  .record-browser { grid-template-columns: minmax(0, 1fr); }
  .record-categories { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
  .queue-head { gap: var(--ui-space-3); }
}

@container recall-content (max-width: 480px) {
  .lifetime-hero { grid-template-columns: minmax(0, 1fr); }
  .archive-anchor { border-right: 0; border-bottom: 1px solid var(--ui-divider); }
  .archive-summary > div { padding-inline: 8px; }
  .archive-summary dd, .lifetime-readings dd { font-size: 16px; }
  .lifetime-readings dt,
  .lifetime-readings span { overflow: visible; text-overflow: clip; white-space: normal; }
  .player-readings, .team-readings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .player-readings > div:nth-child(n), .team-readings > div:nth-child(n) { border-top: 0; border-left: 1px solid var(--ui-divider); }
  .player-readings > div:nth-child(odd), .team-readings > div:nth-child(odd) { border-left: 0; }
  .player-readings > div:nth-child(n + 3), .team-readings > div:nth-child(n + 3) { border-top: 1px solid var(--ui-divider); }
  .queue-head { flex-direction: column; }
  .queue-meta { text-align: left; }
  .kind-tabs { width: 100%; }
  .form-actions :deep(.ui-button) { flex: 1; }
  .record-row { grid-template-columns: 30px minmax(0, 1fr) auto; }
  .record-open { display: none; }
  .record-value { font-size: 15px; }
}

@media (prefers-reduced-motion: reduce) {
  .details-chevron { transition: none; }
}
</style>
