<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faMedal } from "@fortawesome/free-solid-svg-icons"
import GradeBadge from "./GradeBadge.vue"
import MatchDetail from "./MatchDetail.vue"
import StyleRadar from "./StyleRadar.vue"
import MiniBar from "./ui/MiniBar.vue"
import Panel from "./ui/Panel.vue"
import StatTile from "./ui/StatTile.vue"
import { api } from "../helpers/api"
import { labelIcon } from "../helpers/label-icons"
import { lobbyStandings } from "../helpers/match-detail"
import { positionForPlayer, positionIconUrl, positionLabel } from "../helpers/roles"
import { closeMatch } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type {
  MatchDetail as MatchDetailData,
  MatchRow,
  ParticipantRow,
  PerformanceLabel,
  StyleAxis,
} from "../types/stats"

const props = defineProps<{
  match: MatchRow
  champions: Champion[] | null
}>()

/** The metrics a single game is placed on within its own lobby. */
const METRICS: {
  key: string
  label: string
  of: (row: ParticipantRow) => number
}[] = [
  { key: "damage", label: "Damage dealt", of: (r) => r.damageToChampions },
  { key: "damageTaken", label: "Damage taken", of: (r) => r.damageTaken },
  { key: "gold", label: "Gold earned", of: (r) => r.goldEarned },
  { key: "kills", label: "Kill involvement", of: (r) => r.kills + r.assists },
  {
    key: "cs",
    label: "Creep score",
    of: (r) => r.totalMinionsKilled + r.neutralMinions,
  },
  { key: "vision", label: "Vision score", of: (r) => r.visionScore },
  { key: "objectives", label: "Objective damage", of: (r) => r.damageObjectives },
]

const gameAxes = ref<StyleAxis[]>([])
const careerAxes = ref<StyleAxis[] | undefined>(undefined)
const detail = ref<MatchDetailData | null>(null)
const loading = ref(true)

async function load(match: MatchRow) {
  loading.value = true
  try {
    const family = match.modeFamily
    const detailRequest = api.getMatchDetail(match.gameId)

    if (family === "other") {
      detail.value = await detailRequest
      gameAxes.value = []
      careerAxes.value = undefined
      return
    }

    const [axes, career, matchDetail] = await Promise.all([
      api.getMatchAxes(match.gameId, family),
      api.getStyleReport({ modeFamily: family }, family),
      detailRequest,
    ])

    gameAxes.value = axes.axes
    careerAxes.value = career.career?.axes
    detail.value = matchDetail
  } catch {
    gameAxes.value = []
    careerAxes.value = undefined
    detail.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.match, load, { immediate: true })

const champion = computed(() =>
  championNameById(props.champions, props.match.championId),
)

/**
 * Where the player finished among the ten, per metric.
 *
 * Players level with each other share the average of the places they span, so
 * a lobby where nobody warded does not hand one of them first place.
 */
const placings = computed(() => {
  const rows = detail.value?.participants ?? []
  const me = rows.find((row) => row.isPlayer === 1)
  if (!me || rows.length < 2) return []

  return METRICS.map((metric) => {
    const mine = metric.of(me)
    const better = rows.filter((row) => metric.of(row) > mine).length
    const level = rows.filter((row) => metric.of(row) === mine).length

    return {
      key: metric.key,
      label: metric.label,
      place: 1 + better + (level - 1) / 2,
      of: rows.length,
    }
  })
})

const kda = computed(() =>
  props.match.deaths === 0
    ? props.match.kills + props.match.assists
    : (props.match.kills + props.match.assists) / props.match.deaths,
)

// Lane-based modes assign positions; ARAM and Arena would report noise.
const position = computed(() =>
  props.match.modeFamily === "sr" || props.match.modeFamily === "classic"
    ? positionForPlayer(props.match)
    : undefined,
)

/** Where this game placed the player among the ten Recall graded. */
const standing = computed(() => {
  const rows = detail.value?.participants ?? []
  const me = rows.find((row) => row.isPlayer === 1)
  if (!me) return undefined
  return lobbyStandings(rows).get(me.participantId)
})

/**
 * MVP is decided in the renderer from the stored lobby grades, so it stays
 * consistent with the places shown on the scoreboard.
 */
const labels = computed<PerformanceLabel[]>(() => {
  const stored = detail.value?.labels ?? []
  const place = standing.value
  if (place?.place !== 1) return stored

  return [{
    id: "mvp",
    name: "MVP",
    category: "Lobby",
    polarity: "positive",
    tooltip: `Best Recall grade of the ${place.of} players in this lobby.`,
    evidence: { lobbyPlace: place.place, players: place.of },
    source: "match_v5",
    confidence: "exact",
    priority: 1_000,
  }, ...stored]
})

const evidenceOf = (label: PerformanceLabel) =>
  Object.entries(label.evidence).map(([key, value]) => `${key}: ${value}`).join(", ")
</script>

<template>
  <div class="backdrop" @click.self="closeMatch()">
    <div class="sheet card">
      <header class="sheet-head">
        <img :src="championIconUrl(match.championId)" :alt="champion" class="portrait" />

        <div class="identity">
          <h2 class="title">
            {{ champion }}
            <span class="outcome" :class="match.win ? 'win-text' : 'loss-text'">
              {{ match.win ? "Victory" : "Defeat" }}
            </span>
            <span v-if="standing?.place === 1" class="mvp-badge">
              <FontAwesomeIcon :icon="faMedal" aria-hidden="true" /> MVP
            </span>
          </h2>
          <p class="muted line">
            {{ match.queueName ?? modeLabel(match.mode) }} ·
            {{ formatDuration(match.durationSecs) }} ·
            {{ formatRelativeDate(match.playedAt) }}
          </p>
          <p v-if="position" class="muted line role-line">
            <img :src="positionIconUrl(position)" class="role-icon" alt="" />
            {{ positionLabel(position) }}
          </p>
        </div>

        <GradeBadge :grade="match.grade" size="lg" />
        <button class="close" title="Close" @click="closeMatch()">×</button>
      </header>

      <div class="kpis">
        <StatTile
          label="KDA"
          :value="`${match.kills}/${match.deaths}/${match.assists}`"
          :hint="`${formatDecimal(kda, 2)} ratio`"
          :tone="match.win ? 'win' : 'loss'"
        />
        <StatTile label="Damage" :value="formatCompact(match.damageToChampions)" />
        <StatTile label="Gold" :value="formatCompact(match.goldEarned)" />
        <StatTile
          label="Creep score"
          :value="(match.totalMinionsKilled + match.neutralMinions).toString()"
          :hint="`${formatDecimal(match.csPerMin ?? 0, 1)} per minute`"
        />
        <StatTile
          v-if="standing"
          label="Lobby place"
          :value="standing.place.toString()"
          :hint="`of ${standing.of} by Recall grade`"
        />
      </div>

      <section v-if="labels.length" class="labels" aria-label="Game labels">
        <h3 class="block-title">Game labels</h3>
        <div class="label-chips">
          <article
            v-for="label in labels"
            :key="label.id"
            class="game-label"
            :class="label.polarity"
            :title="`${label.tooltip} Evidence: ${evidenceOf(label)}`"
          >
            <span class="label-badge">
              <FontAwesomeIcon :icon="labelIcon(label.id)" aria-hidden="true" />
            </span>
            <span class="label-text">
              <span class="label-name">{{ label.name }}</span>
              <span class="label-tooltip">{{ label.tooltip }}</span>
            </span>
          </article>
        </div>
      </section>

      <div class="body">
        <Panel title="Playstyle stats" class="chart-side">
          <StyleRadar
            v-if="gameAxes.length"
            :axes="gameAxes"
            :recent="careerAxes"
            primary-label="This game"
            secondary-label="Your average"
          />
          <p v-else-if="!loading" class="muted note">
            {{
              match.modeFamily === "other"
                ? "Style scoring is available for Rift, League Classic and ARAM games."
                : "No scoreboard was recorded for this game, so it cannot be scored on its own."
            }}
          </p>
          <p v-if="gameAxes.length" class="muted footnote">
            Gold is this game. Blue is how you usually play this mode.
          </p>
        </Panel>

        <Panel title="Placed in this lobby" class="placing-side">
          <ul v-if="placings.length" class="placings">
            <li v-for="row in placings" :key="row.key">
              <span class="axis-label">{{ row.label }}</span>
              <MiniBar
                :value="(row.of - row.place) / (row.of - 1)"
                :strong="row.place <= 3"
              />
              <span class="numeric place">
                {{ row.place % 1 === 0 ? row.place : row.place.toFixed(1) }}
                <span class="muted">/ {{ row.of }}</span>
              </span>
            </li>
          </ul>

          <p v-else-if="!loading" class="muted note">
            The lobby for this game was not available from the League client or
            Riot API.
          </p>
        </Panel>
      </div>

      <MatchDetail
        :detail="detail"
        :loading="loading"
        :champions="champions"
        :classic="match.modeFamily === 'classic'"
      />
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 8, 18, 0.72);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-5);
  z-index: 50;
  overflow-y: auto;
}

