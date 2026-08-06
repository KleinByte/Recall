export interface RepairNotification {
  gameIds: number[]
  changedCount: number
  categories: Record<string, number>
  versions: Record<string, number>
}

export interface RepairChange {
  gameId: number
  category: string
  version?: { key: string; value: number }
}

export class RepairNotificationBatch {
  private readonly gameIds = new Set<number>()
  private readonly categories = new Map<string, number>()
  private readonly versions = new Map<string, number>()
  private finished = false

  constructor(private readonly publish: (notification: RepairNotification) => void) {}

  record(change: RepairChange): void {
    if (this.finished) throw new Error("repair_batch_finished")
    if (!Number.isSafeInteger(change.gameId)) throw new Error("invalid_repair_game_id")
    this.gameIds.add(change.gameId)
    this.categories.set(change.category, (this.categories.get(change.category) ?? 0) + 1)
    if (change.version) this.versions.set(change.version.key, change.version.value)
  }

  commit(): RepairNotification | undefined {
    if (this.finished) throw new Error("repair_batch_finished")
    this.finished = true
    if (this.gameIds.size === 0) return undefined
    const notification: RepairNotification = {
      gameIds: [...this.gameIds].sort((a, b) => a - b),
      changedCount: [...this.categories.values()].reduce((sum, count) => sum + count, 0),
      categories: Object.fromEntries([...this.categories].sort(([left], [right]) => left.localeCompare(right))),
      versions: Object.fromEntries([...this.versions].sort(([left], [right]) => left.localeCompare(right))),
    }
    this.publish(notification)
    return notification
  }

  rollback(): void {
    if (this.finished) throw new Error("repair_batch_finished")
    this.finished = true
  }
}

export class RepairNotificationCoalescer {
  constructor(private readonly publish: (notification: RepairNotification) => void) {}

  begin(): RepairNotificationBatch {
    return new RepairNotificationBatch(this.publish)
  }
}
