<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import DriftChart from "../components/DriftChart.vue"
import GradeBadge from "../components/GradeBadge.vue"
import StyleRadar from "../components/StyleRadar.vue"
import MiniBar from "../components/ui/MiniBar.vue"
import Panel from "../components/ui/Panel.vue"
import StatTile from "../components/ui/StatTile.vue"
import { api } from "../helpers/api"
import { itemIconUrl } from "../helpers/ddragon"
import { openChampion } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatPercent,
  GRADE_ORDER,
  gradeFromScore,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type {
  ChampionRanking,
  GradeCount,
  InsightsReport,
  LobbyComparison,
  ModeFamily,
  StatsFilter,
  StatsSummary,
  StyleAxis,
  StyleReport,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

/**
 * Rift games are grouped together because style barely differs between ranked
 * and normal, while the Howling Abyss modes are judged on their own axes.
 */
const MODES: {
  id: string
  label: string
  family: ModeFamily
  filter: StatsFilter
}[] = [
  { id: "sr", label: "Summoner's Rift", family: "sr", filter: { modeFamily: "sr" } },
  { id: "aram", label: "ARAM", family: "aram", filter: { mode: "aram" } },
  { id: "mayhem", label: "Mayhem", family: "aram", filter: { mode: "mayhem" } },
]

/**
 * How many games each panel needs before it says anything.
 *
 * Below these a panel states what it is waiting for rather than drawing a
 * confident conclusion from three games.
 */
const MINIMUM = {
  duration: 10,
  time: 15,
  streaks: 10,
  drift: 20,
  contribution: 5,
  pool: 10,
  builds: 5,
}

/** Movement smaller than this is noise, not a trend. */
const TREND_THRESHOLD = 0.03

const selected = ref(MODES[0])
const counts = ref<Record<string, number>>({})
const report = ref<StyleReport>({})
const summary = ref<StatsSummary | null>(null)
const grades = ref<GradeCount[]>([])
const lobby = ref<LobbyComparison | undefined>(undefined)
const insights = ref<InsightsReport | null>(null)
const drift = ref<{ label: string; axes: StyleAxis[] }[]>([])
const ranking = ref<ChampionRanking | null>(null)
const loading = ref(true)

async function loadCounts() {
  const summaries = await Promise.all(
    MODES.map((mode) => api.getSummary(mode.filter)),
  )

  counts.value = Object.fromEntries(
    MODES.map((mode, index) => [mode.id, summaries[index].games]),
  )

  // Open on whichever mode actually has history behind it.
  const busiest = MODES.reduce((best, mode) =>
    counts.value[mode.id] > counts.value[best.id] ? mode : best,
  )
  if (counts.value[busiest.id] > 0) selected.value = busiest
}

async function load() {
  loading.value = true
  try {
    const mode = selected.value

    const [
      nextReport,
      nextSummary,
      nextGrades,
      nextLobby,
      nextInsights,
      nextDrift,
      nextRanking,
    ] = await Promise.all([
      api.getStyleReport(mode.filter, mode.family),
      api.getSummary(mode.filter),
      api.getGradeDistribution(mode.filter),
      api.getLobbyComparison(mode.filter),
      api.getInsights(mode.filter, mode.family),
      api.getDrift(mode.filter, mode.family),
      api.getRankedChampions(mode.filter),
    ])

    report.value = nextReport
    summary.value = nextSummary
    grades.value = nextGrades
    lobby.value = nextLobby
    insights.value = nextInsights
    drift.value = nextDrift
    ranking.value = nextRanking
  } catch (error) {
    console.warn("Could not load playstyle", error)
    report.value = {}
    summary.value = null
    grades.value = []
    lobby.value = undefined
    insights.value = null
    drift.value = []
    ranking.value = null
  } finally {
    loading.value = false
  }
}

async function selectMode(mode: (typeof MODES)[number]) {
  selected.value = mode
  await load()
}

onMounted(async () => {
  try {
    await loadCounts()
  } catch {
    // No account seen yet; the empty state covers this.
  }
  void load()
  api.on("stats:updated", () => void load())
  api.on("lcu:status", () => void load())
})

const career = computed(() => report.value.career)
const games = computed(() => summary.value?.games ?? 0)
const detail = computed(() => career.value?.detail)
const isRift = computed(() => selected.value.family === "sr")
const averageGrade = computed(() => gradeFromScore(summary.value?.avgGradeScore))

/** How many more games a panel is waiting for, or nothing if it is ready. */
const waitingFor = (minimum: number) =>
  games.value >= minimum ? 0 : minimum - games.value

/**
 * The recent overlay only means something once there is a "before" to compare
 * against. Below that it would just trace the career shape exactly.
 */
const recentAxes = computed(() =>
  report.value.earlier ? report.value.recent?.axes : undefined,
)

const ranked = computed(() =>
  [...(career.value?.axes ?? [])].sort((a, b) => b.value - a.value),
)

const strengths = computed(() => ranked.value.slice(0, 2))
const weaknesses = computed(() => ranked.value.slice(-2).reverse())

const trendByKey = computed(() => {
  const recent = report.value.recent
  const earlier = report.value.earlier
  if (!recent || !earlier) return {}

  return Object.fromEntries(
    recent.axes.map((axis) => {
      const before = earlier.axes.find((entry) => entry.key === axis.key)
      const delta = axis.value - (before?.value ?? 0)

      return [
        axis.key,
        {
          delta,
          direction:
            Math.abs(delta) < TREND_THRESHOLD
              ? "flat"
              : delta > 0
                ? "up"
                : "down",
        },
      ]
    }),
  )
})

const gradeBars = computed(() => {
  const byGrade = new Map(grades.value.map((entry) => [entry.grade, entry.count]))
  const highest = Math.max(1, ...grades.value.map((entry) => entry.count))

  return GRADE_ORDER.filter((grade) => byGrade.has(grade)).map((grade) => ({
    grade,
    count: byGrade.get(grade)!,
    share: (byGrade.get(grade)! / highest) * 100,
  }))
})

/** Bars are drawn against the busiest band, not against the whole history. */
const busiestBand = computed(() =>
  Math.max(1, ...(insights.value?.duration ?? []).map((row) => row.games)),
)

const busiestHour = computed(() =>
  Math.max(1, ...(insights.value?.hours ?? []).map((row) => row.games)),
)

const championName = (id: number) => championNameById(props.champions, id)

const confidenceLabel: Record<string, string> = {
  thin: "1–2 games",
  fair: "3–4 games",
  solid: "5+ games",
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Skill</h1>
        <p class="muted subtitle">
          How you play, drawn from every game Recall has recorded.
        </p>
      </div>

      <div class="mode-row">
        <button
          v-for="mode in MODES"
          :key="mode.id"
          class="league-button chip"
          :class="{ active: selected.id === mode.id }"
          @click="selectMode(mode)"
        >
          {{ mode.label }}
          <span v-if="counts[mode.id]" class="muted count">
            {{ counts[mode.id] }}
          </span>
        </button>
      </div>
    </header>

    <div v-if="!career && !loading" class="card notice">
      <h2 class="section-title">Nothing recorded for this mode yet</h2>
      <p class="muted">
        Play a game of {{ selected.label }} with Recall running and your shape
        will appear here. The client only ever hands over its last 20 games, so
        history before Recall was installed cannot be recovered.
      </p>
    </div>

    <template v-if="career">
      <section v-if="summary && detail" class="kpis">
        <StatTile
          label="Games"
          :value="summary.games.toString()"
          :hint="`${summary.wins}W · ${summary.losses}L`"
        />
        <StatTile
          label="Win rate"
          :value="formatPercent(summary.winRate)"
          :tone="summary.winRate >= 0.5 ? 'win' : 'loss'"
        />
        <StatTile
          label="Avg grade"
          :value="averageGrade ?? '–'"
          :hint="`${summary.gradedGames} graded`"
        />
        <StatTile
          label="KDA"
          :value="formatDecimal(summary.kda, 2)"
          :hint="`${formatDecimal(detail.avgDeaths, 1)} deaths per game`"
        />
        <StatTile
          label="Damage / min"
          :value="formatCompact(detail.damagePerMin)"
        />
        <StatTile label="Gold / min" :value="formatCompact(detail.goldPerMin)" />
        <StatTile label="CS / min" :value="formatDecimal(detail.csPerMin, 1)" />
        <StatTile
          v-if="isRift"
          label="Vision / min"
          :value="formatDecimal(detail.visionPerMin, 2)"
        />
      </section>

      <Panel title="Playstyle" :meta="`${career.games} games`">
        <div class="playstyle">
          <div class="chart-side">
            <StyleRadar :axes="career.axes" :recent="recentAxes" />
            <div class="legend">
              <span class="key career" />
              <span class="muted">All games</span>
              <template v-if="recentAxes">
                <span class="key recent" />
                <span class="muted">Last 10</span>
              </template>
            </div>
          </div>

          <div class="breakdown">
            <p class="reading">
              Your game leans on
              <strong>{{ strengths[0]?.label }}</strong> and
              <strong>{{ strengths[1]?.label }}</strong>. You do least with
              <strong>{{ weaknesses[0]?.label }}</strong> and
              <strong>{{ weaknesses[1]?.label }}</strong>.
            </p>

            <ul class="axis-list">
              <li v-for="axis in ranked" :key="axis.key" :title="axis.description">
                <span class="axis-label">{{ axis.label }}</span>
                <MiniBar :value="axis.value" />
                <span class="numeric axis-value">
                  {{ Math.round(axis.value * 100) }}%
                </span>
                <span
                  class="numeric trend-value"
                  :class="trendByKey[axis.key]?.direction ?? 'none'"
                >
                  <template v-if="trendByKey[axis.key]?.direction === 'up'">
                    ▲{{ Math.abs(Math.round(trendByKey[axis.key].delta * 100)) }}
                  </template>
                  <template v-else-if="trendByKey[axis.key]?.direction === 'down'">
                    ▼{{ Math.abs(Math.round(trendByKey[axis.key].delta * 100)) }}
                  </template>
                  <template v-else-if="trendByKey[axis.key]">—</template>
                </span>
              </li>
            </ul>

            <p class="muted footnote">
              Each spoke is a proportion of what you did in a game, averaged
              across them — how you play, not how well.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        v-if="lobby"
        title="Versus your lobbies"
        :meta="`${lobby.games} games with the full lobby`"
      >
        <div class="metric-grid">
          <div v-for="metric in lobby.metrics" :key="metric.key" class="metric">
            <div class="metric-head">
              <span class="muted metric-label">{{ metric.label }}</span>
              <span class="numeric metric-rank">
                {{ metric.averageRank.toFixed(1) }}<span class="muted">/10</span>
              </span>
            </div>
            <MiniBar :value="metric.percentile" :strong="metric.percentile >= 0.6" />
          </div>
        </div>
      </Panel>

      <section class="triple">
        <Panel title="Game length">
          <template v-if="!waitingFor(MINIMUM.duration) && insights">
            <ul class="row-list">
              <li v-for="band in insights.duration" :key="band.label">
                <span class="axis-label">{{ band.label }}</span>
                <MiniBar :value="band.games / busiestBand" />
                <span class="numeric small">
                  <template v-if="band.games">
                    {{ formatPercent(band.winRate) }}
                  </template>
                  <template v-else>–</template>
                </span>
                <span class="muted numeric small">{{ band.games }}</span>
              </li>
            </ul>
            <p class="muted footnote">Win rate and games in each band.</p>
          </template>
          <p v-else class="muted note">
            {{ waitingFor(MINIMUM.duration) }} more games needed.
          </p>
        </Panel>

        <Panel title="When you play well">
          <template v-if="!waitingFor(MINIMUM.time) && insights">
            <ul class="row-list">
              <li v-for="block in insights.hours" :key="block.label">
                <span class="axis-label">{{ block.label }}</span>
                <MiniBar :value="block.games / busiestHour" />
                <span class="numeric small">
                  <template v-if="block.games">
                    {{ formatPercent(block.winRate) }}
                  </template>
                  <template v-else>–</template>
                </span>
                <span class="muted numeric small">{{ block.games }}</span>
              </li>
            </ul>
          </template>
          <p v-else class="muted note">
            {{ waitingFor(MINIMUM.time) }} more games needed.
          </p>
        </Panel>

        <Panel title="After a win or a loss">
          <template v-if="!waitingFor(MINIMUM.streaks) && insights?.streaks">
            <ul class="row-list wide">
              <li v-for="row in [insights.streaks.afterWin, insights.streaks.afterLoss]" :key="row.label">
                <span class="axis-label">{{ row.label }}</span>
                <MiniBar :value="row.winRate" :strong="row.winRate >= 0.5" />
                <span class="numeric small">{{ formatPercent(row.winRate) }}</span>
                <span class="muted numeric small">{{ row.games }}</span>
              </li>
            </ul>
            <p class="muted footnote">
              Win rate in the game that followed, and how many there were.
            </p>
          </template>
          <p v-else class="muted note">
            {{ waitingFor(MINIMUM.streaks) }} more games needed.
          </p>
        </Panel>
      </section>

      <section class="triple">
        <Panel title="Playstyle drift">
          <template v-if="!waitingFor(MINIMUM.drift) && drift.length > 1">
            <DriftChart :windows="drift" />
          </template>
          <p v-else class="muted note">
            {{ waitingFor(MINIMUM.drift) || "A few" }} more games needed to show
            movement over time.
          </p>
        </Panel>

        <Panel title="Share of your team">
          <template v-if="insights?.contribution">
            <ul class="row-list wide">
              <li>
                <span class="axis-label">Damage</span>
                <MiniBar :value="insights.contribution.damageShare" />
                <span class="numeric small">
                  {{ formatPercent(insights.contribution.damageShare) }}
                </span>
              </li>
              <li>
                <span class="axis-label">Gold</span>
                <MiniBar :value="insights.contribution.goldShare" />
                <span class="numeric small">
                  {{ formatPercent(insights.contribution.goldShare) }}
                </span>
              </li>
              <li>
                <span class="axis-label">Kills</span>
                <MiniBar :value="insights.contribution.killShare" />
                <span class="numeric small">
                  {{ formatPercent(insights.contribution.killShare) }}
                </span>
              </li>
            </ul>
            <p class="muted footnote">
              Out of your own five, across
              {{ insights.contribution.games }} games with a recorded lobby. An
              even split is 20%.
            </p>
          </template>
          <p v-else class="muted note">
            No lobbies recorded yet. Recall captures one for each game while it
            is still among the client's last twenty.
          </p>
        </Panel>

        <Panel title="Champion pool">
          <template v-if="!waitingFor(MINIMUM.pool) && insights?.pool">
            <div class="pool">
              <div class="pool-figure">
                <span class="numeric big">{{ insights.pool.champions }}</span>
                <span class="muted">champions</span>
              </div>
              <ul class="row-list wide">
                <li>
                  <span class="axis-label">Top five</span>
                  <MiniBar :value="insights.pool.coreShare" />
                  <span class="numeric small">
                    {{ formatPercent(insights.pool.coreShare) }}
                  </span>
                </li>
              </ul>
              <p class="muted footnote">
                {{ formatPercent(insights.pool.coreWinRate) }} on your five most
                played, {{ formatPercent(insights.pool.restWinRate) }} on the
                rest.
              </p>
            </div>
          </template>
          <p v-else class="muted note">
            {{ waitingFor(MINIMUM.pool) }} more games needed.
          </p>
        </Panel>
      </section>

      <section class="triple">
        <Panel title="Most built items">
          <template v-if="!waitingFor(MINIMUM.builds) && insights?.builds.length">
            <ul class="item-list">
              <li v-for="item in insights.builds" :key="item.itemId">
                <img
                  v-if="itemIconUrl(item.itemId)"
                  :src="itemIconUrl(item.itemId)"
                  class="item"
                  alt=""
                />
                <span class="muted numeric small">{{ item.games }}×</span>
                <span class="numeric small">{{ formatPercent(item.winRate) }}</span>
              </li>
            </ul>
            <p class="muted footnote">
              What you finished games holding. The client does not report the
              order things were bought in.
            </p>
          </template>
          <p v-else class="muted note">
            No builds recorded yet — these come from the stored lobby.
          </p>
        </Panel>

        <Panel v-if="gradeBars.length" :title="`Grades · average ${averageGrade ?? '–'}`">
          <div class="grades">
            <div v-for="bar in gradeBars" :key="bar.grade" class="grade-row">
              <GradeBadge :grade="bar.grade" />
              <MiniBar :value="bar.share / 100" />
              <span class="muted numeric small">{{ bar.count }}</span>
            </div>
          </div>
        </Panel>

        <Panel v-if="detail" title="Combat">
          <ul class="stat-rows">
            <li>
              <span class="muted">Longest spree, per game</span>
              <span class="numeric">
                {{ formatDecimal(detail.avgLargestSpree, 1) }}
              </span>
            </li>
            <li>
              <span class="muted">Double kills</span>
              <span class="numeric">{{ detail.doubleKills }}</span>
            </li>
            <li>
              <span class="muted">Triple kills</span>
              <span class="numeric">{{ detail.tripleKills }}</span>
            </li>
            <li>
              <span class="muted">Quadra kills</span>
              <span class="numeric">{{ detail.quadraKills }}</span>
            </li>
            <li>
              <span class="muted">Pentakills</span>
              <span class="numeric">{{ detail.pentaKills }}</span>
            </li>
          </ul>
        </Panel>
      </section>

      <Panel
        v-if="ranking?.best.length"
        title="Champions"
        meta="Ranked by grade, weighted by how much you have played them"
      >
        <div class="champion-columns">
          <div>
            <h3 class="column-title">You play best</h3>
            <ul class="champion-list">
              <li
                v-for="row in ranking.best"
                :key="row.championId"
                class="champion"
                @click="openChampion(row.championId)"
              >
                <img
                  :src="championIconUrl(row.championId)"
                  :alt="championName(row.championId)"
                  class="portrait"
                />
                <span class="champion-name">
                  {{ championName(row.championId) }}
                </span>
                <span class="muted numeric small">
                  {{ confidenceLabel[row.confidence] }}
                </span>
                <GradeBadge :grade="gradeFromScore(row.adjustedGrade)" />
              </li>
            </ul>
          </div>

          <div v-if="ranking.worst.length">
            <h3 class="column-title">To work on</h3>
            <ul class="champion-list">
              <li
                v-for="row in ranking.worst"
                :key="row.championId"
                class="champion"
                @click="openChampion(row.championId)"
              >
                <img
                  :src="championIconUrl(row.championId)"
                  :alt="championName(row.championId)"
                  class="portrait"
                />
                <span class="champion-name">
                  {{ championName(row.championId) }}
                </span>
                <span class="muted numeric small">
                  {{ confidenceLabel[row.confidence] }}
                </span>
                <GradeBadge :grade="gradeFromScore(row.adjustedGrade)" />
              </li>
            </ul>
          </div>
        </div>
      </Panel>
    </template>
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

.mode-row {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.chip {
  padding: var(--space-2) var(--space-3);
}

.count {
  margin-left: var(--space-2);
  font-size: 11px;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  gap: var(--space-3);
}

/* The chart carries the page, so it takes the larger share of the row. */
.playstyle {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.7fr);
  gap: var(--space-5);
  align-items: center;
}

.breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.legend {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  justify-content: center;
  margin-top: var(--space-2);
}

.key {
  width: 12px;
  height: 2px;
  border-radius: 1px;
}

.key.career {
  background: var(--gold);
}

.key.recent {
  background: var(--win);
  margin-left: var(--space-3);
}

.footnote,
.note {
  font-size: 11px;
  margin: var(--space-2) 0 0;
  line-height: 1.5;
}

.note {
  margin: 0;
}

.reading {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
}

.reading strong {
  color: var(--gold);
  font-weight: 500;
}

.axis-list,
.row-list,
.champion-list,
.stat-rows,
.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.axis-list li {
  display: grid;
  grid-template-columns: 88px 1fr 38px 36px;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}

.row-list li {
  display: grid;
  grid-template-columns: 84px 1fr 38px 26px;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}

.row-list.wide li {
  grid-template-columns: 84px 1fr 40px;
}

.axis-label {
  color: var(--text-secondary);
}

.axis-value,
.small {
  text-align: right;
}

.axis-value {
  color: var(--text-primary);
  font-size: 12px;
}

.small {
  font-size: 11px;
}

.trend-value {
  text-align: right;
  font-size: 11px;
  color: var(--text-muted);
}

.trend-value.up {
  color: var(--win);
}

.trend-value.down {
  color: var(--loss);
}

/* Short bars in a grid read better than one stretched across a monitor. */
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-3) var(--space-4);
}

.metric-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.metric-label {
  font-size: 11px;
}

.metric-rank {
  font-size: 12px;
  color: var(--text-primary);
}

.triple {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-4);
  align-items: start;
}

.grades {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.grade-row {
  display: grid;
  grid-template-columns: 38px 1fr 26px;
  align-items: center;
  gap: var(--space-2);
}

.stat-rows li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  font-size: 12px;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.stat-rows li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.item-list {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.item-list li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.item {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.pool-figure {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  font-size: 12px;
}

.big {
  font-size: 26px;
  color: var(--gold-bright);
}

.champion-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-5);
}

.column-title {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0 0 var(--space-3);
}

.champion {
  display: grid;
  grid-template-columns: 26px 1fr auto auto;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 2px;
}

.champion:hover {
  background: var(--surface-2);
}

.champion:hover .champion-name {
  color: var(--gold);
}

.portrait {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.champion-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice {
  padding: var(--space-5);
}

@media (max-width: 1180px) {
  .playstyle {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
