<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  grade?: string
  size?: "sm" | "lg"
}>()

/** Colour bands follow the letter, so S is unmistakably better than C. */
const tier = computed(() => {
  if (!props.grade) return "none"
  return props.grade.charAt(0).toLowerCase()
})
</script>

<template>
  <span
    class="grade"
    :class="[tier, size ?? 'sm']"
    :title="grade ? `Performance grade ${grade}` : 'Not graded yet'"
  >
    {{ grade ?? "–" }}
  </span>
</template>

<style scoped>
.grade {
  display: inline-grid;
  place-items: center;
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  line-height: 1;
}

.grade.sm {
  min-width: 30px;
  padding: 3px 5px;
  font-size: 12px;
}

.grade.lg {
  min-width: 52px;
  padding: var(--space-2) var(--space-3);
  font-size: 22px;
}

.grade.s {
  color: #ffd88a;
  background: rgba(200, 155, 60, 0.16);
  border-color: #c89b3c;
}

.grade.a {
  color: #0acbe6;
  background: rgba(10, 203, 230, 0.12);
  border-color: rgba(10, 203, 230, 0.55);
}

.grade.b {
  color: #9aa4b0;
  background: rgba(154, 164, 176, 0.1);
  border-color: rgba(154, 164, 176, 0.4);
}

.grade.c {
  color: #c9834a;
  background: rgba(201, 131, 74, 0.1);
  border-color: rgba(201, 131, 74, 0.4);
}

.grade.d {
  color: var(--loss);
  background: rgba(232, 64, 87, 0.1);
  border-color: rgba(232, 64, 87, 0.45);
}

.grade.none {
  color: var(--text-muted);
  border-color: var(--border-subtle);
}
</style>
