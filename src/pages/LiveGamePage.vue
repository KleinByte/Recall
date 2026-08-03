<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import AugmentRecommendations from "../components/AugmentRecommendations.vue"
import TempoGauge from "../components/TempoGauge.vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import {
  championIconUrl,
  championNameById,
  formatDecimal,
  formatDuration,
  formatPercent,
  gradeFromScore,
} from "../helpers/format"
import {
  itemIconUrl,
  loadGameAssets,
  type GameAssetCatalog,
} from "../helpers/game-assets"
import type { AramStats, Champion, ChampionRole, ChampionStats } from "../types/lol"
import type { LiveGamePlayer, LivePlayer, LiveSession } from "../types/live"
import type {
  ChampionChoice,
  ChampionChoiceObjective,
  OwnerAugmentSummary,
} from "../types/review"

const props = defineProps<{
  champions: Champion[] | null
  aramStats: AramStats | null
}>()
const events = useApiEvents()

const empty: LiveSession = {
  phase: "Idle",
  benchChampionIds: [],
  allies: [],
  enemies: [],
  updatedAt: 0,
}
const live = ref<LiveSession>(empty)
const recommendations = ref<ChampionChoice[]>([])
const loading = ref(false)
const objective = ref<ChampionChoiceObjective>("best_overall")
const assets = ref<GameAssetCatalog>({ version: "latest", items: {}, augments: {}, abilities: {} })
const augmentHistory = ref<OwnerAugmentSummary[]>([])
const augmentLoading = ref(false)
let recommendationRevision = 0
let recommendationSignature = ""
let augmentRevision = 0
let augmentSignature = ""

function selectedChampionId(player: LivePlayer) {
  return player.championId || player.championPickIntent || 0
}

function localChampionFor(session: LiveSession) {
  const local = session.allies.find(
    (player) => player.cellId === session.localPlayerCellId,
  )
  return local?.championId || local?.championPickIntent || 0
}

function availableFor(session: LiveSession) {
  return [...new Set([
    localChampionFor(session),
    ...session.benchChampionIds,
  ].filter((id) => id > 0))]
}

async function loadRecommendations(force = false) {
  const ids = availableFor(live.value)
  const signature = `${live.value.mode ?? "none"}:${ids.slice().sort((a, b) => a - b).join(",")}:${objective.value}`
  if (!force && signature === recommendationSignature) return
  recommendationSignature = signature

  if (!live.value.mode || ids.length === 0) {
    recommendations.value = []
    return
  }

  const revision = ++recommendationRevision
  loading.value = true
  try {
    const result = await api.getChampionRecommendations(
      ids,
      live.value.mode,
      objective.value,
    )
    if (revision === recommendationRevision) recommendations.value = result
  } catch {
    if (revision === recommendationRevision) {
      recommendations.value = []
      recommendationSignature = ""
    }
  } finally {
    if (revision === recommendationRevision) loading.value = false
  }
}

function liveChampionFor(session: LiveSession) {
  return localChampionFor(session) || championIdByLiveName(
    session.game?.allies.find((player) => player.isLocal)?.championName,
  )
}

function isMayhemSession(session: LiveSession) {
  return session.mode === "mayhem" || session.game?.gameMode?.startsWith("KIWI") === true
}

async function loadAugmentHistory(force = false) {
  const championId = liveChampionFor(live.value)
  const signature = `${isMayhemSession(live.value)}:${championId}`
  if (!force && signature === augmentSignature) return
  augmentSignature = signature

  if (!isMayhemSession(live.value) || championId <= 0) {
    augmentHistory.value = []
    return
  }

  const revision = ++augmentRevision
  augmentLoading.value = true
  try {
    const summaries = await api.getOwnerAugmentSummaries(undefined, championId)
    if (revision === augmentRevision) augmentHistory.value = summaries
  } catch {
    if (revision === augmentRevision) {
      augmentHistory.value = []
      augmentSignature = ""
    }
  } finally {
    if (revision === augmentRevision) augmentLoading.value = false
  }
}

async function update(next: LiveSession) {
  live.value = next
  await Promise.all([loadRecommendations(), loadAugmentHistory()])
}

onMounted(async () => {
  const stored = await api.getSetting<ChampionChoiceObjective>(
    "recommendation-objective",
  )
  if (stored) objective.value = stored
  void loadGameAssets().then((result) => { assets.value = result })
  await update(await api.getLiveSession())
  events.on("live:updated", (next: LiveSession) => void update(next))
})

const localPlayer = computed(() =>
  live.value.allies.find(
    (player) => player.cellId === live.value.localPlayerCellId,
  ),
)
const localChampionId = computed(() => selectedChampionId(localPlayer.value ?? {
  cellId: -1,
  championId: 0,
  championPickIntent: 0,
}))
const available = computed(() => availableFor(live.value))
const byChampion = computed(() =>
  new Map(recommendations.value.map((row) => [row.championId, row])),
)
const rankedAvailable = computed(() =>
  [...available.value].sort((left, right) =>
    (byChampion.value.get(left)?.rank ?? 999) -
      (byChampion.value.get(right)?.rank ?? 999) ||
    championName(left).localeCompare(championName(right)),
  ),
)

function championName(id: number) {
  return championNameById(props.champions, id)
}

function champion(id: number) {
  return props.champions?.find((entry) => entry.id === id)
}

function stat(id: number) {
  return byChampion.value.get(id)
}

function roleLabel(role: ChampionRole) {
  return role[0].toUpperCase() + role.slice(1)
}

