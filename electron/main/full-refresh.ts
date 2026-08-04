export function createSingleFlightRefresh<Args extends unknown[], T>(
  run: (...args: Args) => Promise<T>,
) {
  let inFlight: Promise<T> | undefined

  return (...args: Args) => {
    if (!inFlight) {
      inFlight = run(...args).finally(() => {
        inFlight = undefined
      })
    }

    return inFlight
  }
}
