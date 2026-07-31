<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { init, type ECharts, type EChartsCoreOption } from "echarts/core"
import { registerBaseCharts } from "../../charts/register-base"
import { RECALL_CHART_THEME } from "../../charts/recall-chart-theme"

registerBaseCharts()

const props = withDefaults(defineProps<{
  option: EChartsCoreOption
  ariaLabel: string
  height?: string
  replaceMerge?: string[]
}>(), {
  height: "240px",
  replaceMerge: () => ["series", "dataset"],
})

const root = ref<HTMLElement>()
let chart: ECharts | undefined
let observer: ResizeObserver | undefined

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

const preparedOption = computed<EChartsCoreOption>(() => ({
  animation: !reducedMotion(),
  animationDuration: reducedMotion() ? 0 : 520,
  animationDurationUpdate: reducedMotion() ? 0 : 240,
  aria: {
    enabled: true,
    description: props.ariaLabel,
  },
  ...props.option,
}))

function update() {
  if (!chart) return
  chart.setOption(preparedOption.value, {
    notMerge: false,
    lazyUpdate: true,
    replaceMerge: props.replaceMerge,
  })
}

onMounted(() => {
  if (!root.value) return
  chart = init(root.value, RECALL_CHART_THEME, { renderer: "canvas" })
  update()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(root.value)
})

watch(preparedOption, update, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = undefined
  chart?.dispose()
  chart = undefined
})
</script>

<template>
  <div
    ref="root"
    class="base-echart"
    role="img"
    :aria-label="ariaLabel"
    :style="{ height }"
  />
</template>

<style scoped>
.base-echart {
  width: 100%;
  min-width: 0;
}
</style>
