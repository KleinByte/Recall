<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { api } from "../helpers/api"
import { championIconUrl, championNameById, formatDecimal, formatPercent } from "../helpers/format"
import type { Champion } from "../types/lol"
import type { LiveSession } from "../types/live"
import type {
  ChampionChoice,
  ChampionChoiceObjective,
} from "../types/review"

const props = defineProps<{ champions: Champion[] | null }>()

const empty: LiveSession = {
  phase: "Idle", benchChampionIds: [], allies: [], enemies: [], updatedAt: 0,
}
const live = ref<LiveSession>(empty)
const recommendations = ref<ChampionChoice[]>([])
const loading = ref(false)
const objective = ref<ChampionChoiceObjective>("best_overall")

async function loadRecommendations() {
  if (!live.value.mode || available.value.length === 0) {
    recommendations.value = []
    return
  }
  loading.value = true
  try {
    recommendations.value = await api.getChampionRecommendations(
      available.value,
      live.value.mode,
      objective.value,
    )
  } catch {
    recommendations.value = []
  } finally {
    loading.value = false
  }
}

async function update(next: LiveSession) {
  const modeChanged = next.mode !== live.value.mode
  live.value = next
  if (modeChanged || recommendations.value.length === 0) {
    await loadRecommendations()
  }
}

onMounted(async () => {
  const stored = await api.getSetting<ChampionChoiceObjective>("recommendation-objective")
  if (stored) objective.value = stored
  await update(await api.getLiveSession())
  api.on("live:updated", (next: LiveSession) => void update(next))
})

const byChampion = computed(() =>
  new Map(recommendations.value.map((row) => [row.championId, row])),
)
const localPlayer = computed(() => live.value.allies.find((row) => row.cellId === live.value.localPlayerCellId))
const localChampionId = computed(() => localPlayer.value?.championId || localPlayer.value?.championPickIntent || 0)
const available = computed(() => [...new Set([localChampionId.value, ...live.value.benchChampionIds].filter((id) => id > 0))])
const selectedChampionId = (player: LiveSession["allies"][number]) =>
  player.championId || player.championPickIntent || 0
const championName = (id: number) => championNameById(props.champions, id)
const stat = (id: number) => byChampion.value.get(id)
async function changeObjective() {
  api.setSetting("recommendation-objective", objective.value)
  await loadRecommendations()
}
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
        <div class="section-head"><div><h2 class="section-title">Your available champions</h2><p class="muted hint">Confidence-aware recommendations from your {{ live.mode === 'mayhem' ? 'ARAM: Mayhem' : 'ARAM' }} history only.</p></div>
          <div class="objective-row">
            <label class="muted" for="choice-objective">Optimize for</label>
            <select id="choice-objective" v-model="objective" class="league-select" @change="changeObjective">
              <option value="best_overall">Best Overall</option>
              <option value="recent_form">Recent Form</option>
              <option value="challenges">Challenges</option>
              <option value="practice">Practice</option>
              <option value="most_reliable">Most Reliable</option>
            </select>
            <span v-if="loading" class="muted">Updating…</span>
          </div>
        </div>
        <div v-if="available.length" class="choice-grid">
          <article v-for="id in available" :key="id" class="choice" :class="{ current: id === localChampionId }">
            <img :src="championIconUrl(id)" :alt="championName(id)" class="portrait" />
            <div class="choice-title"><strong>{{ championName(id) }}</strong><span v-if="id === localChampionId" class="current-tag">Current</span></div>
            <template v-if="stat(id)">
              <strong class="winrate">#{{ stat(id)!.rank }} · {{ Math.round(stat(id)!.score) }}</strong>
              <span class="muted">{{ formatPercent(stat(id)!.adjustedWinRate) }} smoothed · {{ stat(id)!.wins }}–{{ stat(id)!.losses }}</span>
              <span class="muted">{{ formatDecimal(stat(id)!.kda, 2) }} KDA · {{ stat(id)!.confidence }} confidence · {{ stat(id)!.recentDirection }} form</span>
              <details class="breakdown"><summary>Score breakdown</summary>
                <div v-for="signal in stat(id)!.signals" :key="signal.key">
                  <span>{{ signal.label }}</span><strong>{{ Math.round(signal.score) }} × {{ Math.round(signal.weight * 100) }}%</strong>
                </div>
              </details>
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
.choice-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:var(--space-3); margin-top:var(--space-3); }.choice { min-height:170px; display:grid; grid-template-columns:50px 1fr; grid-template-rows:auto auto auto; column-gap:var(--space-3); align-items:center; padding:var(--space-3); border:1px solid var(--border-subtle); background:var(--surface-2); border-radius:var(--radius-sm); font-size:11px; }.choice.current{border-color:var(--gold)}.portrait{width:50px;height:50px;border-radius:50%;grid-row:span 2;border:1px solid var(--border-strong)}.choice-title{display:flex;gap:var(--space-2);align-items:baseline}.choice strong{color:var(--text-primary)}.current-tag{font-size:9px;text-transform:uppercase;color:var(--gold)}.winrate{font-size:18px;color:var(--win)!important}.no-data{grid-column:1 / -1;margin:var(--space-2) 0 0}.empty-note{margin:var(--space-3) 0 0;font-size:12px}
.objective-row { display:flex; align-items:center; gap:var(--space-2); flex-wrap:wrap; font-size:11px; }.breakdown { grid-column:1 / -1; margin-top:var(--space-2); }.breakdown summary { cursor:pointer; color:var(--gold); }.breakdown div { display:flex; justify-content:space-between; gap:var(--space-2); margin-top:3px; }
@media(max-width:780px){.teams{grid-template-columns:1fr}.enemy{display:none}.choice-grid{grid-template-columns:1fr}.page-head{align-items:flex-start}}
</style>
