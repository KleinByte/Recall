// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { usePlaybackClock } from "../src/helpers/use-playback-clock.js"

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
})

describe("review playback clock", () => {
  it("caps render/publication work, clamps long frames, and pauses when hidden", () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId
      frames.set(frameId, callback)
      return frameId
    }))
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
      frames.delete(frameId)
    }))
    const publish = vi.fn()
    let clock!: ReturnType<typeof usePlaybackClock>
    const component = defineComponent({
      setup() {
        clock = usePlaybackClock({
          duration: () => 10_000,
          available: () => true,
          speed: ref(1),
          renderFps: 30,
          publishFps: 10,
          onPublish: publish,
        })
        return () => h("div")
      },
    })
    const wrapper = mount(component)
    const runNextFrame = (now: number) => {
      const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      expect(next).toBeDefined()
      frames.delete(next![0])
      next![1](now)
    }

    clock.play()
    for (const now of [0, 40, 80, 120, 160]) runNextFrame(now)
    expect(clock.time.value).toBe(160)
    expect(publish).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(clock.playing.value).toBe(false)
    expect(frames.size).toBe(0)

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
    clock.syncTime(0)
    clock.play()
    runNextFrame(1_000)
    runNextFrame(6_000)
    expect(clock.time.value).toBe(100)

    wrapper.unmount()
  })
})
