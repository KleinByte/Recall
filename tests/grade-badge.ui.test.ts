// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { describe, expect, it } from "vitest"
import GradeBadge from "../src/components/GradeBadge.vue"

describe("GradeBadge", () => {
  it("shows a stored grade normally", () => {
    const wrapper = mount(GradeBadge, { props: { grade: "A+", status: "ready" } })

    expect(wrapper.text()).toBe("A+")
    expect(wrapper.classes()).toContain("a")
    expect(wrapper.attributes("aria-label")).toBe("Performance grade A+")
  })

  it("uses League hammer art and explains a calibrating grade on focus", async () => {
    const wrapper = mount(GradeBadge, { props: { status: "calibrating" } })

    expect(wrapper.find(".grade.building img").attributes("src")).toContain("items/3133.png")
    expect(wrapper.find(".hover-card-anchor").attributes("aria-label")).toContain("Grade is still building")
    expect(wrapper.text()).not.toContain("Building")

    await wrapper.find(".hover-card-anchor").trigger("focus")
    await nextTick()
    expect(document.body.textContent).toContain("Baseline under construction")
    expect(document.body.textContent).toContain("graded automatically")
    wrapper.unmount()
  })
})
