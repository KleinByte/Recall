<script setup lang="ts">
import { computed } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faChevronDown,
  faLayerGroup,
  faThumbtack,
} from "@fortawesome/free-solid-svg-icons"
import type { ChallengeRow } from "../types/stats"
import {
  challengeCategoryLabel,
  challengeGameModeLabel,
  challengeGameModes,
  challengeRemaining,
  challengeTierProgress,
  isChallengeCompleted,
} from "../helpers/challenges"
import { formatDecimal } from "../helpers/format"

const props = defineProps<{
  challenge: ChallengeRow
  expanded: boolean
  pinned?: boolean
  members?: ChallengeRow[]
  groupName?: string
}>()

const emit = defineEmits<{
  (event: "toggle"): void
  (event: "pin"): void
  (event: "openMember", challengeId: number): void
}>()

const progress = computed(() => challengeTierProgress(props.challenge))
const completed = computed(() => isChallengeCompleted(props.challenge))
const remaining = computed(() => challengeRemaining(props.challenge))
const gameModes = computed(() => challengeGameModes(props.challenge)
  .map(challengeGameModeLabel))
const groupMembers = computed(() => props.members ?? [])
const completedMembers = computed(() => groupMembers.value
  .filter(isChallengeCompleted).length)

const tierClass = (challenge: ChallengeRow) =>
  challenge.currentLevel.slice(0, 1).toLowerCase()

const tierInitial = (challenge: ChallengeRow) =>
  challenge.currentLevel === "NONE"
    ? "–"
    : challenge.currentLevel.slice(0, 1)

const isChampionList = computed(
  () => props.challenge.idListType === "CHAMPION",
)

