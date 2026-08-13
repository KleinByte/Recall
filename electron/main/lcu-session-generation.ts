/**
 * Monotonic ownership token for asynchronous League Client session startup.
 *
 * A client disconnect or credential change invalidates every startup attempt
 * that was already awaiting an LCU response. Only the attempt holding the
 * current generation may publish a session or write account-scoped data.
 */
export class LcuSessionGeneration {
  private value = 0

  invalidate(): number {
    this.value += 1
    return this.value
  }

  isCurrent(generation: number): boolean {
    return generation === this.value
  }
}
