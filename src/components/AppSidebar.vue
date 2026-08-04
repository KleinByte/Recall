<script setup lang="ts">
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faAnglesLeft,
  faAnglesRight,
  faRotate,
} from "@fortawesome/free-solid-svg-icons"
import { publicAssetUrl } from "../helpers/assets"
import type { Summoner } from "../types/lol"
import type { PageId } from "../helpers/navigation"
import RecallMark from "./RecallMark.vue"

defineProps<{
  page: PageId
  connected: boolean
  summoner: Summoner | null
  refreshing: boolean
  refreshMessage: string | null
  collapsed: boolean
}>()

const emit = defineEmits<{
  (event: "update:page", value: PageId): void
  (event: "update:collapsed", value: boolean): void
  (event: "refresh"): void
}>()

type NavigationArt = "glyph"

interface NavigationItem {
  id: PageId
  label: string
  hint: string
  art: string
  artType: NavigationArt
}

interface NavigationSection {
  label: string
  items: NavigationItem[]
}

const sidebarIconUrl = (name: PageId) =>
  publicAssetUrl(`game-data/ui/sidebar/${name}.svg`)

const sidebarStyle = {
  "--sidebar-map-image": `url("${publicAssetUrl("game-data/ui/map11.png")}")`,
}

const navSections: NavigationSection[] = [
  {
    label: "Command",
    items: [
      { id: "dashboard", label: "Dashboard", hint: "Performance view", art: sidebarIconUrl("dashboard"), artType: "glyph" },
      { id: "live", label: "Live Game", hint: "Current match", art: sidebarIconUrl("live"), artType: "glyph" },
    ],
  },
  {
    label: "Archive",
    items: [
      { id: "review", label: "Review", hint: "Post-game lab", art: sidebarIconUrl("review"), artType: "glyph" },
      { id: "matches", label: "Matches", hint: "Match history", art: sidebarIconUrl("matches"), artType: "glyph" },
    ],
  },
  {
    label: "Growth",
    items: [
      { id: "skill", label: "Skill", hint: "Patterns & form", art: sidebarIconUrl("skill"), artType: "glyph" },
      { id: "progress", label: "Progress", hint: "Rank & records", art: sidebarIconUrl("progress"), artType: "glyph" },
      { id: "champions", label: "Champions", hint: "Pool mastery", art: sidebarIconUrl("champions"), artType: "glyph" },
      { id: "challenges", label: "Challenges", hint: "Collection goals", art: sidebarIconUrl("challenges"), artType: "glyph" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "settings", label: "Settings", hint: "App & data", art: sidebarIconUrl("settings"), artType: "glyph" },
    ],
  },
]
</script>

<template>
  <nav class="sidebar" :class="{ collapsed }" :style="sidebarStyle">
    <div class="brand">
      <div class="brand-row">
        <Transition name="brand-recall" mode="out-in">
          <div
            v-if="collapsed"
            key="collapsed-logo"
            class="brand-title brand-title-collapsed"
            aria-label="Recall"
          >
            <RecallMark animated class="brand-logo brand-logo-collapsed" />
          </div>
          <div
            v-else
            key="expanded-wordmark"
            class="brand-title brand-title-expanded"
            aria-label="Recall"
          >
            <RecallMark variant="letter" class="brand-logo" />
            <span class="brand-mark">ECALL</span>
          </div>
        </Transition>
        <button
          class="collapse-toggle"
          type="button"
          :aria-label="collapsed ? 'Expand navigation' : 'Collapse navigation'"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Expand navigation' : 'Collapse navigation'"
          @click="emit('update:collapsed', !collapsed)"
        >
          <FontAwesomeIcon :icon="collapsed ? faAnglesRight : faAnglesLeft" fixed-width />
        </button>
      </div>
      <Transition name="brand-subtitle">
        <span v-if="!collapsed" class="brand-name">League companion</span>
      </Transition>
    </div>

    <ul class="nav">
      <li v-for="section in navSections" :key="section.label" class="nav-section">
        <p v-if="!collapsed" class="nav-section-label">{{ section.label }}</p>
        <ul class="nav-group">
          <li v-for="item in section.items" :key="item.id">
            <button
              class="nav-item"
              :class="{ active: page === item.id }"
              :title="collapsed ? item.label : undefined"
              :aria-current="page === item.id ? 'page' : undefined"
              @click="emit('update:page', item.id)"
            >
              <span class="nav-emblem" :class="`art-${item.artType}`" aria-hidden="true">
                <img class="nav-art" :src="item.art" alt="" />
              </span>
              <span v-if="!collapsed" class="nav-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ item.hint }}</small>
              </span>
            </button>
          </li>
        </ul>
      </li>
    </ul>

    <button
      class="refresh"
      :disabled="refreshing || !connected"
      :title="connected ? 'Refresh matches, challenges, profile, and ranked data' : 'Start League before refreshing'"
      :aria-label="refreshing ? 'Refreshing' : 'Refresh'"
      @click="emit('refresh')"
    >
      <FontAwesomeIcon :icon="faRotate" :class="{ spinning: refreshing }" fixed-width />
      <span v-if="!collapsed">{{ refreshing ? "Refreshing…" : "Refresh" }}</span>
    </button>
    <p v-if="refreshMessage && !collapsed" class="refresh-message" role="status">
      {{ refreshMessage }}
    </p>

    <div class="status">
      <div class="status-row">
        <span class="dot" :class="{ online: connected }" />
        <span v-if="!collapsed" class="status-text">
          {{ connected ? "Client connected" : "Client not detected" }}
        </span>
      </div>
      <div v-if="summoner && !collapsed" class="summoner">
        {{ summoner.gameName }}
        <span class="tag">#{{ summoner.tagLine }}</span>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: var(--ui-sidebar-width);
  flex: 0 0 var(--ui-sidebar-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 20% 8%, color-mix(in srgb, var(--ui-live) 9%, transparent), transparent 24%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--ui-accent) 8%, transparent),
      transparent 22%,
      color-mix(in srgb, var(--ui-team-blue) 4%, transparent) 72%,
      transparent
    ),
    var(--ui-sidebar);
  border-right: 1px solid color-mix(in srgb, var(--ui-accent) 42%, var(--ui-divider));
  padding: var(--ui-space-5) var(--ui-space-3) var(--ui-space-3);
  box-sizing: border-box;
  box-shadow: 14px 0 36px rgba(0, 0, 0, .22);
  transition: width 0.18s ease, flex-basis 0.18s ease, padding 0.18s ease;
}

