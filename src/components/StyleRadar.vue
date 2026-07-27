<script setup lang="ts">
import { computed } from "vue"
import {
  Chart as ChartJS,
  Filler,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
} from "chart.js"
import { Radar } from "vue-chartjs"
import type { StyleAxis } from "../types/stats"

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip)

const props = defineProps<{
  axes: StyleAxis[]
  recent?: StyleAxis[]
  primaryLabel?: string
  secondaryLabel?: string
}>()

const GOLD = "#c8aa6d"
const CYAN = "#0acbe6"

const toPercent = (axes: StyleAxis[]) =>
  axes.map((axis) => Math.round(axis.value * 100))

const chartData = computed(() => {
  const datasets = [
    {
      label: props.primaryLabel ?? "All games",
      data: toPercent(props.axes),
      borderColor: GOLD,
      backgroundColor: "rgba(200, 170, 109, 0.22)",
      pointBackgroundColor: GOLD,
      pointBorderColor: GOLD,
      pointRadius: 3,
      borderWidth: 2,
    },
  ]

  if (props.recent) {
    datasets.push({
      label: props.secondaryLabel ?? "Last 10 games",
      data: toPercent(props.recent),
      borderColor: CYAN,
      backgroundColor: "rgba(10, 203, 230, 0.10)",
      pointBackgroundColor: CYAN,
      pointBorderColor: CYAN,
      pointRadius: 2,
      borderWidth: 1,
    })
  }

  return { labels: props.axes.map((axis) => axis.label), datasets }
})

/** Descriptions keyed by label, so the tooltip can explain each spoke. */
const descriptions = computed(() =>
  Object.fromEntries(props.axes.map((axis) => [axis.label, axis.description])),
)

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  // Chart.js reserves the container for point labels and draws the web inside
  // what is left, so trimming the padding is what actually makes it bigger.
  layout: { padding: 8 },
  scales: {
    r: {
      min: 0,
      max: 100,
      angleLines: { color: "rgba(200, 170, 109, 0.18)" },
      grid: { color: "rgba(200, 170, 109, 0.18)" },
      pointLabels: {
        color: "#f0e6d2",
        padding: 4,
        font: { family: "BeaufortforLOL Medium, serif", size: 11 },
      },
      ticks: {
        display: false,
        // Rings still step every 20% even though the numbers are hidden.
        stepSize: 20,
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
      callbacks: {
        label: (context: { dataset: { label?: string }; parsed: { r: number } }) =>
          `${context.dataset.label}: ${context.parsed.r}%`,
        afterBody: (items: { label: string }[]) => {
          const description = descriptions.value[items[0]?.label]
          return description ? [description] : []
        },
      },
    },
  },
}))
</script>

<template>
  <div class="radar">
    <Radar :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
/* Chart.js sizes a radar by the smaller side, so height is what actually makes
   the web bigger. The cap stops it stranding itself in a very wide column. */
.radar {
  height: 520px;
  max-width: 680px;
  margin: 0 auto;
  position: relative;
}
</style>
