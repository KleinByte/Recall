<script setup lang="ts">
import { computed } from "vue"
import {
  BarElement,
  BarController,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js"
import { Chart } from "vue-chartjs"

const props = defineProps<{
  rows: Array<{ label: string; games: number; wins?: number; winRate: number }>
}>()

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
)

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

const chartData = computed(() => ({
  labels: props.rows.map((row) => row.label),
  datasets: [
    {
      type: "bar" as const,
      label: "Recorded games",
      data: props.rows.map((row) => row.games),
      yAxisID: "games",
      backgroundColor: props.rows.map((row) =>
        row.games === 0 ? "rgba(160, 155, 140, 0.18)" : row.winRate >= 0.5
          ? "rgba(28, 191, 138, 0.58)"
          : "rgba(232, 64, 87, 0.56)",
      ),
      borderColor: props.rows.map((row) => row.winRate >= 0.5 ? "#1cbf8a" : "#e84057"),
      borderWidth: 1,
      borderRadius: 4,
      borderSkipped: false,
      order: 2,
    },
    {
      type: "line" as const,
      label: "Recorded win rate",
      data: props.rows.map((row) => row.games ? Math.round(row.winRate * 100) : null),
      yAxisID: "rate",
      borderColor: "#0acbe6",
      backgroundColor: "rgba(10, 203, 230, 0.18)",
      pointBackgroundColor: "#f0e6d2",
      pointBorderColor: "#0acbe6",
      pointHoverRadius: 5,
      pointRadius: 4,
      borderWidth: 2.5,
      tension: 0.32,
      fill: true,
      spanGaps: false,
      order: 1,
    },
  ],
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
    games: {
      beginAtZero: true,
      grid: { display: false },
      ticks: { color: "#a09b8c", precision: 0 },
      title: { display: true, text: "Games", color: "#a09b8c", font: { size: 10 } },
    },
    rate: {
      position: "right" as const,
      min: 0,
      max: 100,
      grid: { color: "rgba(200, 170, 109, 0.14)", drawOnChartArea: true },
      ticks: { color: "#a09b8c", callback: (value: number | string) => `${value}%` },
      title: { display: true, text: "Win rate", color: "#a09b8c", font: { size: 10 } },
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
        afterBody: (items: Array<{ dataIndex: number }>) => {
          const row = props.rows[items[0]?.dataIndex]
          return row ? [`${row.wins ?? Math.round(row.winRate * row.games)} wins from ${row.games} games`] : []
        },
      },
    },
  },
}))
</script>

<template>
  <div class="outcome-trend">
    <Chart type="bar" :data="chartData" :options="chartOptions" />
  </div>
  <ul class="outcome-key">
    <li v-for="row in rows" :key="row.label" :class="{ empty: !row.games }">
      <span class="band-label">{{ row.label }}</span>
      <span class="numeric rate" :class="row.winRate >= 0.5 ? 'positive' : 'negative'">
        {{ row.games ? `${Math.round(row.winRate * 100)}%` : "–" }}
      </span>
      <span class="muted numeric">{{ row.games }} games</span>
    </li>
  </ul>
</template>

<style scoped>
.outcome-trend {
  height: 240px;
  position: relative;
}

.outcome-key {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
}

.outcome-key li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  padding: var(--space-2);
  border-left: 2px solid var(--cyan);
  background: var(--surface-2);
}

.outcome-key .band-label {
  color: var(--text-primary);
}

.outcome-key .rate {
  font-size: 12px;
}

.outcome-key .positive {
  color: var(--win);
}

.outcome-key .negative {
  color: var(--loss);
}

.outcome-key .empty {
  border-left-color: var(--border-subtle);
  opacity: 0.55;
}
</style>