function championIdByLiveName(name?: string) {
  if (!name) return 0
  const normalized = name.replaceAll(/[^a-z0-9]/gi, "").toLowerCase()
  return props.champions?.find((entry) =>
    [entry.name, entry.alias].some((candidate) =>
      candidate.replaceAll(/[^a-z0-9]/gi, "").toLowerCase() === normalized,
    ),
  )?.id ?? 0
}

function alliedIdsWithoutLocal() {
  return live.value.allies
    .filter((entry) => entry.cellId !== live.value.localPlayerCellId)
    .map(selectedChampionId)
    .filter((id) => id > 0)
}

function covers(id: number, roles: ChampionRole[]) {
  return champion(id)?.roles.some((role) => roles.includes(role)) === true
}

const composition = computed(() => {
  const ids = [
    ...alliedIdsWithoutLocal(),
    ...(localChampionId.value ? [localChampionId.value] : []),
  ]
  const count = (roles: ChampionRole[]) =>
    ids.filter((id) => covers(id, roles)).length
  return [
    { key: "frontline", label: "Frontline", value: count(["tank", "fighter"]) },
    { key: "range", label: "Ranged pressure", value: count(["marksman", "mage"]) },
    { key: "utility", label: "Utility", value: count(["support", "tank"]) },
    { key: "skirmish", label: "Skirmish", value: count(["assassin", "fighter"]) },
  ]
})

function teamFitReasons(id: number) {
  const others = alliedIdsWithoutLocal()
  const has = (roles: ChampionRole[]) =>
    others.some((candidate) => covers(candidate, roles))
  const reasons: string[] = []
  if (!has(["tank", "fighter"]) && covers(id, ["tank", "fighter"])) {
    reasons.push("Adds frontline")
  }
  if (!has(["marksman", "mage"]) && covers(id, ["marksman", "mage"])) {
    reasons.push("Adds ranged pressure")
  }
  if (!has(["support", "tank"]) && covers(id, ["support", "tank"])) {
    reasons.push("Adds utility")
  }
  return reasons
}

function choiceReasons(id: number) {
  const choice = stat(id)
  const reasons = [...teamFitReasons(id)]
  if (!choice) return reasons.length ? reasons : ["No personal history yet"]
  const strongest = [...choice.signals].sort(
    (left, right) => right.contribution - left.contribution,
  )[0]
  if (strongest?.score >= 55) reasons.push(strongest.label)
  if (choice.recentDirection === "up") reasons.push("Recent form improving")
  if (choice.confidence === "solid") reasons.push("Solid personal evidence")
  if (choice.challengeNames.length) reasons.push("Advances a pinned challenge")
  if (choice.games < 5) reasons.push(`Limited evidence · ${choice.games} games`)
  return [...new Set(reasons)].slice(0, 3)
}

const selectedModifiers = computed<ChampionStats | undefined>(() => {
  const selected = champion(localChampionId.value)
  return selected ? props.aramStats?.[selected.alias] : undefined
})

const modifierChips = computed(() => {
  const value = selectedModifiers.value
  if (!value) return []
  const percent = (amount: number) => `${amount > 0 ? "+" : ""}${amount}%`
  return [
    { label: "Damage dealt", value: value.aramDamageDealt, text: percent(value.aramDamageDealt), bad: value.aramDamageDealt < 0 },
    { label: "Damage taken", value: value.aramDamageTaken, text: percent(value.aramDamageTaken), bad: value.aramDamageTaken > 0 },
    { label: "Healing", value: value.aramHealing, text: percent(value.aramHealing), bad: value.aramHealing < 0 },
    { label: "Shielding", value: value.aramShielding, text: percent(value.aramShielding), bad: value.aramShielding < 0 },
    { label: "Ability haste", value: value.aramAbilityHaste, text: `${value.aramAbilityHaste > 0 ? "+" : ""}${value.aramAbilityHaste}`, bad: value.aramAbilityHaste < 0 },
    { label: "Tenacity", value: value.aramTenacity, text: percent(value.aramTenacity), bad: value.aramTenacity < 0 },
  ].filter((entry) => entry.value !== 0)
})

async function changeObjective() {
  api.setSetting("recommendation-objective", objective.value)
  recommendationSignature = ""
  await loadRecommendations(true)
}

function playerKda(player: LiveGamePlayer) {
  return `${player.scores.kills}/${player.scores.deaths}/${player.scores.assists}`
}

function playerItems(player: LiveGamePlayer) {
  return player.items.filter((item) => !item.consumable).slice(0, 6)
}

function itemIcon(itemId: number) {
  return assets.value.items[itemId]?.icon ??
    itemIconUrl(itemId, assets.value.version)
}

const localLivePlayer = computed(() =>
  live.value.game?.allies.find((player) => player.isLocal),
)
const activeChampionId = computed(() => liveChampionFor(live.value))
const mayhemLive = computed(() => isMayhemSession(live.value))
const augmentRecommendationScore = (summary: OwnerAugmentSummary) => {
  const confidence = Math.min(1, summary.games / 8)
  return (summary.averageGrade ?? -0.25) * confidence - (1 - confidence) * 0.08
}
const bestAugments = computed(() => [...augmentHistory.value]
  .sort((left, right) =>
    augmentRecommendationScore(right) - augmentRecommendationScore(left) ||
    right.games - left.games ||
    right.damagePerMinute - left.damagePerMinute,
  )
  .slice(0, 4))
