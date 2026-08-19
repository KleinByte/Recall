export interface PathingPolicyContext {
  gameId: number
  livePhase: "Idle" | "ChampSelect" | "InProgress" | "PostGame"
  matchCompleted: boolean
}

/**
 * Riot policy boundary: hidden-position reconstruction is a post-game review
 * feature only. There is intentionally no override flag.
 */
export class PathingPolicyGate {
  assertPostGame(context: PathingPolicyContext) {
    if (context.livePhase === "InProgress" || !context.matchCompleted) {
      throw new Error("live_hidden_path_inference_disabled")
    }
  }
}
