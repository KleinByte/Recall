<script setup lang="ts">
const props = defineProps<{ value: number; strong?: boolean }>()

/** Clamped, so a stray value can never draw past the end of the track. */
const width = () => `${Math.min(100, Math.max(0, props.value * 100))}%`
</script>

<template>
  <span class="track">
    <span class="fill" :class="{ strong }" :style="{ width: width() }" />
  </span>
</template>
