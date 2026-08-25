import { onBeforeUnmount, onMounted, ref, type Ref } from "vue"

export interface PlaybackClockOptions {
  duration: () => number
  available: () => boolean
  speed: Ref<number>
  initialTime?: number
  renderFps?: number
  publishFps?: number
  onPublish?: (timestamp: number) => void
}

/**
 * A bounded review clock shared by map playbacks. Rendering is capped separately
 * from parent-state publication so one animation cannot invalidate the whole page.
 */
export function usePlaybackClock(options: PlaybackClockOptions) {
  const time = ref(options.initialTime ?? 0)
  const playing = ref(false)
  const renderInterval = 1_000 / Math.max(1, options.renderFps ?? 30)
  const publishInterval = 1_000 / Math.max(1, options.publishFps ?? 10)
  let clockTime = time.value
  let animationFrame: number | undefined
  let previousAnimationTime: number | undefined
  let previousRenderTime = Number.NEGATIVE_INFINITY
  let previousPublishTime = Number.NEGATIVE_INFINITY

  function bounded(timestamp: number) {
    return Math.max(0, Math.min(options.duration(), Number.isFinite(timestamp) ? timestamp : 0))
  }

  function publish(timestamp: number) {
    options.onPublish?.(timestamp)
  }

  function setTime(timestamp: number, shouldPublish = true) {
    clockTime = bounded(timestamp)
    time.value = clockTime
    if (shouldPublish) publish(clockTime)
    return clockTime
  }

  function syncTime(timestamp: number) {
    clockTime = bounded(timestamp)
    time.value = clockTime
  }

  function stop() {
    playing.value = false
    previousAnimationTime = undefined
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
    animationFrame = undefined
  }

  function animate(now: number) {
    if (!playing.value) return
    const previous = previousAnimationTime ?? now
    previousAnimationTime = now
    // A suspended renderer or a busy frame must not turn into a large game-time jump.
    const elapsed = Math.min(100, Math.max(0, now - previous))
    const next = bounded(clockTime + elapsed * options.speed.value)
    clockTime = next
    const finished = next >= options.duration()
    if (finished || now - previousRenderTime >= renderInterval) {
      time.value = next
      previousRenderTime = now
    }
    if (finished || now - previousPublishTime >= publishInterval) {
      publish(next)
      previousPublishTime = now
    }
    if (finished) {
      stop()
      return
    }
    animationFrame = requestAnimationFrame(animate)
  }

  function play(restartAt = 0) {
    if (playing.value || !options.available()) return
    if (clockTime >= options.duration()) setTime(restartAt)
    playing.value = true
    previousAnimationTime = undefined
    previousRenderTime = Number.NEGATIVE_INFINITY
    previousPublishTime = Number.NEGATIVE_INFINITY
    animationFrame = requestAnimationFrame(animate)
  }

  function toggle(restartAt = 0) {
    if (playing.value) stop()
    else play(restartAt)
  }

  function skip(delta: number) {
    stop()
    setTime(clockTime + delta)
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "hidden" || !playing.value) return
    // Pausing is explicit and avoids surprising catch-up when the app is restored.
    stop()
    time.value = clockTime
    publish(clockTime)
  }

  onMounted(() => document.addEventListener("visibilitychange", handleVisibilityChange))
  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange)
    stop()
  })

  return {
    time,
    playing,
    setTime,
    syncTime,
    stop,
    play,
    toggle,
    skip,
  }
}
