<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import GradeBadge from "../components/GradeBadge.vue"
import { api } from "../helpers/api"
import { championIconUrl, championNameById, formatDecimal, formatPercent, gradeFromScore } from "../helpers/format"
import type { Champion } from "../types/lol"
import type { ChampionStatRow } from "../types/stats"
import type { LiveSession } from "../types/live"

const props = defineProps<{ champions: Champion[] | null }>()

const empty: LiveSession = {
  phase: "Idle", benchChampionIds: [], allies: [], enemies: [], updatedAt: 0,
}
const live = ref<LiveSession>(empty)
const stats = ref<ChampionStatRow[]>([])
const loading = ref(false)

async function loadStats() {
  if (!live.value.mode) {
    stats.value = []
    return
  }
  loading.value = true
  try {
    stats.value = await api.getChampionStats({ mode: live.value.mode })
  } catch {
    stats.value = []
  } finally {
    loading.value = false
  }
}

async function update(next: LiveSession) {
  const modeChanged = next.mode !== live.value.mode
  live.value = next
  if (modeChanged || stats.value.length === 0) await loadStats()
}

onMounted(async () => {
  await update(await api.getLiveSession())
  api.on("live:updated", (next: LiveSession) => void update(next))
})

const byChampion = computed(() => new Map(stats.value.map((row) => [row.championId, row])))
const localPlayer = computed(() => live.value.allies.find((row) => row.cellId === live.value.localPlayerCellId))
const localChampionId = computed(() => localPlayer.value?.championId || localPlayer.value?.championPickIntent || 0)
const available = computed(() => [...new Set([localChampionId.value, ...live.value.benchChampionIds].filter((id) => id > 0))])
const selectedChampionId = (player: LiveSession["allies"][number]) =>
  player.championId || player.championPickIntent || 0
