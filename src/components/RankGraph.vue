<script setup lang="ts">
import { computed } from "vue"
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js"
import { Line } from "vue-chartjs"
import type { RankedPoint } from "../types/stats"

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
)

const props = defineProps<{ points: RankedPoint[] }>()

const GOLD = "#c8aa6d"

const chartData = computed(() => ({
  labels: props.points.map((point) =>
    new Date(point.recordedAt).toLocaleDateString(),
  ),
  datasets: [
    {
      label: "Rank",
      data: props.points.map((point) => point.points),
      borderColor: GOLD,
      backgroundColor: "rgba(200, 170, 109, 0.16)",
      pointBackgroundColor: GOLD,
      pointRadius: 2,
      borderWidth: 2,
      fill: true,
      tension: 0.2,
    },
  ],
}))

/** Rank names rather than raw points, which mean nothing on their own. */
const labelFor = (value: number) => {
  const nearest = props.points.reduce((best, point) =>
    Math.abs(point.points - value) < Math.abs(best.points - value) ? point : best,
  )
  return nearest.label
}

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      grid: { color: "rgba(200, 170, 109, 0.10)" },
      ticks: { color: "#6b6863", font: { size: 10 }, maxTicksLimit: 8 },
    },
    y: {
      grid: { color: "rgba(200, 170, 109, 0.14)" },
      ticks: {
        color: "#a09b8c",
        font: { size: 10 },
        maxTicksLimit: 6,
        callback: (value: number | string) => labelFor(Number(value)),
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
        label: (context: { dataIndex: number }) => {
          const point = props.points[context.dataIndex]
          return `${point.label} · ${point.leaguePoints} LP`
        },
        afterBody: (items: { dataIndex: number }[]) => {
          const point = props.points[items[0].dataIndex]
          return [`${point.wins}W ${point.losses}L`]
        },
      },
    },
  },
}))
</script>

<template>
  <div class="graph">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.graph {
  height: 240px;
  position: relative;
}
</style>
