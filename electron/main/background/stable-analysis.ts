export interface StableAnalysisOptions<T> {
  expectedIdentity: string
  currentIdentity: () => string | undefined
  currentRevision: () => number
  task: () => Promise<T>
  maximumAttempts?: number
}

/** Retries a read-only analysis if its source generation changed while it ran. */
export async function runStableAnalysis<T>(
  options: StableAnalysisOptions<T>,
): Promise<T> {
  const maximumAttempts = options.maximumAttempts ?? 2
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("stable_analysis_attempts_invalid")
  }

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const revision = options.currentRevision()
    const result = await options.task()
    if (options.currentIdentity() !== options.expectedIdentity) {
      throw new Error("active_account_changed")
    }
    if (options.currentRevision() === revision) return result
  }

  throw new Error("analysis_source_kept_changing")
}