const completedCount = computed(() => {
  try {
    const parsed = JSON.parse(props.challenge.completedIds) as unknown
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
})

const detailId = computed(() => `challenge-details-${props.challenge.challengeId}`)
const categoryLabel = computed(() => challengeCategoryLabel(props.challenge.category))
const kindLabel = computed(() => {
  if (props.challenge.isApex === 1) return "Apex challenge"
  if (props.challenge.isCapstone === 1) {
    return groupMembers.value.length === 1
      ? "Capstone · 1 challenge"
      : `Capstone · ${groupMembers.value.length} challenges`
  }
  if (props.groupName) return `${props.groupName} group`
  return "Standalone challenge"
})

const statusLabel = computed(() => {
  if (props.challenge.isRetired === 1) return "Retired"
  if (completed.value) return "Complete"
  return "In progress"
})

const memberStatus = (member: ChallengeRow) => {
  const status = member.isRetired === 1
    ? "Retired"
    : isChallengeCompleted(member) ? "Complete" : "In progress"
  return member.isCapstone === 1 ? `Capstone · ${status}` : status
}
</script>

<template>
  <article
    class="challenge"
    :class="{
      retired: challenge.isRetired === 1,
      pinned,
      'is-expanded': expanded,
      'is-capstone': challenge.isCapstone === 1,
    }"
  >
    <div class="row">
      <button
        class="row-main"
        :aria-expanded="expanded"
        :aria-controls="detailId"
        @click="emit('toggle')"
      >
        <span class="tier-shell" aria-hidden="true">
          <span
            class="tier"
            :class="tierClass(challenge)"
            :data-tier="challenge.currentLevel"
          >
            {{ tierInitial(challenge) }}
          </span>
        </span>

        <span class="body">
          <span class="context-line">
            <span>{{ categoryLabel }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ kindLabel }}</span>
          </span>
          <span class="name-line">
            <span class="name">{{ challenge.name }}</span>
            <span v-if="completed" class="tag complete-tag">Complete</span>
            <span v-if="challenge.isCapstone" class="tag">Capstone</span>
            <span v-if="challenge.isApex" class="tag apex">Apex</span>
            <span v-if="challenge.isRetired" class="tag retired-tag">Retired</span>
          </span>
          <span class="description">
            {{ challenge.description || "No objective description reported by League." }}
          </span>
          <span class="track" aria-hidden="true">
            <span class="fill" :style="{ width: `${progress * 100}%` }" />
          </span>
        </span>

        <span class="numbers numeric">
          <span class="target-label">
            {{ completed ? "Target reached" : challenge.nextLevel ? `Next · ${challenge.nextLevel}` : "Progress" }}
          </span>
          <span class="value">
            {{ formatDecimal(challenge.currentValue, 0) }}
            <span v-if="challenge.nextThreshold !== null" class="muted">
              / {{ formatDecimal(challenge.nextThreshold, 0) }}
            </span>
          </span>
          <span v-if="!completed && remaining !== null" class="remaining">
            {{ formatDecimal(remaining, 0) }} left
          </span>
          <span v-else-if="challenge.percentile !== null" class="muted percentile">
            top {{ formatDecimal(challenge.percentile) }}%
          </span>
        </span>

        <span class="disclosure" aria-hidden="true">
          <FontAwesomeIcon :icon="faChevronDown" fixed-width />
        </span>
      </button>

      <button
        class="pin"
        :class="{ on: pinned }"
        :aria-label="pinned ? `Unpin ${challenge.name}` : `Pin ${challenge.name}`"
        :title="pinned ? 'Unpin challenge' : 'Pin challenge'"
        @click.stop="emit('pin')"
      >
        <FontAwesomeIcon :icon="faThumbtack" fixed-width />
        <span class="sr-only">{{ pinned ? "Unpin challenge" : "Pin challenge" }}</span>
      </button>
    </div>

    <Transition name="challenge-detail">
      <div
        v-if="expanded"
        :id="detailId"
        class="detail"
        role="region"
        :aria-label="`${challenge.name} details`"
      >
        <header class="detail-head">
          <span class="definition-icon" aria-hidden="true">
            <FontAwesomeIcon
              v-if="challenge.isCapstone"
              :icon="faLayerGroup"
            />
            <span v-else>{{ tierInitial(challenge) }}</span>
          </span>
          <span class="detail-title">
            <small>{{ categoryLabel }} · {{ kindLabel }}</small>
            <strong>{{ challenge.name }}</strong>
          </span>
          <span
            class="status-pill"
            :class="{
              complete: completed,
              retired: challenge.isRetired === 1,
            }"
          >
            {{ statusLabel }}
          </span>
        </header>

        <div class="detail-overview">
          <section class="objective-block" aria-label="Challenge objective">
            <span class="objective-label">Objective</span>
            <p>
              {{ challenge.description || "League did not provide an objective description for this challenge." }}
            </p>
          </section>

          <section class="milestone-block" aria-label="Challenge milestone">
            <div class="milestone-head">
              <span>
                {{ completed ? "Completed milestone" : "Next milestone" }}
              </span>
              <strong class="numeric">
                {{ challenge.currentLevel }}
                <template v-if="challenge.nextLevel">
                  → {{ challenge.nextLevel }}
                </template>
              </strong>
            </div>
            <div class="milestone-value numeric">
              <strong>{{ formatDecimal(challenge.currentValue, 0) }}</strong>
              <span v-if="challenge.nextThreshold !== null">
                / {{ formatDecimal(challenge.nextThreshold, 0) }}
              </span>
            </div>
            <span class="track large" aria-hidden="true">
              <span class="fill" :style="{ width: `${progress * 100}%` }" />
            </span>
            <p v-if="completed" class="complete-copy">Target reached</p>
            <p v-else-if="remaining !== null" class="muted milestone-copy">
              {{ formatDecimal(remaining, 0) }} remaining to the next tier
            </p>
            <p v-else class="muted milestone-copy">
              Highest available tier reached
            </p>
          </section>
        </div>

        <dl class="facts">
          <div>
            <dt>Category</dt>
            <dd>{{ categoryLabel }}</dd>
          </div>
          <div>
            <dt>Current tier</dt>
            <dd>{{ challenge.currentLevel }}</dd>
          </div>
          <div v-if="challenge.nextLevel">
            <dt>Next tier</dt>
            <dd>{{ challenge.nextLevel }}</dd>
          </div>
          <div>
            <dt>Points earned</dt>
            <dd class="numeric">{{ challenge.pointsAwarded }}</dd>
          </div>
          <div v-if="challenge.percentile !== null">
            <dt>Standing</dt>
            <dd class="numeric">Top {{ formatDecimal(challenge.percentile) }}%</dd>
          </div>
          <div v-if="gameModes.length">
            <dt>Game modes</dt>
            <dd>{{ gameModes.join(", ") }}</dd>
          </div>
          <div v-if="isChampionList">
            <dt>Champions done</dt>
            <dd class="numeric">{{ completedCount }}</dd>
          </div>
        </dl>

        <section
          v-if="challenge.isCapstone && groupMembers.length"
          class="group-section"
          aria-label="Challenges in this capstone"
        >
          <header class="group-head">
            <span class="group-icon" aria-hidden="true">
              <FontAwesomeIcon :icon="faLayerGroup" />
            </span>
            <span>
              <small>Challenge group</small>
              <strong>Challenges in {{ challenge.name }}</strong>
            </span>
            <span class="group-count numeric">
              {{ completedMembers }} / {{ groupMembers.length }} complete
            </span>
          </header>

          <div class="member-grid">
            <button
              v-for="member in groupMembers"
              :key="member.challengeId"
              class="member-card"
              :class="{
                complete: isChallengeCompleted(member),
                retired: member.isRetired === 1,
              }"
              :aria-label="`Open ${member.name} details`"
              @click="emit('openMember', member.challengeId)"
            >
              <span
                class="member-tier tier"
                :class="tierClass(member)"
                :data-tier="member.currentLevel"
                aria-hidden="true"
              >
                {{ tierInitial(member) }}
              </span>
              <span class="member-copy">
                <span class="member-title-line">
                  <strong>{{ member.name }}</strong>
                  <small>{{ memberStatus(member) }}</small>
                </span>
                <span>{{ member.description || "No objective description reported by League." }}</span>
                <span class="track member-track" aria-hidden="true">
                  <span
                    class="fill"
                    :style="{ width: `${challengeTierProgress(member) * 100}%` }"
                  />
                </span>
              </span>
              <span class="member-value numeric">
                {{ formatDecimal(member.currentValue, 0) }}
                <template v-if="member.nextThreshold !== null">
                  / {{ formatDecimal(member.nextThreshold, 0) }}
                </template>
                <small>View details →</small>
              </span>
            </button>
          </div>
        </section>

        <slot name="champions" />
      </div>
    </Transition>
  </article>
