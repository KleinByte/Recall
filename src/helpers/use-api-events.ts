import { onBeforeUnmount } from "vue"
import { api } from "./api"
import type { UpdateStatus } from "../types/update"

/** Registers renderer IPC listeners and removes all of them with the component. */
export function useApiEvents() {
  const disposers: Array<() => void> = []
  let disposed = false

  onBeforeUnmount(() => {
    disposed = true
    for (const dispose of disposers.splice(0)) dispose()
  })

  const keep = (dispose: () => void) => {
    if (disposed) dispose()
    else disposers.push(dispose)
  }

  return {
    on(channel: string, listener: (...args: any[]) => void) {
      keep(api.on(channel, listener))
    },
    onUpdateStatus(listener: (status: UpdateStatus) => void) {
      keep(api.onUpdateStatus(listener))
    },
  }
}
