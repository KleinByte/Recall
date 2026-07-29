<script setup lang="ts">
import { computed, ref, watch } from "vue"
import GradeBadge from "./GradeBadge.vue"
import MatchDetail from "./MatchDetail.vue"
import StyleRadar from "./StyleRadar.vue"
import { api } from "../helpers/api"
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
          </h2>
          <p class="muted line">
            {{ match.queueName ?? modeLabel(match.mode) }} ·
            {{ formatDuration(match.durationSecs) }} ·
            {{ formatRelativeDate(match.playedAt) }}
          </p>
        </div>

        <GradeBadge :grade="match.grade" size="lg" />
        <button class="close" title="Close" @click="closeMatch()">×</button>
      </header>

      <div class="kpis">
        <div class="kpi">
          <span class="muted kpi-label">KDA</span>
          <span class="numeric kpi-value">
            {{ match.kills }}/{{ match.deaths }}/{{ match.assists }}
          </span>
          <span class="muted kpi-hint">{{ formatDecimal(kda, 2) }}</span>
        </div>
        <div class="kpi">
          <span class="muted kpi-label">Damage</span>
          <span class="numeric kpi-value">
            {{ formatCompact(match.damageToChampions) }}
          </span>
        </div>
        <div class="kpi">
          <span class="muted kpi-label">Gold</span>
          <span class="numeric kpi-value">
            {{ formatCompact(match.goldEarned) }}
          </span>
        </div>
        <div class="kpi">
          <span class="muted kpi-label">Creep score</span>
          <span class="numeric kpi-value">
            {{ match.totalMinionsKilled + match.neutralMinions }}
          </span>
        </div>
      </div>

      <div class="body">
        <div class="chart-side">
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
                ? "Style scoring is available for Rift and ARAM games."
                : "No scoreboard was recorded for this game, so it cannot be scored on its own."
            }}
          </p>
          <p v-if="gameAxes.length" class="muted footnote">
            Gold is this game. Blue is how you usually play this mode.
          </p>
        </div>

        <div class="placing-side">
          <h3 class="block-title">Placed in this lobby</h3>

          <ul v-if="placings.length" class="placings">
            <li v-for="row in placings" :key="row.key">
              <span class="axis-label">{{ row.label }}</span>
              <span class="track">
                <span
                  class="fill"
                  :class="{ strong: row.place <= 3 }"
                  :style="{
                    width: `${((row.of - row.place) / (row.of - 1)) * 100}%`,
                  }"
                />
              </span>
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
        </div>
      </div>

      <MatchDetail
        :detail="detail"
        :loading="loading"
        :champions="champions"
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
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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

.line {
  margin: 2px 0 0;
  font-size: 12px;
}

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

.kpi {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kpi-label {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.kpi-value {
  font-size: 17px;
  color: var(--text-primary);
}

.kpi-hint {
  font-size: 11px;
}

.body {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.8fr);
  gap: var(--space-5);
  align-items: center;
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
