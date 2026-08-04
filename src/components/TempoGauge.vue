<script setup lang="ts">
import { computed } from "vue"
import MomentumGauge from "./MomentumGauge.vue"

const props = defineProps<{
  score: number
  label: string
  direction: "up" | "steady" | "down"
  surgeTier?: "gold" | "emerald" | "diamond" | "master"
}>()

const detail = computed(() => ({
  up: "Lead pressure rising",
  steady: "Recent pace holding",
  down: "Control slipping",
})[props.direction])
</script>

<template>
  <MomentumGauge
    class="tempo-gauge"
    :score="score"
    :label="label"
    :streak="0"
    :overdrive-tier="surgeTier"
    title="Tempo"
    :detail="detail"
  />
</template>

<style scoped>
.tempo-gauge { margin-top: 2px; }
</style>
