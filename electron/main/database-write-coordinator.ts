/**
 * Tracks asynchronous work that can write to the open Recall database and
 * provides a small maintenance gate for operations such as account clearing.
 *
 * Callers must check `maintenanceActive` before starting new collection work.
 * `drain` loops because a task that is already finishing can enqueue one last
 * tracked child before it settles.
 */
export class DatabaseWriteCoordinator {
  private readonly tasks = new Set<Promise<unknown>>()
  private maintenanceReason: string | undefined

  get maintenanceActive(): boolean {
    return this.maintenanceReason !== undefined
  }

  beginMaintenance(reason: string): () => void {
    if (!reason) throw new Error("database_maintenance_reason_required")
    if (this.maintenanceReason) throw new Error("database_maintenance_already_active")
    this.maintenanceReason = reason
    let finished = false
    return () => {
      if (finished) return
      finished = true
      if (this.maintenanceReason === reason) this.maintenanceReason = undefined
    }
  }

  track<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task)
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    )
    return task
  }

  async drain(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks])
    }
  }
}