const teamScore = computed(() =>
  live.value.game?.allies.reduce(
    (sum, player) => sum + player.scores.kills,
    0,
  ) ?? 0,
)
const enemyScore = computed(() =>
  live.value.game?.enemies.reduce(
    (sum, player) => sum + player.scores.kills,
    0,
  ) ?? 0,
)
const recentEvents = computed(() =>
  [...(live.value.game?.events ?? [])]
    .filter((event) =>
      ["ChampionKill", "DragonKill", "BaronKill", "HeraldKill", "TurretKilled", "InhibKilled"].includes(event.name),
    )
    .sort((left, right) => right.time - left.time)
    .slice(0, 8),
)

const analysis = computed(() => live.value.game?.analysis)
const allyResourceShare = computed(() => {
  const resources = analysis.value?.resources
  if (!resources) return 50
  const total = resources.allyGold + resources.enemyGold
  return total > 0 ? resources.allyGold / total * 100 : 50
})
const compactLiveGold = (value: number) =>
  `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}k`
const signedLiveGold = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value)).toLocaleString()}g`
const estimateQualityLabel = (quality: "building" | "fair" | "strong") => ({
  building: "Building estimate",
  fair: "Fair estimate",
  strong: "Strong estimate",
})[quality]

function eventLabel(name: string) {
  const labels: Record<string, string> = {
    ChampionKill: "Champion kill",
    DragonKill: "Dragon slain",
    BaronKill: "Baron slain",
    HeraldKill: "Herald slain",
    TurretKilled: "Turret destroyed",
    InhibKilled: "Inhibitor destroyed",
  }
  return labels[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2")
}
</script>

<template>
  <div class="page live-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">
          {{ live.phase === "InProgress" ? "In game" : "Live companion" }}
        </p>
        <h1>
          {{ live.phase === "Idle"
            ? "Live Game"
            : live.queueName ?? live.gameMode ?? "League of Legends" }}
        </h1>
        <p v-if="live.phase === 'ChampSelect'" class="muted subtitle">
          Champion select
          <template v-if="live.secondsRemaining !== undefined">
            · {{ live.secondsRemaining }}s remaining
          </template>
        </p>
        <p v-else-if="live.phase === 'InProgress'" class="muted subtitle">
          Live data from this computer only.
        </p>
      </div>
      <div class="status-cluster">
        <span v-if="live.phase === 'ChampSelect' && live.rerollsRemaining !== undefined" class="status-pill">
          {{ live.rerollsRemaining }} reroll{{ live.rerollsRemaining === 1 ? "" : "s" }}
        </span>
        <span class="phase" :class="live.phase.toLowerCase()">
          {{ live.phase === "Idle"
            ? "Waiting for game"
            : live.phase === "InProgress"
              ? live.game ? "Live feed" : "Connecting to match"
              : "Champion select" }}
        </span>
      </div>
    </header>

    <section v-if="live.phase === 'Idle'" class="card empty-state">
      <span class="empty-mark">◈</span>
      <div>
        <h2>Waiting for champion select</h2>
        <p class="muted">
          Recall opens this page once per game without taking focus away from League.
        </p>
      </div>
    </section>

    <template v-else-if="live.phase === 'ChampSelect'">
      <section v-if="live.mode === 'aram' || live.mode === 'mayhem'" class="card decision-board">
        <div class="section-head">
          <div>
            <p class="eyebrow">Make the tradeoff visible</p>
            <h2 class="section-title">Your available champions</h2>
            <p class="muted hint">
              Personal history and current composition are kept separate so you
              can choose what matters this game.
            </p>
          </div>
          <div class="objective-row">
            <label for="choice-objective">Optimize for</label>
            <select
              id="choice-objective"
              v-model="objective"
              class="league-select"
              @change="changeObjective"
            >
              <option value="best_overall">Best Overall</option>
              <option value="recent_form">Recent Form</option>
              <option value="challenges">Challenges</option>
              <option value="practice">Practice</option>
              <option value="most_reliable">Most Reliable</option>
            </select>
            <span v-if="loading" class="muted loading-label">Updating…</span>
          </div>
        </div>

        <div v-if="rankedAvailable.length" class="choice-table" role="table" aria-label="Available champion comparison">
          <div class="choice-row choice-head" role="row">
            <span>Champion</span>
            <span>Recall score</span>
            <span>Personal record</span>
            <span>Evidence</span>
            <span>Why consider it</span>
          </div>
          <article
            v-for="id in rankedAvailable"
            :key="id"
            class="choice-row"
            :class="{ current: id === localChampionId, recommended: stat(id)?.rank === 1 }"
            role="row"
          >
            <div class="champion-cell">
              <span class="rank">{{ stat(id) ? `#${stat(id)!.rank}` : "—" }}</span>
              <img :src="championIconUrl(id)" :alt="championName(id)" />
              <div>
                <strong>{{ championName(id) }}</strong>
                <span class="role-line">
                  {{ champion(id)?.roles.map(roleLabel).join(" · ") || "Unknown role" }}
                </span>
              </div>
              <span v-if="id === localChampionId" class="current-tag">Current</span>
            </div>
            <div class="score-cell">
              <strong>{{ stat(id) ? Math.round(stat(id)!.score) : "—" }}</strong>
              <span>{{ stat(id)?.rank === 1 ? "Top option" : "Personal model" }}</span>
            </div>
            <div v-if="stat(id)" class="record-cell">
              <strong>{{ stat(id)!.wins }}–{{ stat(id)!.losses }}</strong>
              <span>{{ formatPercent(stat(id)!.adjustedWinRate) }} smoothed</span>
              <span>{{ formatDecimal(stat(id)!.kda, 2) }} KDA · {{ gradeFromScore(stat(id)!.averageGrade) ?? "—" }} avg</span>
            </div>
            <div v-else class="record-cell muted">No games in this mode</div>
            <div class="confidence-cell">
              <span class="confidence" :class="stat(id)?.confidence">
                {{ stat(id)?.confidence ?? "new" }}
              </span>
              <span v-if="stat(id)">
                {{ stat(id)!.games }} game{{ stat(id)!.games === 1 ? "" : "s" }}
              </span>
            </div>
            <div class="reason-cell">
              <span v-for="reason in choiceReasons(id)" :key="reason" class="reason-chip">
                {{ reason }}
              </span>
              <details v-if="stat(id)" class="breakdown">
                <summary>Score details</summary>
                <div v-for="signal in stat(id)!.signals" :key="signal.key">
                  <span>{{ signal.label }}</span>
                  <strong>{{ Math.round(signal.score) }} × {{ Math.round(signal.weight * 100) }}%</strong>
                </div>
              </details>
            </div>
          </article>
        </div>
        <p v-else class="muted empty-note">
          Waiting for your champion and bench options.
        </p>
      </section>

      <div class="prep-grid">
        <section class="card selected-card">
          <div class="section-head compact">
            <div>
              <p class="eyebrow">Selected champion</p>
              <h2 class="section-title">
                {{ localChampionId ? championName(localChampionId) : "Waiting for your pick" }}
              </h2>
            </div>
            <img
              v-if="localChampionId"
              :src="championIconUrl(localChampionId)"
              :alt="championName(localChampionId)"
              class="selected-portrait"
            />
          </div>
          <template v-if="localChampionId">
            <div v-if="stat(localChampionId)" class="selected-stats">
              <div><strong>{{ stat(localChampionId)!.wins }}–{{ stat(localChampionId)!.losses }}</strong><span>Record</span></div>
              <div><strong>{{ formatDecimal(stat(localChampionId)!.kda, 2) }}</strong><span>KDA</span></div>
              <div><strong>{{ gradeFromScore(stat(localChampionId)!.averageGrade) ?? "—" }}</strong><span>Average grade</span></div>
              <div><strong>{{ stat(localChampionId)!.confidence }}</strong><span>Confidence</span></div>
            </div>
            <div v-if="modifierChips.length" class="modifier-list">
              <span
                v-for="modifier in modifierChips"
                :key="modifier.label"
                :class="{ nerf: modifier.bad }"
              >
                {{ modifier.label }} <strong>{{ modifier.text }}</strong>
              </span>
            </div>
            <p v-else-if="live.mode === 'aram'" class="muted small">
              No ARAM balance modifiers found for this champion.
            </p>
          </template>
        </section>

        <section class="card composition-card">
          <div>
            <p class="eyebrow">Current shape</p>
            <h2 class="section-title">Team composition</h2>
          </div>
          <div class="composition-bars">
            <div v-for="signal in composition" :key="signal.key">
              <span>{{ signal.label }}</span>
              <div class="composition-track">
                <i :style="{ width: `${Math.min(100, signal.value * 25)}%` }"></i>
              </div>
              <strong>{{ signal.value }}/5</strong>
            </div>
          </div>
          <p class="muted small">
            Broad role coverage only—not a prediction. Recall keeps composition
            fit distinct from your personal recommendation score.
          </p>
        </section>
      </div>

      <section v-if="mayhemLive && activeChampionId" class="card augment-advisor-card">
        <AugmentRecommendations
          :champion-name="championName(activeChampionId)"
          :summaries="bestAugments"
          :assets="assets"
          :loading="augmentLoading"
        />
      </section>

      <section class="card roster-card">
        <div class="section-head compact">
          <div>
            <p class="eyebrow">Client-visible lobby</p>
            <h2 class="section-title">Your team</h2>
          </div>
          <span class="muted small">Hidden identities stay hidden</span>
        </div>
        <div class="lobby-grid">
          <article
            v-for="player in live.allies"
            :key="player.cellId"
            class="lobby-player"
            :class="{ me: player.cellId === live.localPlayerCellId }"
          >
            <img
              v-if="selectedChampionId(player)"
              :src="championIconUrl(selectedChampionId(player))"
              :alt="championName(selectedChampionId(player))"
            />
            <span v-else class="champion-placeholder">?</span>
            <div>
              <strong>
                {{ player.displayName ??
                  (player.cellId === live.localPlayerCellId ? "You" : "Identity hidden by Riot") }}
              </strong>
              <span>
                {{ selectedChampionId(player)
                  ? championName(selectedChampionId(player))
                  : "Waiting for champion" }}
              </span>
            </div>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <section v-if="live.game" class="live-summary">
        <article class="metric-card score">
          <span>Team score</span>
          <strong>{{ teamScore }} <i>–</i> {{ enemyScore }}</strong>
        </article>
        <article class="metric-card">
          <span>Game time</span>
          <strong>{{ formatDuration(live.game.gameTime) }}</strong>
        </article>
        <article class="metric-card">
          <span>Your KDA</span>
          <strong>{{ localLivePlayer ? playerKda(localLivePlayer) : "—" }}</strong>
        </article>
        <article class="metric-card">
          <span>CS</span>
          <strong>{{ localLivePlayer?.scores.creepScore ?? "—" }}</strong>
        </article>
        <article class="metric-card">
          <span>Current gold</span>
          <strong>{{ Math.round(live.game.activePlayer?.currentGold ?? 0).toLocaleString() }}</strong>
        </article>
        <article class="metric-card">
          <span>Level</span>
          <strong>{{ localLivePlayer?.level ?? live.game.activePlayer?.level ?? "—" }}</strong>
        </article>
      </section>

      <section v-if="analysis" class="live-intelligence">
        <article class="card resource-card">
          <div class="section-head compact">
            <div>
              <p class="eyebrow">Resource control</p>
              <h2 class="section-title">Estimated team gold</h2>
            </div>
            <span class="estimate-quality" :class="analysis.resources.quality">
              {{ estimateQualityLabel(analysis.resources.quality) }}
            </span>
          </div>
          <div class="resource-totals">
            <div class="ally"><span>Your team</span><strong>{{ compactLiveGold(analysis.resources.allyGold) }}</strong></div>
            <div class="resource-lead" :class="analysis.resources.difference >= 0 ? 'ahead' : 'behind'">
              <span>{{ analysis.resources.difference >= 0 ? "Lead" : "Deficit" }}</span>
              <strong>{{ signedLiveGold(analysis.resources.difference) }}</strong>
            </div>
            <div class="enemy"><span>Opponents</span><strong>{{ compactLiveGold(analysis.resources.enemyGold) }}</strong></div>
          </div>
          <div class="resource-track" aria-label="Estimated team resource share">
            <span class="ally-fill" :style="{ width: `${allyResourceShare}%` }" />
            <i class="midpoint" />
          </div>
          <div class="win-outlook" :class="{
            favored: analysis.winConfidence.percent >= 56,
            danger: analysis.winConfidence.percent < 45,
          }">
            <div>
              <span>Win confidence</span>
              <strong>{{ analysis.winConfidence.percent }}%</strong>
            </div>
            <div class="confidence-copy">
              <strong>{{ analysis.winConfidence.label }}</strong>
              <span>{{ analysis.winConfidence.factors.join(" · ") }}</span>
            </div>
          </div>
          <p class="estimate-note">
            Estimated from symmetric live-feed signals; Riot does not expose exact team gold during play.
          </p>
        </article>

        <article class="card tempo-card">
          <div class="section-head compact">
            <div>
              <p class="eyebrow">Recent execution</p>
              <h2 class="section-title">Tempo</h2>
            </div>
            <span class="tempo-direction" :class="analysis.tempo.direction">
              {{ analysis.tempo.direction === "up" ? "↗ Rising" : analysis.tempo.direction === "down" ? "↘ Falling" : "→ Steady" }}
            </span>
          </div>
            <TempoGauge
              :score="analysis.tempo.score"
              :label="analysis.tempo.label"
              :direction="analysis.tempo.direction"
              :surge-tier="analysis.tempo.surgeTier"
            />
          <div class="tempo-factors">
            <span v-for="factor in analysis.tempo.factors" :key="factor">{{ factor }}</span>
          </div>
        </article>
      </section>

      <section v-if="mayhemLive && activeChampionId" class="card augment-advisor-card live-augment-advisor">
        <AugmentRecommendations
          :champion-name="championName(activeChampionId)"
          :summaries="bestAugments"
          :assets="assets"
          :loading="augmentLoading"
        />
      </section>

      <section v-if="!live.game" class="card game-connecting">
        <span class="pulse"></span>
        <div>
          <h2>Connecting to the local match feed</h2>
          <p class="muted">
            The game-client API becomes available after the loading transition.
            Recall will keep trying automatically.
          </p>
        </div>
      </section>

      <div v-else class="in-game-grid">
        <section class="card live-scoreboard">
          <div class="section-head compact">
            <div>
              <p class="eyebrow">Visible match state</p>
              <h2 class="section-title">Scoreboard</h2>
            </div>
            <span class="freshness">Updated live</span>
          </div>
          <div
            v-for="(team, teamIndex) in [live.game.allies, live.game.enemies]"
            :key="teamIndex"
            class="live-team"
          >
            <h3>{{ teamIndex === 0 ? "Your team" : "Opponents" }}</h3>
            <article
              v-for="player in team"
              :key="`${player.team}-${player.riotId}-${player.championName}`"
              class="live-player"
              :class="{ me: player.isLocal, dead: player.isDead }"
            >
              <img
                :src="championIconUrl(championIdByLiveName(player.championName))"
                :alt="player.championName"
                class="live-champion"
              />
              <div class="live-identity">
                <strong>{{ player.riotId || player.championName }}</strong>
                <span>
                  {{ player.championName }} · level {{ player.level }}
                  <template v-if="player.isDead"> · {{ Math.ceil(player.respawnTimer) }}s</template>
                </span>
              </div>
              <strong class="live-kda">{{ playerKda(player) }}</strong>
              <span class="live-cs">{{ player.scores.creepScore }} CS</span>
              <div class="live-items">
                <img
                  v-for="item in playerItems(player)"
                  :key="`${item.itemId}-${item.name}`"
                  :src="itemIcon(item.itemId)"
                  :alt="item.name"
                  :title="item.name"
                />
                <i v-for="slot in Math.max(0, 6 - playerItems(player).length)" :key="slot"></i>
              </div>
            </article>
          </div>
        </section>

        <aside class="game-rail">
          <section class="card loadout-card">
            <p class="eyebrow">Your loadout</p>
            <h2 class="section-title">{{ localLivePlayer?.championName ?? "Active player" }}</h2>
            <div v-if="localLivePlayer" class="loadout-items">
              <figure v-for="item in localLivePlayer.items" :key="`${item.itemId}-${item.name}`">
                <img :src="itemIcon(item.itemId)" :alt="item.name" />
                <figcaption>{{ item.name }}</figcaption>
              </figure>
            </div>
            <div v-if="localLivePlayer?.summonerSpells.length" class="loadout-meta">
              <span>{{ localLivePlayer.summonerSpells.join(" · ") }}</span>
              <span v-if="localLivePlayer.keystone">{{ localLivePlayer.keystone }}</span>
            </div>
          </section>

          <section class="card event-card">
            <p class="eyebrow">Latest milestones</p>
            <h2 class="section-title">Match events</h2>
            <div v-if="recentEvents.length" class="live-events">
              <article v-for="event in recentEvents" :key="event.id">
                <time>{{ formatDuration(event.time) }}</time>
                <span class="event-dot">◆</span>
                <div>
                  <strong>{{ eventLabel(event.name) }}</strong>
                  <span v-if="event.killerName || event.victimName">
                    {{ event.killerName || "Unknown" }}
                    <template v-if="event.victimName"> → {{ event.victimName }}</template>
                  </span>
                </div>
              </article>
            </div>
            <p v-else class="muted small">No major events yet.</p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.live-page { gap: var(--space-4); width: min(100%, 1480px); margin-inline: auto; padding-bottom: var(--space-5); }