.sidebar::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: auto -70px 22px -92px;
  height: 330px;
  background: var(--sidebar-map-image) center / cover no-repeat;
  opacity: .055;
  filter: saturate(.65) contrast(1.12);
  transform: rotate(-8deg);
  pointer-events: none;
}

.sidebar::after {
  content: "";
  position: absolute;
  z-index: 2;
  inset: 0 -1px 0 auto;
  width: 1px;
  background: linear-gradient(transparent 5%, var(--ui-accent-dim) 23%, var(--ui-live-dim) 78%, transparent 96%);
  opacity: .68;
  pointer-events: none;
}

.sidebar.collapsed {
  width: 68px;
  flex-basis: 68px;
  padding-inline: var(--ui-space-2);
}

.brand {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-1);
  padding: 0 var(--ui-space-2) var(--ui-space-5);
  border-bottom: 1px solid var(--ui-divider);
  margin-bottom: var(--ui-space-3);
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-2);
  min-width: 0;
}

.brand-title {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
}

.brand-title-collapsed {
  justify-content: center;
}

.brand-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  margin-right: -5px;
  filter:
    drop-shadow(0 0 5px color-mix(in srgb, var(--ui-accent-strong) 18%, transparent))
    drop-shadow(0 0 7px color-mix(in srgb, var(--ui-live) 10%, transparent));
}

.brand-logo-collapsed {
  width: 44px;
  height: 44px;
  flex-basis: 44px;
  margin: -4px 0;
  filter:
    drop-shadow(0 0 8px color-mix(in srgb, var(--ui-accent-strong) 20%, transparent))
    drop-shadow(0 0 12px color-mix(in srgb, var(--ui-live) 22%, transparent));
}

.brand-mark {
  font-family: var(--ui-font-display);
  font-size: 24px;
  letter-spacing: 2.1px;
  color: var(--ui-accent);
  line-height: 1;
}

.brand-name {
  font-family: var(--ui-font-heading);
  font-size: 11px;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--ui-text-subtle);
}

.collapse-toggle {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  padding: 0;
  background: var(--ui-control-background);
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text-subtle);
  cursor: pointer;
}

.collapse-toggle:hover {
  border-color: var(--ui-control-border-hover);
  background: var(--ui-control-background-hover);
  color: var(--ui-text-heading);
}

.sidebar.collapsed .brand {
  align-items: center;
  padding-inline: 0;
}

.sidebar.collapsed .brand-row {
  flex-direction: column;
  gap: var(--ui-space-2);
}

.brand-title-collapsed.brand-recall-enter-active {
  animation: recall-brand-arrive .54s cubic-bezier(.2, .78, .2, 1) both;
}

