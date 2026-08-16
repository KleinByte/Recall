<script setup lang="ts">
import { computed } from "vue"
import { publicAssetUrl } from "../helpers/assets"
import HoverCard from "./ui/HoverCard.vue"

const props = defineProps<{
  grade?: string
  status?: string
  size?: "sm" | "lg"
}>()

const isBuilding = computed(() => !props.grade && props.status === "calibrating")
const description = computed(() => {
  if (props.grade) return `Performance grade ${props.grade}`
  if (isBuilding.value) {
    return "Grade is still building while Recall creates this mode's comparison baseline"
  }
  return "Not graded"
})

/** Colour bands follow the letter, so S is unmistakably better than C. */
const tier = computed(() => {
  if (isBuilding.value) return "building"
  if (!props.grade) return "none"
  return props.grade.charAt(0).toLowerCase()
})

const hammerIconUrl = publicAssetUrl("items/3133.png")
</script>

<template>
  <HoverCard
    v-if="isBuilding"
    class="grade-building-anchor"
    :label="description"
    :width="310"
  >
    <span
      class="grade building"
      :class="size ?? 'sm'"
      aria-hidden="true"
    >
      <img :src="hammerIconUrl" alt="" />
      <i aria-hidden="true" />
    </span>

    <template #content>
      <section class="grade-build-card">
        <header>
          <span class="forge-icon"><img :src="hammerIconUrl" alt="Caulfield's Warhammer" /></span>
          <span>
            <small>Recall grade · Grade forge</small>
            <strong>Baseline under construction</strong>
          </span>
        </header>
        <p>
          Recall is collecting enough games in this mode to build a fair comparison baseline.
          This match is saved and will be graded automatically when that baseline freezes.
        </p>
        <ol aria-label="Grade building steps">
          <li class="active"><b>1</b><span>Collect mode games</span></li>
          <li><b>2</b><span>Freeze baseline</span></li>
          <li><b>3</b><span>Forge grade</span></li>
        </ol>
      </section>
    </template>
  </HoverCard>

  <span
    v-else
    class="grade"
    :class="[tier, size ?? 'sm']"
    :title="description"
    :aria-label="description"
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

.grade.building {
  position: relative;
  width: 26px;
  min-width: 26px;
  padding: 2px;
  overflow: visible;
  border-color: color-mix(in srgb, var(--ui-accent) 56%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-accent) 8%, var(--ui-surface-inset));
  cursor: help;
  isolation: isolate;
}

.grade.building.lg {
  width: 36px;
  min-width: 36px;
  padding: 3px;
}

.grade.building img {
  width: 100%;
  height: 100%;
  border-radius: 3px;
  object-fit: cover;
}

.grade.building i {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ui-surface-inset-color);
  border-radius: 50%;
  background: var(--ui-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 72%, transparent);
}

.grade-building-anchor { border-radius: 5px; }

.grade-build-card { padding: 15px; }
.grade-build-card header { display: flex; align-items: center; gap: 11px; }
.grade-build-card header > span:last-child { display: grid; gap: 2px; }
.grade-build-card header small { color: var(--ui-accent-strong); font: var(--ui-text-label) var(--ui-font-heading); letter-spacing: 1.1px; text-transform: uppercase; }
.grade-build-card header strong { color: var(--ui-text-heading); font: 16px var(--ui-font-display); letter-spacing: .35px; }
.forge-icon { width: 43px; height: 43px; padding: 3px; border: 1px solid color-mix(in srgb, var(--ui-accent) 52%, var(--ui-border)); border-radius: 7px; background: var(--ui-surface-inset); box-shadow: 0 0 20px color-mix(in srgb, var(--ui-accent) 12%, transparent); }
.forge-icon img { width: 100%; height: 100%; border-radius: 4px; object-fit: cover; }
.grade-build-card p { margin: 12px 0; color: var(--ui-text-muted); font-size: var(--ui-text-body); line-height: 1.5; }
.grade-build-card ol { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 0; padding: 0; list-style: none; }
.grade-build-card li { display: grid; justify-items: center; gap: 4px; min-width: 0; padding-top: 8px; border-top: 1px solid var(--ui-divider); color: var(--ui-text-muted); font-size: var(--ui-text-micro); text-align: center; }
.grade-build-card li b { display: grid; place-items: center; width: 19px; height: 19px; border: 1px solid var(--ui-border); border-radius: 50%; color: var(--ui-text-muted); font-size: var(--ui-text-micro); }
.grade-build-card li.active { border-color: color-mix(in srgb, var(--ui-accent) 62%, var(--ui-divider)); color: var(--ui-accent-strong); }
.grade-build-card li.active b { border-color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 15%, transparent); color: var(--ui-accent-strong); }

@media (prefers-reduced-motion: no-preference) {
  .grade.building i { animation: forge-pulse 1.6s ease-in-out infinite; }
}

@keyframes forge-pulse {
  50% { opacity: .45; transform: scale(.78); }
}
</style>