.page-head, .section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-4); }
.section-head.compact { align-items: center; }
.eyebrow { margin: 0 0 3px; font: 10px var(--font-heading); letter-spacing: 1.5px; text-transform: uppercase; color: var(--gold); }
.subtitle, .hint { margin: var(--space-1) 0 0; font-size: 12px; }.hint { max-width: 68ch; font-size: 11px; }
.section-title { margin-bottom: 0; }
.status-cluster { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
.phase, .status-pill { border: 1px solid var(--border-strong); border-radius: 999px; padding: 6px 10px; font: 10px var(--font-heading); letter-spacing: .8px; text-transform: uppercase; color: var(--text-secondary); white-space: nowrap; }
.phase.champselect { color: var(--gold); border-color: var(--gold); }.phase.inprogress { color: var(--win); border-color: var(--win); }
.status-pill { color: var(--gold-bright); background: var(--surface-2); }
.empty-state, .game-connecting { min-height: 120px; display: flex; align-items: center; gap: var(--space-4); }
.empty-state h2, .game-connecting h2 { margin: 0; font: 18px var(--font-heading); color: var(--gold-bright); }
.empty-state p, .game-connecting p { margin: 4px 0 0; font-size: 12px; }
.empty-mark { display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--gold); font-size: 24px; }
.decision-board, .selected-card, .composition-card, .roster-card, .live-scoreboard, .loadout-card, .event-card, .augment-advisor-card { padding: 16px 18px; }
.objective-row { display: grid; grid-template-columns: auto minmax(150px, auto); align-items: center; gap: 4px var(--space-2); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); }
.objective-row .loading-label { grid-column: 2; text-transform: none; letter-spacing: 0; }
.choice-table { margin-top: var(--space-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: visible; }
.choice-row { display: grid; grid-template-columns: minmax(220px, 1.25fr) minmax(92px, .55fr) minmax(150px, .85fr) minmax(92px, .55fr) minmax(220px, 1.3fr); align-items: center; min-height: 76px; border-bottom: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--surface-1) 94%, transparent); }
.choice-row:last-child { border-bottom: 0; }
.choice-row > * { min-width: 0; padding: var(--space-2) var(--space-3); }
.choice-row:not(.choice-head):hover { background: var(--surface-2); }
.choice-row.current { box-shadow: inset 3px 0 var(--gold); }
.choice-row.recommended { background: linear-gradient(90deg, color-mix(in srgb, var(--win-dim) 45%, var(--surface-1)), var(--surface-1) 55%); }
.choice-head { min-height: 34px; background: var(--surface-2); color: var(--text-secondary); font: 10px var(--font-heading); letter-spacing: 1.2px; text-transform: uppercase; }
.champion-cell { display: grid; grid-template-columns: 24px 42px minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); }
.champion-cell img { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border-strong); }
.champion-cell > div, .score-cell, .record-cell, .confidence-cell { display: flex; flex-direction: column; }
.champion-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank { color: var(--gold); font: 15px var(--font-display); }
.role-line, .score-cell span, .record-cell span, .confidence-cell > span:last-child { color: var(--text-secondary); font-size: 10px; }
.current-tag { padding: 2px 5px; border: 1px solid var(--gold-dim); color: var(--gold); font-size: 9px; letter-spacing: .8px; text-transform: uppercase; }
.score-cell strong { color: var(--gold-bright); font: 24px var(--font-display); }
.record-cell { gap: 1px; font-size: 11px; }
.record-cell strong { font-size: 13px; color: var(--text-primary); }
.confidence { align-self: flex-start; padding: 3px 7px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); font-size: 10px; text-transform: uppercase; }
.confidence.solid { color: var(--win); border-color: var(--win-dim); }.confidence.fair { color: var(--gold); }.confidence.thin { color: var(--loss); border-color: var(--loss-dim); }
.reason-cell { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.reason-chip { padding: 3px 6px; border-radius: 999px; background: var(--surface-3); color: var(--text-secondary); font-size: 10px; }
.breakdown { width: 100%; font-size: 10px; }.breakdown summary { cursor: pointer; color: var(--gold); }.breakdown div { display: flex; justify-content: space-between; margin-top: 3px; }
.empty-note { margin: var(--space-4) 0 0; }
.prep-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .8fr); gap: var(--space-4); }
.selected-portrait { width: 64px; height: 64px; border-radius: 50%; border: 1px solid var(--gold); box-shadow: 0 0 24px rgba(200, 170, 109, .14); }
.selected-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); margin-top: var(--space-4); }
.selected-stats div { display: flex; flex-direction: column; padding: var(--space-2); background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
.selected-stats strong { color: var(--gold-bright); font: 18px var(--font-display); text-transform: capitalize; }.selected-stats span { color: var(--text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: .8px; }
.modifier-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.modifier-list > span { padding: 4px 7px; border: 1px solid var(--win-dim); border-radius: 999px; color: var(--win); font-size: 10px; }.modifier-list > span.nerf { border-color: var(--loss-dim); color: var(--loss); }
.composition-bars { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.composition-bars > div { display: grid; grid-template-columns: 110px 1fr 30px; align-items: center; gap: var(--space-2); font-size: 10px; color: var(--text-secondary); }
.composition-bars strong { color: var(--text-primary); text-align: right; }
.composition-track { height: 6px; overflow: hidden; border-radius: 99px; background: var(--surface-3); }.composition-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--gold-dim), var(--gold)); }
.small { font-size: 10px; }.composition-card > .small { margin: var(--space-3) 0 0; }
.lobby-grid { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: var(--space-2); margin-top: var(--space-3); }
.lobby-player { display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: center; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-2); }
.lobby-player.me { border-color: var(--gold); }.lobby-player img, .champion-placeholder { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border-subtle); }.champion-placeholder { display: grid; place-items: center; color: var(--text-muted); }
.lobby-player div { min-width: 0; display: flex; flex-direction: column; }.lobby-player strong, .lobby-player span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.lobby-player strong { font-size: 12px; }.lobby-player div span { color: var(--text-secondary); font-size: 10px; }
.augment-advisor-card { overflow: hidden; background: radial-gradient(circle at 8% 0, rgba(142, 115, 220, .1), transparent 34%), linear-gradient(145deg, var(--surface-2), var(--surface-1)); }
.live-augment-advisor { margin-top: 0; }
.live-summary { display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); gap: 12px; }
.metric-card { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-height: 68px; padding: 12px 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: linear-gradient(145deg, var(--surface-2), var(--surface-1)); }
.metric-card span { color: var(--text-secondary); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }.metric-card strong { color: var(--gold-bright); font: 21px var(--font-display); }.metric-card.score strong { color: var(--win); }.metric-card.score i { color: var(--text-muted); font-style: normal; }
.live-intelligence { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(310px, .72fr); gap: 14px; align-items: stretch; }
.resource-card, .tempo-card { padding: 17px 18px; overflow: hidden; }.resource-card { background: radial-gradient(circle at 8% 0, rgba(36, 164, 203, .12), transparent 38%), linear-gradient(145deg, var(--surface-2), var(--surface-1)); }.tempo-card { display: flex; flex-direction: column; background: radial-gradient(circle at 50% 36%, rgba(34, 188, 176, .09), transparent 43%), linear-gradient(160deg, var(--surface-2), var(--surface-1)); }
.estimate-quality, .tempo-direction { padding: 4px 7px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); font-size: 8px; letter-spacing: .7px; text-transform: uppercase; }.estimate-quality.strong { color: var(--win); border-color: var(--win-dim); }.estimate-quality.fair { color: var(--gold); }.tempo-direction.up { color: #39d8b0; border-color: rgba(57, 216, 176, .35); }.tempo-direction.down { color: var(--loss); border-color: var(--loss-dim); }
.resource-totals { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: var(--space-4); margin-top: var(--space-4); }.resource-totals > div { display: flex; flex-direction: column; }.resource-totals span { color: var(--text-secondary); font-size: 10px; letter-spacing: .8px; text-transform: uppercase; }.resource-totals strong { color: var(--text-primary); font: 27px var(--font-display); }.resource-totals .enemy { text-align: right; }.resource-totals .ally strong { color: #59c8e5; }.resource-totals .enemy strong { color: #ed7784; }.resource-lead { align-items: center; padding: 4px 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-0); }.resource-lead strong { font-size: 16px; }.resource-lead.ahead strong { color: var(--win); }.resource-lead.behind strong { color: var(--loss); }
.resource-track { position: relative; height: 9px; margin-top: var(--space-3); overflow: hidden; border-radius: 1px; background: linear-gradient(90deg, rgba(53, 185, 221, .28), rgba(228, 88, 104, .5)); box-shadow: inset 0 0 0 1px var(--border-subtle); }.ally-fill { display: block; height: 100%; background: linear-gradient(90deg, #16799a, #41c0df); transition: width .45s ease; }.midpoint { position: absolute; inset: -2px auto -2px 50%; width: 1px; background: #e8d69d; box-shadow: 0 0 5px rgba(232, 214, 157, .7); }
.win-outlook { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-4); margin-top: var(--space-4); padding: 12px 14px; border-left: 3px solid var(--gold); background: color-mix(in srgb, var(--gold-dim) 12%, var(--surface-0)); }.win-outlook.favored { border-left-color: var(--win); }.win-outlook.danger { border-left-color: var(--loss); }.win-outlook > div:first-child { display: flex; flex-direction: column; min-width: 88px; }.win-outlook span { color: var(--text-secondary); font-size: 10px; }.win-outlook > div:first-child > span { letter-spacing: .9px; text-transform: uppercase; }.win-outlook > div:first-child strong { color: var(--gold-bright); font: 29px var(--font-display); }.confidence-copy { display: flex; flex-direction: column; gap: 3px; }.confidence-copy strong { color: var(--text-primary); font: 12px var(--font-heading); }.estimate-note { margin: 9px 0 0; color: var(--text-muted); font-size: 10px; }.tempo-factors { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; margin-top: 7px; }.tempo-factors span { padding: 4px 7px; border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--surface-0); color: var(--text-secondary); font-size: 9px; }
.pulse { width: 13px; height: 13px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 0 0 rgba(200, 170, 109, .4); animation: pulse 1.6s infinite; }
.in-game-grid { display: grid; grid-template-columns: minmax(0, 1fr) 310px; align-items: start; gap: 14px; }
.live-scoreboard > .section-head { margin-bottom: 12px; }.live-team { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface-0) 62%, transparent); }.live-team + .live-team { margin-top: 12px; }.live-team h3 { margin: 0; padding: 7px 10px; border-bottom: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--win) 7%, var(--surface-2)); color: var(--win); font: 10px var(--font-heading); letter-spacing: 1.2px; text-transform: uppercase; }.live-team + .live-team h3 { color: var(--loss); background: color-mix(in srgb, var(--loss) 7%, var(--surface-2)); }
.freshness { padding: 4px 7px; border: 1px solid var(--win-dim); border-radius: 999px; color: var(--win); font-size: 9px; text-transform: uppercase; }
.live-player { display: grid; grid-template-columns: 36px minmax(130px, 1fr) 64px 50px minmax(150px, .8fr); align-items: center; gap: 9px; min-height: 52px; padding: 6px 10px; border-bottom: 1px solid var(--border-subtle); }.live-player:last-child { border-bottom: 0; }
.live-player.me { background: var(--surface-2); box-shadow: inset 2px 0 var(--gold); }.live-player.dead { opacity: .58; }
.live-champion { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border-subtle); }
.live-identity { min-width: 0; display: flex; flex-direction: column; }.live-identity strong, .live-identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.live-identity strong { font-size: 12px; }.live-identity span, .live-cs { color: var(--text-secondary); font-size: 10px; }
.live-kda { font-size: 11px; font-variant-numeric: tabular-nums; }.live-items { display: grid; grid-template-columns: repeat(6, 24px); gap: 3px; justify-content: end; }.live-items img, .live-items i { width: 22px; height: 22px; border: 1px solid var(--border-subtle); border-radius: 3px; background: var(--surface-0); }
.game-rail { display: grid; gap: 14px; }.game-rail .section-title { margin-top: 1px; }
.loadout-items { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin-top: var(--space-3); }.loadout-items figure { margin: 0; min-width: 0; }.loadout-items img { width: 100%; aspect-ratio: 1; object-fit: cover; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }.loadout-items figcaption { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: 9px; }
.loadout-meta { display: flex; flex-direction: column; gap: 3px; margin-top: var(--space-3); color: var(--text-secondary); font-size: 10px; }
.live-events { display: grid; margin-top: var(--space-2); }.live-events article { display: grid; grid-template-columns: 35px 12px minmax(0, 1fr); align-items: start; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border-subtle); }.live-events time { color: var(--gold); font-size: 9px; }.event-dot { color: var(--gold); font-size: 8px; }.live-events div { min-width: 0; display: flex; flex-direction: column; }.live-events strong { font-size: 11px; }.live-events div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: 10px; }
@keyframes pulse { 70% { box-shadow: 0 0 0 10px rgba(200, 170, 109, 0); } 100% { box-shadow: 0 0 0 0 rgba(200, 170, 109, 0); } }
@media (max-width: 1160px) {
  .choice-row { grid-template-columns: minmax(200px, 1.3fr) 90px 145px 90px minmax(180px, 1fr); }
  .lobby-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .live-summary { grid-template-columns: repeat(3, minmax(110px, 1fr)); }
  .live-intelligence { grid-template-columns: minmax(0, 1fr) 310px; }
  .in-game-grid { grid-template-columns: 1fr; }.game-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .choice-head { display: none; }.choice-row { grid-template-columns: minmax(190px, 1.3fr) 78px 130px; }.choice-row > * { padding: var(--space-2); }.choice-row .confidence-cell { display: none; }.choice-row .reason-cell { grid-column: 1 / -1; padding-top: 0; }
  .prep-grid { grid-template-columns: 1fr; }.selected-stats { grid-template-columns: repeat(2, 1fr); }
  .live-intelligence { grid-template-columns: 1fr; }.tempo-card { min-height: 230px; }
  .live-player { grid-template-columns: 34px minmax(120px, 1fr) 58px minmax(120px, .8fr); }.live-player .live-cs { display: none; }
}
@media (max-width: 620px) {
  .page-head, .section-head { flex-direction: column; }.status-cluster { justify-content: flex-start; }
  .objective-row { width: 100%; grid-template-columns: 1fr; }.objective-row .loading-label { grid-column: auto; }
  .choice-row { grid-template-columns: 1fr 70px; }.choice-row .record-cell { grid-column: 1 / -1; padding-top: 0; }.champion-cell { grid-template-columns: 22px 36px minmax(0, 1fr); }.champion-cell img { width: 34px; height: 34px; }.current-tag { display: none; }
  .live-summary { grid-template-columns: repeat(2, minmax(100px, 1fr)); }.game-rail { grid-template-columns: 1fr; }
  .resource-totals { gap: var(--space-2); }.resource-totals strong { font-size: 21px; }.resource-lead { padding: 4px 7px; }.resource-lead strong { font-size: 13px; }.win-outlook { grid-template-columns: 1fr; gap: var(--space-2); }
  .live-player { grid-template-columns: 32px minmax(100px, 1fr) 52px; }.live-player .live-items { display: none; }
}
@media (prefers-reduced-motion: reduce) { .pulse { animation: none; }.ally-fill { transition: none; } }
</style>
