// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import MomentumGauge from "../src/components/MomentumGauge.vue"

afterEach(() => {
  vi.useRealTimers()
})

describe("Tempo gauge live motion", () => {
  it("runs the pentakill rupture before sustained master motion and cooldown", async () => {
    vi.useFakeTimers()
    const wrapper = mount(MomentumGauge, {
      props: {
        score: 66,
        label: "Stable",
        streak: 0,
        title: "Tempo",
        detail: "Recent pace holding",
      },
    })

    expect(wrapper.classes()).toContain("phase-idle")
    expect(wrapper.attributes("data-live-motion")).toBe("essential")

    await wrapper.setProps({
      score: 100,
      label: "Pentakill",
      overdriveTier: "master",
    })

    expect(wrapper.classes()).toContain("tier-master")
    expect(wrapper.classes()).toContain("phase-rupturing")
    expect(wrapper.find(".master-rupture").exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(1_050)
    await nextTick()
    expect(wrapper.classes()).toContain("phase-burning")

    await wrapper.setProps({
      score: 62,
      label: "Stable",
      overdriveTier: undefined,
    })
    expect(wrapper.classes()).toContain("phase-discharging")

    await vi.advanceTimersByTimeAsync(1_300)
    await nextTick()
    expect(wrapper.classes()).toContain("phase-idle")
    wrapper.unmount()
  })
})
