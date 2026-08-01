<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { championIconUrl, championNameById } from "../helpers/format"
import type { Champion } from "../types/lol"
import type { ChampionStatus } from "../types/stats"

const props = defineProps<{ champions: Champion[] | null }>()
const events = useApiEvents()

const championId = ref<number | null>(null)
const statuses = ref<ChampionStatus[]>([])

async function refresh(id: number | null) {
  if (id === null) {
    statuses.value = []
    return
  }

  try {
    statuses.value = await api.getChampionStatus(id)
  } catch {
    statuses.value = []
  }
}

onMounted(() => {
  events.on("pick", (id: number | null) => {
    championId.value = id
  })

  // The banner belongs to champion select; once the game starts it has said
  // everything it can.
  events.on("game-start", () => {
    championId.value = null
  })

  events.on("lcu:status", (payload: { connected: boolean }) => {
    if (!payload.connected) championId.value = null
  })
})

watch(championId, refresh)

const name = computed(() =>
  championId.value === null
    ? ""
    : championNameById(props.champions, championId.value),
)

const needed = computed(() => statuses.value.filter((row) => !row.completed))
const done = computed(() => statuses.value.filter((row) => row.completed))
</script>

<template>
  <div
    v-if="championId !== null && statuses.length"
    class="banner"
    :class="needed.length ? 'needed' : 'done'"
  >
    <img :src="championIconUrl(championId)" :alt="name" class="portrait" />

    <div class="body">
      <div class="headline">
        <strong>{{ name }}</strong>
        <span v-if="needed.length" class="tag needed-tag">
          Counts towards {{ needed.length }} pinned
          {{ needed.length === 1 ? "challenge" : "challenges" }}
        </span>
        <span v-else class="tag done-tag">Already done for every pin</span>
      </div>

      <ul class="challenges">
        <li v-for="status in needed" :key="status.challengeId">
          <span class="mark needed-mark">needed</span>
          <span class="challenge-name">{{ status.name }}</span>
          <span class="muted count">{{ status.completedCount }} done</span>
        </li>
        <li v-for="status in done" :key="status.challengeId" class="faded">
          <span class="mark done-mark">done</span>
          <span class="challenge-name">{{ status.name }}</span>
          <span class="muted count">{{ status.completedCount }} done</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.banner.needed {
  border-left-color: var(--gold);
}

.banner.done {
  border-left-color: var(--text-muted);
}

.portrait {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.body {
  flex: 1;
  min-width: 0;
}

.headline {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.headline strong {
  font-family: var(--font-heading);
  font-weight: 500;
  letter-spacing: 0.6px;
  color: var(--gold-bright);
  font-size: 15px;
}

.tag {
  font-size: 11px;
  letter-spacing: 0.4px;
}

.needed-tag {
  color: var(--gold);
}

.done-tag {
  color: var(--text-secondary);
}

.challenges {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.challenges li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: 12px;
}

.faded {
  opacity: 0.55;
}

.mark {
  font-family: var(--font-heading);
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  min-width: 48px;
  text-align: center;
}

.needed-mark {
  background: rgba(200, 170, 109, 0.18);
  color: var(--gold);
}

.done-mark {
  background: var(--surface-3);
  color: var(--text-muted);
}

.challenge-name {
  color: var(--text-primary);
}

.count {
  font-size: 11px;
  margin-left: auto;
}
</style>