.sheet {
  width: min(1100px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-5);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(200, 170, 109, 0.09), transparent 46%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.014), transparent 42%),
    var(--surface-0);
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.portrait {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
}

.identity {
  min-width: 0;
}

.title {
  font-family: var(--font-display);
  font-size: 19px;
  margin: 0;
  color: var(--gold-bright);
  letter-spacing: 0.6px;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.outcome {
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.mvp-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 1px var(--space-2);
  border: 1px solid var(--gold);
  border-radius: 999px;
  background: rgba(200, 170, 109, 0.16);
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 1.4px;
}

.line {
  margin: 2px 0 0;
  font-size: 12px;
}

.role-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.role-icon { width: 15px; height: 15px; opacity: .82; }

.close {
  margin-left: auto;
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.close:hover {
  color: var(--text-primary);
}


.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-3);
}

.labels {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label-chips {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 300px));
  justify-content: start;
  gap: var(--space-2);
}

.game-label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(200, 170, 110, 0.35);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  background:
    linear-gradient(120deg, rgba(200, 170, 110, 0.1), transparent 62%),
    var(--surface-2);
}

.game-label.positive { border-left-color: var(--win); }
.game-label.negative { border-left-color: var(--loss); }
.game-label.mixed { border-left-color: var(--gold-bright); }

.label-badge {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--surface-0);
  color: var(--gold);
  font-size: 18px;
}

.game-label.positive .label-badge { color: var(--win); }
.game-label.negative .label-badge { color: var(--loss); }

.label-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.label-name {
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 15px;
  letter-spacing: 0.4px;
  line-height: 1.2;
}

.label-tooltip {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.body {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.8fr);
  gap: var(--space-4);
  align-items: stretch;
}

.block-title {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0 0 var(--space-3);
}

.placings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.placings li {
  display: grid;
  grid-template-columns: 104px 1fr 54px;
  align-items: center;
  gap: var(--space-3);
  font-size: 12px;
}

.axis-label {
  color: var(--text-secondary);
}

.place {
  text-align: right;
  color: var(--text-primary);
}

.note,
.footnote {
  font-size: 11px;
  margin: var(--space-2) 0 0;
  line-height: 1.5;
}

.footnote {
  text-align: center;
}

@media (max-width: 980px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