</template>

<style scoped>
.challenge {
  --challenge-tone: var(--ui-accent);
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background:
    radial-gradient(circle at 7% 0, color-mix(in srgb, var(--challenge-tone) 7%, transparent), transparent 32%),
    linear-gradient(145deg, var(--ui-surface-panel), var(--ui-surface-panel-quiet));
  box-shadow: var(--ui-shadow-panel), inset 2px 0 color-mix(in srgb, var(--challenge-tone) 42%, transparent);
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}

.challenge::after {
  position: absolute;
  top: 0;
  right: 20px;
  width: 58px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--challenge-tone), transparent);
  opacity: .65;
  content: "";
}

.challenge:hover,
.challenge.is-expanded {
  border-color: color-mix(in srgb, var(--challenge-tone) 42%, var(--ui-border));
  box-shadow: var(--ui-shadow-raised), inset 2px 0 color-mix(in srgb, var(--challenge-tone) 64%, transparent);
}

.challenge:hover:not(.is-expanded) { transform: translateY(-1px); }
.challenge.is-capstone { --challenge-tone: var(--instrument-energy); }
.challenge.pinned { border-color: color-mix(in srgb, var(--ui-accent) 62%, var(--ui-border)); }
.challenge.retired:not(.is-expanded) { opacity: .65; }

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
  min-height: 108px;
}

.row-main {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) minmax(102px, auto) 20px;
  align-items: center;
  gap: var(--ui-space-3);
  min-width: 0;
  padding: var(--ui-space-3);
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  font-family: var(--ui-font-body);
  cursor: pointer;
}

.row-main:focus-visible,
.member-card:focus-visible,
.pin:focus-visible {
  outline: 2px solid var(--ui-focus-ring);
  outline-offset: -2px;
}

.tier-shell {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--challenge-tone) 28%, var(--ui-border));
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--challenge-tone) 10%, transparent), var(--ui-surface-inset));
  box-shadow: 0 0 16px color-mix(in srgb, var(--challenge-tone) 9%, transparent);
}

.tier {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  color: var(--ui-text-subtle);
  font: 13px var(--ui-font-display);
}

