<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { championIconUrl } from "./helpers/format"
import { useApiEvents } from "./helpers/use-api-events"
import type { ChampionStatus } from "./types/stats"

interface OverlayData {
  championId: number
  championName?: string
  needed: ChampionStatus[]
  done: ChampionStatus[]
}

const data = ref<OverlayData | null>(null)
const events = useApiEvents()

onMounted(() => {
  events.on("overlay:data", (payload: OverlayData) => {
    data.value = payload
  })
})

const tone = computed(() =>
  (data.value?.needed.length ?? 0) > 0 ? "needed" : "done",
)
</script>

<template>
  <div v-if="data" class="overlay" :class="tone">
    <div class="head">
      <img
        :src="championIconUrl(data.championId)"
        :alt="data.championName ?? ''"
        class="portrait"
      />
      <div class="who">
        <div class="name">{{ data.championName ?? "Your champion" }}</div>
        <div class="verdict">
          <template v-if="data.needed.length">
            Needed for {{ data.needed.length }}
            {{ data.needed.length === 1 ? "pin" : "pins" }}
          </template>
          <template v-else>Already done</template>
        </div>
      </div>
    </div>

    <ul class="list">
      <li v-for="status in data.needed" :key="status.challengeId">
        <span class="mark needed-mark" aria-label="Champion still needed">×</span>
        <span class="challenge">{{ status.name }}</span>
        <span class="count">{{ status.completedCount }}</span>
      </li>
      <li v-for="status in data.done" :key="status.challengeId" class="faded">
        <span class="mark done-mark" aria-label="Champion already complete">✓</span>
        <span class="challenge">{{ status.name }}</span>
        <span class="count">{{ status.completedCount }}</span>
      </li>
    </ul>

    <div class="grip">Recall · drag to move</div>
  </div>
</template>

<style scoped>
/*
 * The window itself is transparent, so this panel is the whole visible
 * surface. It is dragged by its own body, since the window has no frame.
 */
.overlay {
  -webkit-app-region: drag;
  user-select: none;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(10, 20, 40, 0.94);
  border: 1px solid var(--border-strong);
  border-left-width: 3px;
  border-radius: 4px;
  color: var(--text-primary);
  font-family: var(--font-body);
}

.overlay.needed {
  border-left-color: var(--gold);
}

.overlay.done {
  border-left-color: var(--text-muted);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.portrait {
  width: 38px;
  height: 38px;
  border-radius: 3px;
  border: 1px solid var(--border-subtle);
}

.name {
  font-family: var(--font-heading);
  font-size: 14px;
  letter-spacing: 0.5px;
  color: var(--gold-bright);
}

.verdict {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 1px;
}

.overlay.needed .verdict {
  color: var(--gold);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}

.list li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.faded {
  opacity: 0.5;
}

.mark {
  font-family: var(--font-heading);
  font-size: 14px;
  line-height: 1;
  padding: 1px;
  border-radius: 2px;
  min-width: 16px;
  text-align: center;
}

.needed-mark {
  background: rgba(200, 170, 109, 0.2);
  color: var(--gold);
}

.done-mark {
  background: rgba(255, 255, 255, 0.06);
  color: var(--win);
}

.challenge {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  margin-left: auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.grip {
  margin-top: auto;
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: center;
}
</style>
