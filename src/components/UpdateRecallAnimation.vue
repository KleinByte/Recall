<script setup lang="ts">
import { computed } from "vue"
import RecallMark from "./RecallMark.vue"

const props = defineProps<{
  phase: "startup" | "channeling" | "installing" | "arrival"
  version?: string
}>()

const eyebrow = computed(() => {
  if (props.phase === "channeling") return "Update channeling"
  if (props.phase === "installing") return "Update in progress"
  if (props.phase === "arrival") return "Recall complete"
  return "B-ing back"
})

const headline = computed(() => {
  if (props.phase === "channeling") return `Preparing Recall ${props.version || ""}`
  if (props.phase === "installing") return `Installing Recall ${props.version || ""}`
  if (props.phase === "arrival") return `Welcome to Recall ${props.version || ""}`
  return ""
})
</script>

<template>
  <section
    class="update-recall"
    :class="`phase-${props.phase}`"
    role="status"
    aria-live="assertive"
  >
    <div class="recall-scene" aria-hidden="true">
      <span class="beam beam-wide" />
      <span class="beam beam-core" />
      <span
        v-for="index in 12"
        :key="index"
        class="particle"
        :style="{ '--particle': index }"
      />
      <div class="recall-platform">
        <i /><i /><i />
      </div>
      <div class="completion-burst" />
      <RecallMark animated class="update-recall-mark" />
    </div>

    <div class="recall-copy">
      <span>{{ eyebrow }}</span>
      <strong v-if="headline">{{ headline }}</strong>
    </div>
  </section>
</template>

<style scoped>
.update-recall {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-content: center;
  overflow: hidden;
  color: var(--text-primary);
  background:
    radial-gradient(circle at 50% 52%, rgba(12, 188, 220, 0.14), transparent 25%),
    radial-gradient(circle at 50% 45%, rgba(200, 170, 109, 0.08), transparent 38%),
    rgba(3, 8, 16, 0.96);
  backdrop-filter: blur(12px);
}

.phase-channeling {
  animation: channel-overlay 2.6s ease both;
}

.phase-installing {
  opacity: 1;
}

.phase-startup {
  animation: arrival-overlay 2.7s ease both;
}

.phase-arrival {
  animation: arrival-overlay 2.7s ease both;
}

.recall-scene {
  position: relative;
  width: min(330px, 54vw);
  aspect-ratio: 1;
  margin-inline: auto;
  isolation: isolate;
  filter: drop-shadow(0 0 30px rgba(10, 203, 230, 0.14));
}

.update-recall-mark {
  position: absolute;
  inset: 5%;
  z-index: 4;
}

.phase-channeling .update-recall-mark {
  animation: logo-channel 2.6s cubic-bezier(.35, .02, .22, 1) both;
}

.phase-installing .update-recall-mark {
  animation: logo-installing 1.6s ease-in-out infinite alternate;
}

.phase-startup .update-recall-mark {
  animation: logo-arrive 2.7s cubic-bezier(.18, .7, .2, 1) both;
}

.phase-arrival .update-recall-mark {
  animation: logo-arrive 2.7s cubic-bezier(.18, .7, .2, 1) both;
}

.beam {
  position: absolute;
  top: 8%;
  bottom: 12%;
  left: 50%;
  z-index: 1;
  display: block;
  transform: translateX(-50%);
  transform-origin: bottom;
  clip-path: polygon(42% 0, 58% 0, 100% 100%, 0 100%);
}

.beam-wide {
  width: 58%;
  background: linear-gradient(90deg, transparent, rgba(29, 204, 236, 0.14), transparent);
  filter: blur(9px);
}

.beam-core {
  width: 18%;
  background: linear-gradient(90deg, transparent, rgba(163, 248, 255, 0.72), transparent);
  filter: blur(3px);
}

.phase-channeling .beam {
  animation: beam-channel 2.6s ease-in both;
}

.phase-installing .beam {
  animation: beam-installing 1.6s ease-in-out infinite alternate;
}

.phase-startup .beam {
  animation: beam-arrive 2.7s ease-out both;
}

.phase-arrival .beam {
  animation: beam-arrive 2.7s ease-out both;
}

.recall-platform {
  position: absolute;
  right: 9%;
  bottom: 8%;
  left: 9%;
  z-index: 2;
  height: 24%;
  border: 2px solid rgba(65, 225, 246, 0.92);
  border-radius: 50%;
  box-shadow:
    0 0 12px rgba(10, 203, 230, 0.85),
    0 0 42px rgba(10, 203, 230, 0.35),
    inset 0 0 22px rgba(10, 203, 230, 0.3);
  transform: perspective(220px) rotateX(66deg);
}

.recall-platform i {
  position: absolute;
  border: 1px solid rgba(143, 244, 255, 0.72);
  border-radius: inherit;
}

