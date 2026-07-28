import type { UpdateStatus } from "../types/update"

export type UpdateAction = "retry" | "install"

export function updatePresentation(status: UpdateStatus): {
  message: string
  action: { label: string; command: UpdateAction } | null
} {
  switch (status.kind) {
    case "checking":
      return { message: "Checking for updates…", action: null }
    case "up-to-date":
      return { message: "Recall is up to date.", action: null }
    case "available":
      return { message: `Downloading Recall ${status.version}…`, action: null }
    case "downloading":
      return {
        message: `Downloading Recall ${status.version}: ${status.percent}%`,
        action: null,
      }
    case "downloaded":
      return {
        message: `Recall ${status.version} is ready.`,
        action: { label: "Restart to update", command: "install" },
      }
    case "error":
      return {
        message: status.message,
        action: { label: "Try again", command: "retry" },
      }
  }
}