.tier.s { color: #ffd88a; border-color: #c89b3c; }
.tier[data-tier="CHALLENGER"] { color: #ffd88a; border-color: #d6b34e; }
.tier[data-tier="GRANDMASTER"] { color: #ff8f9d; border-color: #b94859; }
.tier.d { color: #b9f2ff; border-color: #7ec8e3; }
.tier.m { color: #e8a0ff; border-color: #b06ec9; }
.tier.p { color: #7ee3c7; border-color: #3f9e86; }
.tier.g { color: #ffd88a; border-color: #c89b3c; }
.tier.b { color: #d0a07a; border-color: #8a6647; }
.tier.i { color: #a8a8a8; border-color: #6b6b6b; }

.body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.context-line {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--challenge-tone);
  font: var(--ui-text-micro) var(--ui-font-heading);
  letter-spacing: .8px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.context-line span:last-child { color: var(--ui-text-muted); }

.name-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ui-space-2);
  min-width: 0;
}

.name {
  overflow: hidden;
  color: var(--ui-text-heading);
  font: 15px var(--ui-font-heading);
  letter-spacing: .2px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  padding: 1px 5px;
  border: 1px solid color-mix(in srgb, var(--challenge-tone) 38%, var(--ui-border));
  border-radius: var(--ui-radius-pill);
  color: var(--challenge-tone);
  font-size: var(--ui-text-micro);
  letter-spacing: .75px;
  text-transform: uppercase;
}

.tag.apex { color: #e8a0ff; border-color: #b06ec9; }
.tag.retired-tag { color: var(--ui-text-muted); border-color: var(--ui-border); }
.tag.complete-tag { color: var(--ui-live); border-color: color-mix(in srgb, var(--ui-live) 52%, var(--ui-border)); }

.description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-subtle);
  font-size: var(--ui-text-label);
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.track {
  display: block;
  height: 3px;
  overflow: hidden;
  border-radius: var(--ui-radius-pill);
  background: var(--ui-surface-inset);
}

.fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--challenge-tone) 58%, var(--ui-accent-dim)), var(--challenge-tone));
  box-shadow: 0 0 8px color-mix(in srgb, var(--challenge-tone) 24%, transparent);
}

.numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}

.target-label,
.remaining {
  color: var(--ui-text-muted);
  font: 600 var(--ui-text-micro) var(--ui-font-body);
  letter-spacing: .06em;
  text-transform: uppercase;
}

.target-label { color: var(--challenge-tone); }
.value { color: var(--ui-text-heading); font-size: 13px; white-space: nowrap; }
.percentile { font-size: var(--ui-text-micro); }

.disclosure {
  display: grid;
  place-items: center;
  color: var(--ui-text-muted);
  font-size: 11px;
  transition: color 120ms ease, transform 160ms ease;
}

.is-expanded .disclosure { color: var(--challenge-tone); transform: rotate(180deg); }

.pin {
  place-self: stretch;
  border: 0;
  border-left: 1px solid var(--ui-divider);
  background: color-mix(in srgb, var(--ui-surface-inset) 58%, transparent);
  color: var(--ui-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.pin:hover,
.pin.on { background: color-mix(in srgb, var(--ui-accent) 7%, var(--ui-surface-inset)); color: var(--ui-accent); }

.detail {
  position: relative;
  display: grid;
  gap: var(--ui-space-3);
  padding: var(--ui-space-4);
  border-top: 1px solid color-mix(in srgb, var(--challenge-tone) 24%, var(--ui-divider));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--challenge-tone) 5%, transparent), transparent 44%),
    var(--ui-surface-inset);
}

.detail::after {
  position: absolute;
  top: 0;
  right: 28px;
  width: 72px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--challenge-tone), transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--challenge-tone) 40%, transparent);
  content: "";
}

.detail-head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-3);
}

.definition-icon,
.group-icon {
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--challenge-tone) 52%, var(--ui-border));
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--challenge-tone) 18%, transparent), var(--ui-surface-inset));
  color: var(--challenge-tone);
  box-shadow: 0 0 18px color-mix(in srgb, var(--challenge-tone) 12%, transparent);
}

.definition-icon { width: 42px; height: 42px; font: 16px var(--ui-font-display); }
.definition-icon svg { width: 16px; height: 16px; }

.detail-title {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.detail-title small,
.group-head small {
  color: var(--challenge-tone);
  font: var(--ui-text-micro) var(--ui-font-heading);
  letter-spacing: 1px;
  text-transform: uppercase;
}

.detail-title strong {
  overflow: hidden;
  color: var(--ui-text-heading);
  font: 19px var(--ui-font-display);
  letter-spacing: .35px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--challenge-tone) 28%, var(--ui-border));
  border-radius: var(--ui-radius-pill);
  color: var(--challenge-tone);
  font-size: var(--ui-text-micro);
}

.status-pill.complete { color: var(--ui-live); border-color: color-mix(in srgb, var(--ui-live) 42%, var(--ui-border)); }
.status-pill.retired { color: var(--ui-text-muted); border-color: var(--ui-border); }

.detail-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(250px, .7fr);
  gap: var(--ui-space-3);
}

.objective-block,
.milestone-block {
  min-width: 0;
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
}

.objective-block {
  border-left: 2px solid color-mix(in srgb, var(--challenge-tone) 68%, transparent);
  background: color-mix(in srgb, var(--challenge-tone) 5%, var(--ui-surface-inset));
}

.objective-label,
.milestone-head > span {
  color: var(--challenge-tone);
  font: 700 var(--ui-text-micro) var(--ui-font-heading);
  letter-spacing: .1em;
  text-transform: uppercase;
}

