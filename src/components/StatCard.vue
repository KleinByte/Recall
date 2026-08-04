<script setup lang="ts">
import StatTile from "./ui/StatTile.vue"

defineProps<{
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
}>()
</script>

<template>
  <!-- Compatibility wrapper; StatTile is the canonical metric primitive. -->
  <StatTile :label="label" :value="value" :hint="hint" :tone="tone" />
</template>