.recall-platform i:nth-child(1) { inset: 10%; }
.recall-platform i:nth-child(2) { inset: 20%; }
.recall-platform i:nth-child(3) { inset: 30%; }

.phase-channeling .recall-platform,
.phase-installing .recall-platform {
  animation: platform-channel 1.15s ease-in-out infinite alternate;
}

.phase-startup .recall-platform {
  animation: platform-arrive 2.7s ease-out both;
}

.phase-arrival .recall-platform {
  animation: platform-arrive 2.7s ease-out both;
}

.particle {
  --angle: calc(var(--particle) * 30deg);
  position: absolute;
  bottom: 17%;
  left: 50%;
  z-index: 3;
  width: 3px;
  height: 3px;
  background: #9df7ff;
  border-radius: 50%;
  box-shadow: 0 0 8px #2de0f3;
  transform: rotate(var(--angle)) translateX(58px);
}

.phase-channeling .particle,
.phase-installing .particle {
  animation: particle-rise 1.35s calc(var(--particle) * -90ms) linear infinite;
}

.phase-startup .particle {
  animation: particle-burst 1s calc(1.28s + var(--particle) * 18ms) ease-out both;
}

.phase-arrival .particle {
  animation: particle-burst 1s calc(1.28s + var(--particle) * 18ms) ease-out both;
}

.completion-burst {
  position: absolute;
  inset: 21%;
  z-index: 5;
  opacity: 0;
  border: 2px solid rgba(191, 250, 255, 0.95);
  border-radius: 50%;
  box-shadow: 0 0 28px rgba(10, 203, 230, 0.75);
}

.phase-startup .completion-burst,
.phase-arrival .completion-burst {
  animation: completion-burst 1s 1.45s ease-out both;
}

.recall-copy {
  position: relative;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  margin-top: -18px;
  text-align: center;
}

.recall-copy span {
  color: var(--cyan);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2.4px;
  text-transform: uppercase;
}

.recall-copy strong {
  color: var(--gold-bright);
  font: 500 19px var(--font-heading);
  letter-spacing: .7px;
}

@keyframes channel-overlay {
  0% { opacity: 0; }
  12%, 88% { opacity: 1; }
  100% { opacity: .98; }
}

@keyframes arrival-overlay {
  0% { opacity: 1; }
  78% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes logo-channel {
  0% { opacity: 0; transform: translateY(18px) scale(.78); filter: blur(2px); }
  18% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
  68% { opacity: 1; transform: translateY(-4px) scale(1.02); }
  100% { opacity: 0; transform: translateY(-150px) scale(.48); filter: blur(4px); }
}

@keyframes logo-arrive {
  0% { opacity: 0; transform: translateY(-150px) scale(.48); filter: blur(5px); }
  26% { opacity: 1; transform: translateY(-8px) scale(.94); filter: blur(0); }
  62% { transform: translateY(0) scale(1); }
  76% { transform: translateY(0) scale(1.08); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes logo-installing {
  from { opacity: .72; transform: translateY(2px) scale(.98); }
  to { opacity: 1; transform: translateY(-3px) scale(1.02); }
}

@keyframes beam-channel {
  0% { opacity: 0; transform: translateX(-50%) scaleY(.15); }
  30% { opacity: .7; transform: translateX(-50%) scaleY(1); }
  78% { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) scaleY(1.35); }
}

@keyframes beam-arrive {
  0% { opacity: 0; transform: translateX(-50%) scaleY(1.4); }
  18% { opacity: 1; }
  72% { opacity: .8; transform: translateX(-50%) scaleY(1); }
  100% { opacity: 0; }
}

@keyframes beam-installing {
  from { opacity: .3; transform: translateX(-50%) scaleY(.8); }
  to { opacity: .9; transform: translateX(-50%) scaleY(1.1); }
}

@keyframes platform-channel {
  from { opacity: .72; filter: brightness(.85); }
  to { opacity: 1; filter: brightness(1.35); }
}

@keyframes platform-arrive {
  0% { opacity: 0; transform: perspective(220px) rotateX(66deg) scale(.35); }
  35% { opacity: 1; transform: perspective(220px) rotateX(66deg) scale(1); }
  72% { filter: brightness(1.65); }
  100% { opacity: .85; filter: brightness(1); }
}

@keyframes particle-rise {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(58px) translateY(8px) scale(.5); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateX(32px) translateY(-160px) scale(1.3); }
}

@keyframes particle-burst {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(18px) scale(.4); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateX(148px) scale(1.8); }
}

@keyframes completion-burst {
  0% { opacity: 0; transform: scale(.25); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: scale(2.25); }
}

@media (prefers-reduced-motion: reduce) {
  .update-recall,
  .update-recall *,
  .update-recall *::before,
  .update-recall *::after {
    animation: none !important;
  }

  .update-recall-mark,
  .recall-platform,
  .beam {
    opacity: 1;
  }
}
</style>
