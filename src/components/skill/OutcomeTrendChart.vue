<script setup lang="ts">
import { computed } from "vue"
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js"
import { Line } from "vue-chartjs"

const props = defineProps<{
  rows: Array<{ label: string; games: number; winRate: number }>
}>()

ChartJS.register(CategoryScale, Filler, LineElement, LinearScale, PointElement, Tooltip)

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

const chartData = computed(() => ({
  labels: props.rows.map((row) => row.label),
  datasets: [{
    label: "Recorded win rate",
    data: props.rows.map((row) => row.games ? Math.round(row.winRate * 100) : null),
    borderColor: "#0acbe6",
    backgroundColor: "rgba(10, 203, 230, 0.12)",
    pointBackgroundColor: "#0acbe6",
    pointRadius: 3,
    borderWidth: 2,
    tension: 0.25,
    fill: true,
  }],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: reducedMotion() ? 0 : 520 },
  scales: {
    x: {
      grid: { color: "rgba(200, 170, 109, 0.10)" },
      ticks: { color: "#a09b8c", font: { size: 10 } },
    },
    y: {
      min: 0,
      max: 100,
      grid: { color: "rgba(200, 170, 109, 0.14)" },
      ticks: { color: "#a09b8c", callback: (value: number | string) => `${value}%` },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "#0f1c33",
      borderColor: "rgba(200, 170, 109, 0.55)",
      borderWidth: 1,
      titleColor: "#c8aa6d",
      bodyColor: "#f0e6d2",
      padding: 10,
      callbacks: {
        afterLabel: (context: { dataIndex: number }) => `${props.rows[context.dataIndex]?.games ?? 0} games`,
      },
    },
  },
}))
</script>

<template>
  <div class="outcome-trend">
    <Line :data="chartData" :options="chartOptions" />
  </div>
  <ul class="outcome-key">
    <li v-for="row in rows" :key="row.label">
      <span>{{ row.label }}</span>
      <span class="numeric">{{ row.games ? `${Math.round(row.winRate * 100)}%` : "-" }}</span>
      <span class="muted numeric">{{ row.games }}</span>
    </li>
  </ul>
</template>

<style scoped>
.outcome-trend {
  height: 210px;
  position: relative;
}

.outcome-key {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-1) var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
}

.outcome-key li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-2);
}
</style>