.objective-block p {
  margin: 5px 0 0;
  color: var(--ui-text);
  font-size: var(--ui-text-support);
  line-height: 1.5;
}

.milestone-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ui-space-3);
}

.milestone-head strong { color: var(--ui-text-heading); font-size: var(--ui-text-label); }
.milestone-value { margin: 8px 0 6px; color: var(--ui-text-subtle); font-size: var(--ui-text-label); }
.milestone-value strong { color: var(--ui-text-heading); font-size: 18px; }
.track.large { height: 5px; }
.milestone-copy,
.complete-copy { margin: 7px 0 0; font-size: var(--ui-text-micro); }
.complete-copy { color: var(--ui-live); font-weight: 700; }

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-divider);
}

.facts div {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 8px 10px;
  background: var(--ui-surface-panel-quiet);
}

.facts dt { color: var(--ui-text-muted); font-size: var(--ui-text-micro); }
.facts dd { margin: 0; overflow: hidden; color: var(--ui-text-heading); font-size: var(--ui-text-label); text-overflow: ellipsis; white-space: nowrap; }

.group-section {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--challenge-tone) 30%, var(--ui-border));
  border-radius: var(--ui-radius-md);
  background: color-mix(in srgb, var(--challenge-tone) 3%, var(--ui-surface-panel));
}

.group-head {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-divider);
}

.group-icon { width: 34px; height: 34px; }
.group-icon svg { width: 13px; height: 13px; }
.group-head > span:nth-child(2) { display: grid; min-width: 0; gap: 2px; }
.group-head strong { color: var(--ui-text-heading); font: 14px var(--ui-font-heading); }
.group-count { color: var(--ui-text-subtle); font-size: var(--ui-text-label); }

.member-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--ui-divider);
}

.member-card {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  border: 0;
  background: var(--ui-surface-inset);
  color: inherit;
  text-align: left;
  font-family: var(--ui-font-body);
  cursor: pointer;
  transition: background 120ms ease;
}

.member-card:hover { background: color-mix(in srgb, var(--challenge-tone) 7%, var(--ui-surface-inset)); }
.member-card.complete:not(.retired) { box-shadow: inset 2px 0 color-mix(in srgb, var(--ui-live) 58%, transparent); }
.member-card.retired { opacity: .58; }
.member-tier { width: 28px; height: 28px; font-size: 11px; }

.member-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
  color: var(--ui-text-subtle);
  font-size: var(--ui-text-micro);
}

.member-title-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.member-title-line strong { overflow: hidden; color: var(--ui-text-heading); font-size: var(--ui-text-label); text-overflow: ellipsis; white-space: nowrap; }
.member-title-line small { flex: 0 0 auto; color: var(--ui-text-muted); font-size: var(--ui-text-micro); text-transform: uppercase; }
.member-copy > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-track { height: 2px; }

.member-value {
  display: grid;
  justify-items: end;
  color: var(--ui-text-heading);
  font-size: var(--ui-text-micro);
  white-space: nowrap;
}

.member-value small { margin-top: 3px; color: var(--challenge-tone); font: var(--ui-text-micro) var(--ui-font-body); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.challenge-detail-enter-active,
.challenge-detail-leave-active { transition: opacity 140ms ease, transform 140ms ease; }
.challenge-detail-enter-from,
.challenge-detail-leave-to { opacity: 0; transform: translateY(-4px); }

@container recall-content (max-width: 760px) {
  .detail-overview,
  .member-grid { grid-template-columns: 1fr; }
}

@container recall-content (max-width: 560px) {
  .row-main {
    grid-template-columns: 38px minmax(0, 1fr) 18px;
    gap: var(--ui-space-2);
  }

  .tier-shell { width: 38px; height: 38px; }
  .numbers {
    grid-column: 2;
    align-items: baseline;
    flex-flow: row wrap;
    gap: 3px var(--ui-space-2);
  }
  .disclosure { grid-column: 3; grid-row: 1 / span 2; }
  .detail-head { grid-template-columns: 42px minmax(0, 1fr); }
  .status-pill { grid-column: 2; justify-self: start; }
  .group-head { grid-template-columns: 34px minmax(0, 1fr); }
  .group-count { grid-column: 2; }
  .member-card { grid-template-columns: 28px minmax(0, 1fr); }
  .member-value { grid-column: 2; justify-items: start; }
}

@media (prefers-reduced-motion: reduce) {
  .challenge,
  .disclosure,
  .member-card,
  .challenge-detail-enter-active,
  .challenge-detail-leave-active { transition: none; }
  .challenge:hover:not(.is-expanded) { transform: none; }
}
</style>
