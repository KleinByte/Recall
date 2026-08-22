// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import ChallengeRow from "../src/components/ChallengeRow.vue"
import type { ChallengeRow as ChallengeRowType } from "../src/types/stats"

const challenge: ChallengeRowType = {
  challengeId: 101_301,
  puuid: "owner",
  name: "Jack of All Champs",
  description: "Win with different champions.",
  category: "EXPERTISE",
  idListType: "CHAMPION",
  gameModes: "[]",
  currentLevel: "GOLD",
  nextLevel: "PLATINUM",
  currentValue: 48,
  currentThreshold: 30,
  nextThreshold: 50,
  thresholds: "{}",
  percentile: 12.5,
  pointsAwarded: 40,
  isCapstone: 0,
  isApex: 0,
  isRetired: 0,
  parentId: null,
  iconPath: null,
  completedIds: "[1,2]",
  updatedAt: 1,
}

describe("ChallengeRow disclosure", () => {
  it("keeps its button and details region linked while it opens and closes", async () => {
    const Harness = defineComponent({
      components: { ChallengeRow },
      setup() {
        return { challenge, expanded: ref(false) }
      },
      template: `
        <ChallengeRow
          :challenge="challenge"
          :expanded="expanded"
          @toggle="expanded = !expanded"
        />
      `,
    })
    const wrapper = mount(Harness, {
      global: { stubs: { FontAwesomeIcon: true } },
    })

    const trigger = wrapper.get("button.row-main")
    expect(trigger.attributes("aria-expanded")).toBe("false")
    expect(trigger.attributes("aria-controls")).toBe("challenge-details-101301")
    expect(wrapper.find("#challenge-details-101301").exists()).toBe(false)

    await trigger.trigger("click")

    expect(trigger.attributes("aria-expanded")).toBe("true")
    const details = wrapper.get("#challenge-details-101301")
    expect(details.attributes("role")).toBe("region")
    expect(details.attributes("aria-label")).toBe("Jack of All Champs details")

    await trigger.trigger("click")

    expect(trigger.attributes("aria-expanded")).toBe("false")
    expect(wrapper.find("#challenge-details-101301").exists()).toBe(false)
  })

  it("shows every capstone descendant and opens a selected member", async () => {
    const capstone = {
      ...challenge,
      challengeId: 200_000,
      name: "Mastermind",
      isCapstone: 1,
      idListType: "NONE",
    }
    const nestedCapstone = {
      ...challenge,
      challengeId: 200_100,
      name: "Cornerstone",
      isCapstone: 1,
      parentId: 200_000,
    }
    const completed = {
      ...challenge,
      challengeId: 200_101,
      name: "Clutch Plays",
      nextLevel: null,
      nextThreshold: null,
      parentId: 200_100,
    }
    const retired = {
      ...challenge,
      challengeId: 200_102,
      name: "Archived Objective",
      isRetired: 1,
      parentId: 200_100,
    }

    const wrapper = mount(ChallengeRow, {
      props: {
        challenge: capstone,
        expanded: true,
        members: [nestedCapstone, completed, retired],
      },
      global: { stubs: { FontAwesomeIcon: true } },
    })

    expect(wrapper.findAll(".member-card")).toHaveLength(3)
    expect(wrapper.text()).toContain("Cornerstone")
    expect(wrapper.text()).toContain("Clutch Plays")
    expect(wrapper.text()).toContain("Archived Objective")

    await wrapper.findAll(".member-card")[1].trigger("click")
    expect(wrapper.emitted("openMember")).toEqual([[200_101]])
  })
})
