/**
 * Catching a game the moment it finishes.
 *
 * The client announces the end of a game before its history has been written,
 * and how long that takes varies with the length of the game and how busy the
 * machine is. A single fixed delay is therefore always either too early — and
 * the game is missed until the next periodic sync — or needlessly late.
 *
 * Asking repeatedly, quickly at first and then less often, catches the game
 * within a second or two in the common case without pestering the client when
 * something has gone wrong.
 */

export interface SyncOutcome {
  inserted: number
}

/** Milliseconds to wait before each retry, in order. */
export function retryDelays(): number[] {
  return [1_500, 2_500, 4_000, 6_000, 10_000, 15_000, 20_000, 30_000, 40_000]
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Syncs until a game is actually recorded, or the retries run out.
 *
 * A failed request counts as "nothing yet" rather than an error worth giving
 * up over: a client still writing its end-of-game data often refuses one.
 *
 * @returns how many attempts were made.
 */
export async function syncUntilRecorded(
  sync: () => Promise<SyncOutcome>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<number> {
  const delays = retryDelays()
  let attempts = 0

  for (let index = 0; index <= delays.length; index += 1) {
    attempts += 1

    try {
      const result = await sync()
      if (result.inserted > 0) return attempts
    } catch (error) {
      console.warn(`Post-game sync attempt failed: ${(error as Error).message}`)
    }

    if (index < delays.length) await wait(delays[index])
  }

  return attempts
}
