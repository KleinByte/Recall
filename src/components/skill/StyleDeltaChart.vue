<script setup lang="ts">
import { computed } from "vue"
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  LinearScale,
  Tooltip,
  type TooltipItem,
} from "chart.js"
import { Bar } from "vue-chartjs"
import type { StyleAxis } from "../../types/stats"

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{
  baseline: StyleAxis[]
  recent: StyleAxis[]
}>()

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

const changes = computed(() => props.baseline.map((axis) => ({
  label: axis.label,
  value: Math.round(((props.recent.find((entry) => entry.key === axis.key)?.value ?? axis.value) - axis.value) * 100),
})))

const chartData = computed(() => ({
  labels: changes.value.map((change) => change.label),
  datasets: [{
    data: changes.value.map((change) => change.value),
    backgroundColor: changes.value.map((change) => change.value >= 0 ? "#0acbe6" : "#e84057"),
    borderRadius: 3,
    borderSkipped: false,
  }],
}))

const chartOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: "y" as const,
  animation: { duration: reducedMotion() ? 0 : 520 },
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
        label: (context: TooltipItem<"bar">) => {
          const value = context.parsed.x ?? 0
          return `${value > 0 ? "+" : ""}${value} percentage points`
        },
      },
    },
  },
  scales: {
    x: {
      grid: { color: "rgba(200, 170, 109, 0.14)" },
      ticks: {
        color: "#a09b8c",
        callback: (value) => {
          const numericValue = Number(value)
          return `${numericValue > 0 ? "+" : ""}${value}pp`
        },
      },
    },
    y: {
      grid: { display: false },
      ticks: { color: "#f0e6d2", font: { size: 11 } },
    },
  },
}))
</script>

<template>
  <div class="style-delta">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.style-delta {
  height: 260px;
  position: relative;
}
</style>