const championName = (id: number) => championNameById(props.champions, id)
const stat = (id: number) => byChampion.value.get(id)
const confidence = (games: number) => games >= 12 ? "Solid" : games >= 5 ? "Fair" : "Thin"
const gradeFor = (row: ChampionStatRow | undefined) => gradeFromScore(row?.avgGradeScore)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ live.phase === 'InProgress' ? 'In game' : 'Live companion' }}</p>
        <h1>{{ live.phase === 'Idle' ? 'Live Game' : live.queueName ?? live.gameMode ?? 'League of Legends' }}</h1>
        <p class="muted subtitle" v-if="live.phase === 'ChampSelect'">
          Champion select{{ live.secondsRemaining !== undefined ? ` · ${live.secondsRemaining}s remaining` : '' }}
          <template v-if="live.rerollsRemaining !== undefined"> · {{ live.rerollsRemaining }} reroll{{ live.rerollsRemaining === 1 ? '' : 's' }}</template>
        </p>
        <p class="muted subtitle" v-else-if="live.phase === 'InProgress'">Locked roster and your personal champion history.</p>
      </div>
      <span class="phase" :class="live.phase.toLowerCase()">{{ live.phase === 'Idle' ? 'Waiting for game' : live.phase === 'InProgress' ? 'In game' : 'Champion select' }}</span>
    </header>

    <section v-if="live.phase === 'Idle'" class="card empty">
      <h2 class="section-title">Waiting for champion select</h2>
      <p class="muted">Recall will open this page once for your next game, without taking focus away from League.</p>
    </section>

    <template v-else>
      <section class="card roster">
        <div class="section-head"><h2 class="section-title">Lobby</h2><span class="muted">Live from the League client</span></div>
        <div class="teams">
          <div class="team"><h3>Your team</h3>
            <div v-for="player in live.allies" :key="player.cellId" class="player" :class="{ me: player.cellId === live.localPlayerCellId }">
              <img v-if="selectedChampionId(player)" :src="championIconUrl(selectedChampionId(player))" :alt="championName(selectedChampionId(player))" />
              <span v-else class="champion-placeholder" aria-label="Champion not selected">?</span>
              <span>{{ player.displayName ?? (player.cellId === live.localPlayerCellId ? 'You' : 'Teammate') }}</span>
              <span class="muted champ-name">{{ player.championId ? championName(player.championId) : player.championPickIntent ? championName(player.championPickIntent) : 'Waiting…' }}</span>
            </div>
          </div>
          <div class="team enemy"><h3>Opponents</h3>
            <div v-for="player in live.enemies" :key="player.cellId" class="player">
              <img v-if="selectedChampionId(player)" :src="championIconUrl(selectedChampionId(player))" :alt="championName(selectedChampionId(player))" />
              <span v-else class="champion-placeholder" aria-label="Champion not selected">?</span>
              <span>{{ player.displayName ?? 'Opponent' }}</span>
              <span class="muted champ-name">{{ player.championId ? championName(player.championId) : player.championPickIntent ? championName(player.championPickIntent) : 'Waiting…' }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="live.mode === 'aram' || live.mode === 'mayhem'" class="card choices">
        <div class="section-head"><div><h2 class="section-title">Your available champions</h2><p class="muted hint">Personal {{ live.mode === 'mayhem' ? 'ARAM: Mayhem' : 'ARAM' }} history only—never mixed between modes.</p></div><span v-if="loading" class="muted">Updating…</span></div>
        <div v-if="available.length" class="choice-grid">
          <article v-for="id in available" :key="id" class="choice" :class="{ current: id === localChampionId }">
            <img :src="championIconUrl(id)" :alt="championName(id)" class="portrait" />
            <div class="choice-title"><strong>{{ championName(id) }}</strong><span v-if="id === localChampionId" class="current-tag">Current</span></div>
            <template v-if="stat(id)">
              <strong class="winrate">{{ formatPercent(stat(id)!.winRate) }}</strong><span class="muted">{{ stat(id)!.wins }}–{{ stat(id)!.games - stat(id)!.wins }} · {{ stat(id)!.games }} games</span>
              <span class="muted">{{ formatDecimal(stat(id)!.kda, 2) }} KDA · {{ confidence(stat(id)!.games) }} confidence</span>
              <GradeBadge v-if="gradeFor(stat(id))" :grade="gradeFor(stat(id))" />
            </template>
            <p v-else class="muted no-data">No recorded games in this mode yet.</p>
          </article>
        </div>
        <p v-else class="muted empty-note">Waiting for your champion and bench options.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page { display:flex; flex-direction:column; gap:var(--space-4); }
.page-head,.section-head { display:flex; justify-content:space-between; gap:var(--space-3); align-items:flex-start; }
.eyebrow { margin:0 0 2px; font: 10px var(--font-heading); letter-spacing:1.4px; text-transform:uppercase; color:var(--gold); }
h1 { margin:0; font:22px var(--font-display); letter-spacing:1px; color:var(--gold-bright); }
.subtitle,.hint { margin:var(--space-1) 0 0; font-size:12px; }.hint{font-size:11px}
.phase { border:1px solid var(--border-strong); border-radius:999px; padding:5px 8px; font:10px var(--font-heading); letter-spacing:.8px; text-transform:uppercase; color:var(--text-secondary); white-space:nowrap; }
.phase.champselect{color:var(--gold);border-color:var(--gold)} .phase.inprogress{color:var(--win);border-color:var(--win)}
.empty { max-width:620px; }.empty p { margin-bottom:0; font-size:13px; }.section-title { margin:0; font:13px var(--font-heading); letter-spacing:1px; text-transform:uppercase; color:var(--text-primary); }
.roster,.choices { padding:var(--space-4); }.teams { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4); margin-top:var(--space-3); }.team h3{margin:0 0 var(--space-2);font:11px var(--font-heading);text-transform:uppercase;letter-spacing:1px;color:var(--win)}.enemy h3{color:var(--loss)}
.player { display:grid; grid-template-columns:30px minmax(0,1fr) auto; align-items:center; gap:var(--space-2); min-height:38px; padding:4px var(--space-2); border-bottom:1px solid var(--border-subtle); font-size:12px; }.player.me{background:var(--surface-3);border-left:2px solid var(--gold)}.player img,.champion-placeholder{width:28px;height:28px;border-radius:50%;border:1px solid var(--border-subtle)}.champion-placeholder{display:grid;place-items:center;background:var(--surface-3);color:var(--text-muted);font:14px var(--font-heading)}.champ-name{font-size:11px}
.choice-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:var(--space-3); margin-top:var(--space-3); }.choice { min-height:150px; display:grid; grid-template-columns:50px 1fr; grid-template-rows:auto auto auto; column-gap:var(--space-3); align-items:center; padding:var(--space-3); border:1px solid var(--border-subtle); background:var(--surface-2); border-radius:var(--radius-sm); font-size:11px; }.choice.current{border-color:var(--gold)}.portrait{width:50px;height:50px;border-radius:50%;grid-row:span 2;border:1px solid var(--border-strong)}.choice-title{display:flex;gap:var(--space-2);align-items:baseline}.choice strong{color:var(--text-primary)}.current-tag{font-size:9px;text-transform:uppercase;color:var(--gold)}.winrate{font-size:20px;color:var(--win)!important}.choice :deep(.grade){grid-column:2;justify-self:start;margin-top:var(--space-1)}.no-data{grid-column:1 / -1;margin:var(--space-2) 0 0}.empty-note{margin:var(--space-3) 0 0;font-size:12px}
@media(max-width:780px){.teams{grid-template-columns:1fr}.enemy{display:none}.choice-grid{grid-template-columns:1fr}.page-head{align-items:flex-start}}
</style>