.brand-title-collapsed.brand-recall-leave-active {
  animation: recall-brand-depart .48s cubic-bezier(.55, .04, .8, .35) both;
}

.brand-title-expanded.brand-recall-enter-active {
  animation: wordmark-return .42s cubic-bezier(.2, .72, .2, 1) both;
}

.brand-title-expanded.brand-recall-leave-active {
  animation: wordmark-fold .22s ease-in both;
}

.brand-subtitle-enter-active { animation: subtitle-return .35s .18s ease both; }
.brand-subtitle-leave-active { animation: subtitle-leave .15s ease both; }

.nav {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 0 -3px;
  padding: 0 3px 4px;
  overflow-y: auto;
  overflow-x: hidden;
  list-style: none;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar { display: none; }

.nav-section {
  list-style: none;
}

.nav-section:last-child {
  margin-top: auto;
}

.nav-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 8px 4px;
  color: var(--ui-text-faint);
  font: 9px var(--ui-font-heading);
  letter-spacing: 1.7px;
  text-transform: uppercase;
}

.nav-section-label::after {
  content: "";
  height: 1px;
  flex: 1;
  background: linear-gradient(90deg, var(--ui-divider), transparent);
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav-item {
  position: relative;
  width: 100%;
  min-height: 41px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 4px 7px;
  overflow: hidden;
  background: transparent;
  color: var(--ui-text-subtle);
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  text-align: left;
  cursor: pointer;
  transition: transform .16s ease, border-color .16s ease, background .16s ease, color .16s ease;
}

.nav-item::before {
  content: "";
  position: absolute;
  inset: 7px auto 7px 0;
  width: 2px;
  border-radius: var(--ui-radius-pill);
  background: linear-gradient(var(--ui-accent-strong), var(--ui-accent-dim));
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 55%, transparent);
  opacity: 0;
  transform: scaleY(.4);
  transition: opacity .16s ease, transform .16s ease;
}

.sidebar:not(.collapsed) .nav-item:hover {
  transform: translateX(2px);
}

.nav-item:hover {
  border-color: color-mix(in srgb, var(--ui-border) 65%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--ui-live) 5%, transparent), var(--ui-surface-hover-subtle));
  color: var(--ui-text);
}

.nav-item.active {
  border-color: color-mix(in srgb, var(--ui-accent) 48%, var(--ui-border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--ui-accent) 13%, transparent), transparent 58%),
    linear-gradient(115deg, color-mix(in srgb, var(--ui-team-blue) 12%, var(--ui-surface-hover)), var(--ui-surface-inset));
  color: var(--ui-text-heading);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--ui-accent-strong) 9%, transparent), 0 7px 18px rgba(0, 0, 0, .18);
}

.nav-item.active::before {
  opacity: 1;
  transform: scaleY(1);
}

.nav-emblem {
  position: relative;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 34%, var(--ui-border));
  border-radius: 9px 3px 9px 3px;
  background:
    radial-gradient(circle at 42% 32%, color-mix(in srgb, var(--ui-team-blue) 13%, transparent), transparent 54%),
    var(--ui-surface-inset);
  box-shadow: inset 0 0 10px rgba(0, 0, 0, .42);
  transition: border-color .16s ease, box-shadow .16s ease, filter .16s ease;
}

.nav-emblem::after {
  content: "";
  position: absolute;
  inset: 2px;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 16%, transparent);
  border-radius: 6px 2px 6px 2px;
  pointer-events: none;
}

.nav-art {
  width: 21px;
  height: 21px;
  object-fit: contain;
  opacity: .72;
  filter: saturate(.72) brightness(.86);
  transition: opacity .16s ease, filter .16s ease, transform .16s ease;
}

.art-glyph .nav-art { width: 21px; height: 21px; }

.nav-item:hover .nav-emblem,
.nav-item.active .nav-emblem {
  border-color: var(--ui-border-emphasis);
  box-shadow: inset 0 0 10px rgba(0, 0, 0, .3), 0 0 11px color-mix(in srgb, var(--ui-live) 18%, transparent);
}

.nav-item:hover .nav-art,
.nav-item.active .nav-art {
  opacity: 1;
  filter: saturate(1) brightness(1.08);
}

.nav-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-copy strong {
  overflow: hidden;
  color: inherit;
  font: 12px var(--ui-font-heading);
  letter-spacing: .55px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font: 9px var(--ui-font-body);
  letter-spacing: .25px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-item.active .nav-copy small { color: var(--ui-text-subtle); }

.sidebar.collapsed .nav {
  gap: 5px;
  margin-inline: 0;
  padding-inline: 0;
}

.sidebar.collapsed .nav-section:not(:last-child) {
  padding-bottom: 5px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-divider) 72%, transparent);
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  min-height: 42px;
  padding: 4px;
}

