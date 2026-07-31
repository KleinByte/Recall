<script setup lang="ts">
import { computed } from "vue"
import {
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js"
import { Line } from "vue-chartjs"
import type { StyleAxis } from "../types/stats"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip)

const props = defineProps<{
  /** Oldest window first; each entry is one window's axes. */
  windows: { label: string; axes: StyleAxis[] }[]
}>()

/** Enough separation that six lines stay tellable apart on a dark ground. */
const COLOURS = [
  "#c8aa6d",
  "#0acbe6",
  "#e84057",
  "#a09b8c",
  "#0397ab",
  "#f0e6d2",
]

const chartData = computed(() => {
  const first = props.windows[0]?.axes ?? []

  return {
    labels: props.windows.map((window) => window.label),
    datasets: first.map((axis, index) => ({
      label: axis.label,
      data: props.windows.map((window) => {
        const match = window.axes.find((entry) => entry.key === axis.key)
        return Math.round((match?.value ?? 0) * 100)
      }),
      borderColor: COLOURS[index % COLOURS.length],
      backgroundColor: COLOURS[index % COLOURS.length],
      pointRadius: 2,
      borderWidth: 1.5,
      tension: 0.25,
    })),
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 520,
  },
  interaction: { mode: "index" as const, intersect: false },
  scales: {
    x: {
      grid: { color: "rgba(200, 170, 109, 0.10)" },
      ticks: { color: "#6b6863", font: { size: 10 } },
    },
    y: {
      min: 0,
      max: 100,
      grid: { color: "rgba(200, 170, 109, 0.14)" },
      ticks: {
        color: "#a09b8c",
        font: { size: 10 },
        callback: (value: number | string) => `${value}%`,
      },
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
    },
  },
}
</script>

<template>
  <div>
    <div class="graph">
      <Line :data="chartData" :options="chartOptions" />
    </div>

    <ul class="key">
      <li v-for="(set, index) in chartData.datasets" :key="set.label">
        <span
          class="swatch"
          :style="{ background: COLOURS[index % COLOURS.length] }"
        />
        <span class="muted">{{ set.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.graph {
  height: 200px;
  position: relative;
}

.key {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 11px;
}

.key li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.swatch {
  width: 10px;
  height: 2px;
  border-radius: 1px;
}
</style>
