import { onBeforeUnmount } from "vue"

/**
 * Runs one async refresh at a time and collapses any burst received while it
 * is running into a single trailing refresh.
 */
export function createCoalescedTask(task: () => Promise<void>) {
  let active: Promise<void> | undefined
  let pending = false
  let stopped = false

  const run = () => {
    if (stopped) return Promise.resolve()
    if (active) {
      pending = true
      return active
    }

    active = (async () => {
      do {
        pending = false
        await task()
      } while (pending && !stopped)
    })().finally(() => {
      active = undefined
    })
    return active
  }

  return {
    run,
    stop() {
      stopped = true
      pending = false
    },
  }
}

export function useCoalescedTask(task: () => Promise<void>) {
  const runner = createCoalescedTask(task)
  onBeforeUnmount(runner.stop)
  return runner.run
}
