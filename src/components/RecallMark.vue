<script setup lang="ts">
import { computed } from "vue"
import { publicAssetUrl } from "../helpers/assets"

const props = withDefaults(defineProps<{
  variant?: "logo" | "letter"
  animated?: boolean
}>(), {
  variant: "logo",
  animated: false,
})

const assetName = computed(() => (
  props.variant === "letter" ? "recall-r.png" : "recall-icon.png"
))
</script>

<template>
  <span
    class="recall-mark"
    :class="[
      `recall-mark--${variant}`,
      { 'is-animated': animated && variant === 'logo' },
    ]"
    role="presentation"
    aria-hidden="true"
  >
    <img
      :src="publicAssetUrl(assetName)"
      alt=""
      draggable="false"
    >
  </span>
</template>

<style scoped>
.recall-mark {
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  pointer-events: none;
}

.recall-mark img {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}

.recall-mark--logo.is-animated::before,
.recall-mark--logo.is-animated::after {
  position: absolute;
  right: 17%;
  bottom: 10%;
  left: 17%;
  z-index: 0;
  height: 8%;
  content: "";
  opacity: 0;
  border: 1px solid rgba(44, 225, 244, 0.84);
  border-radius: 50%;
  box-shadow: 0 0 6px rgba(17, 199, 217, 0.62);
  transform: scale(0.62);
  animation: recall-mark-wave 2.8s ease-out infinite;
}

.recall-mark--logo.is-animated::after {
  animation-delay: 1.4s;
}

@keyframes recall-mark-wave {
  0% {
    opacity: 0;
    transform: scale(0.62);
  }

  18% {
    opacity: 0.78;
  }

  100% {
    opacity: 0;
    transform: scale(1.52);
  }
}

@media (prefers-reduced-motion: reduce) {
  .recall-mark--logo.is-animated::before,
  .recall-mark--logo.is-animated::after {
    opacity: 0.35;
    transform: none;
    animation: none;
  }

  .recall-mark--logo.is-animated::after {
    display: none;
  }
}
</style>