.sidebar.collapsed .nav-item::before { inset-block: 9px; }
.sidebar.collapsed .nav-emblem { width: 34px; height: 34px; flex-basis: 34px; }

.refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--ui-space-2);
  width: 100%;
  min-height: 34px;
  margin: 9px 0 var(--ui-space-2);
  padding: var(--ui-space-2);
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-team-blue) 5%, transparent), transparent), var(--ui-control-background);
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  color: var(--ui-control-text);
  cursor: pointer;
  font-family: var(--ui-font-body);
  font-size: 12px;
}

.refresh:hover:not(:disabled) {
  border-color: var(--ui-control-border-hover);
  background: var(--ui-control-background-hover);
}

.sidebar.collapsed .refresh {
  padding-inline: 0;
}

.refresh:disabled {
  cursor: not-allowed;
  color: var(--ui-text-faint);
  opacity: 0.7;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

.refresh-message {
  margin: 0 0 var(--ui-space-2);
  font-size: 12px;
  color: var(--ui-text-subtle);
  text-align: center;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes recall-brand-arrive {
  0% { opacity: 0; transform: translateY(26px) scale(.62); filter: blur(3px) brightness(1.8); }
  45% { opacity: 1; transform: translateY(-3px) scale(1.08); filter: blur(0) brightness(1.4); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); }
}

@keyframes recall-brand-depart {
  0% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) brightness(1); }
  42% { opacity: 1; transform: translateY(-5px) scale(1.08); filter: blur(0) brightness(1.7); }
  100% { opacity: 0; transform: translateY(-42px) scale(.38); filter: blur(4px) brightness(2.2); }
}

@keyframes wordmark-return {
  0% { opacity: 0; transform: translateX(-18px) scaleX(.72); filter: blur(3px); }
  58% { opacity: 1; transform: translateX(2px) scaleX(1.03); filter: blur(0); }
  100% { opacity: 1; transform: none; }
}

@keyframes wordmark-fold {
  to { opacity: 0; transform: translateX(-12px) scaleX(.78); filter: blur(2px); }
}

@keyframes subtitle-return {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

@keyframes subtitle-leave {
  to { opacity: 0; transform: translateY(-4px); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-title-collapsed.brand-recall-enter-active,
  .brand-title-collapsed.brand-recall-leave-active,
  .brand-title-expanded.brand-recall-enter-active,
  .brand-title-expanded.brand-recall-leave-active,
  .brand-subtitle-enter-active,
  .brand-subtitle-leave-active {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
}

@media (max-height: 680px) {
  .sidebar:not(.collapsed) .brand {
    padding-bottom: var(--ui-space-3);
    margin-bottom: var(--ui-space-2);
  }

  .sidebar:not(.collapsed) .nav { gap: 3px; }
  .sidebar:not(.collapsed) .nav-section-label { display: none; }

  .sidebar:not(.collapsed) .nav-section:not(:last-child) {
    padding-bottom: 3px;
    border-bottom: 1px solid color-mix(in srgb, var(--ui-divider) 62%, transparent);
  }

  .sidebar:not(.collapsed) .nav-item {
    min-height: 34px;
    padding-block: 2px;
  }

  .sidebar:not(.collapsed) .nav-emblem {
    width: 28px;
    height: 28px;
    flex-basis: 28px;
  }

  .sidebar:not(.collapsed) .nav-art { width: 18px; height: 18px; }
  .sidebar:not(.collapsed) .nav-copy small { display: none; }
  .sidebar:not(.collapsed) .refresh { margin-top: 5px; }
  .sidebar:not(.collapsed) .status { padding-block: 7px; }
}

.status {
  margin-top: 2px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--ui-divider) 78%, transparent);
  border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--ui-surface-inset) 76%, transparent);
  box-shadow: var(--ui-shadow-inset);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
}

.sidebar.collapsed .status-row {
  justify-content: center;
}

.sidebar.collapsed .status {
  margin-inline: 5px;
  padding: 8px 0;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-text-faint);
  flex: 0 0 auto;
}

.dot.online {
  background: var(--ui-live);
  box-shadow: 0 0 6px color-mix(in srgb, var(--ui-live) 72%, transparent);
}

.status-text {
  font-size: 11px;
  color: var(--ui-text-subtle);
}

.summoner {
  margin-top: var(--ui-space-1);
  padding-left: 15px;
  font-size: 12px;
  color: var(--ui-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag {
  color: var(--ui-text-muted);
}
</style>
