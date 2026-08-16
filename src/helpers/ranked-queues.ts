const QUEUE_LABELS: Readonly<Record<string, string>> = {
  RANKED_SOLO_5x5: "Solo/Duo",
  RANKED_FLEX_SR: "Flex",
  RANKED_PREMADE_5x5: "Ranked 5s",
}

/** Riot exposes League Classic's ladder with JADE in the internal queue key. */
export function isLeagueClassicRankedQueue(queue: string): boolean {
  const normalized = queue.trim().toUpperCase()
  const tokens = new Set(normalized.split("_").filter(Boolean))
  return tokens.has("JADE") && !tokens.has("KIWI")
}

export function isRecognizedRankedQueue(queue: string): boolean {
  return queue in QUEUE_LABELS || isLeagueClassicRankedQueue(queue)
}

export function rankedQueueLabel(queue: string): string {
  if (isLeagueClassicRankedQueue(queue)) return "League Classic"
  return QUEUE_LABELS[queue] ??
    queue.replace(/^RANKED_/, "").replaceAll("_", " ")
}
