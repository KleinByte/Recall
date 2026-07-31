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

const props = defineProps<{
  entries: Array<{ label: string; value: number }>
  unit: "grade" | "percentage-points"
}>()

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

const chartData = computed(() => ({
  labels: props.entries.map((entry) => entry.label),
  datasets: [{
    data: props.entries.map((entry) => entry.value),
    backgroundColor: props.entries.map((entry) => entry.value >= 0 ? "#0acbe6" : "#e84057"),
    borderRadius: 3,
    borderSkipped: false,
  }],
}))

const suffix = computed(() => props.unit === "grade" ? " Recall grade" : " pp")
const chartHeight = computed(() => `${Math.max(190, props.entries.length * 38 + 56)}px`)

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
          return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix.value}`
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
          return `${numericValue > 0 ? "+" : ""}${value}${props.unit === "percentage-points" ? "pp" : ""}`
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
  <div class="effect-chart" :style="{ height: chartHeight }">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.effect-chart {
  position: relative;
}
</style>
