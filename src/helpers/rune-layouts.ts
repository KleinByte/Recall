import type { RuneSelection } from "../types/stats"

export type ClassicRuneType =
  | "kMark"
  | "kSeal"
  | "kGlyph"
  | "kQuintessence"

export interface ClassicRuneSlot {
  type: ClassicRuneType
  x: number
  y: number
  size: number
}

export interface ClassicRunePlacement extends ClassicRuneSlot {
  runeId: number
  selection: RuneSelection
}

const slots = (
  type: ClassicRuneType,
  size: number,
  points: ReadonlyArray<readonly [number, number]>,
): ClassicRuneSlot[] => points.map(([x, y]) => ({ type, x, y, size }))

/** Socket centers measured from the neutral 659×435 Classic rune board. */
export const CLASSIC_RUNE_SLOTS: Readonly<Record<ClassicRuneType, ClassicRuneSlot[]>> = {
  kMark: slots("kMark", 8.8, [
    [14.6, 58.9], [8.9, 67.4], [20.9, 65.5],
    [4.2, 77.9], [13.1, 77.0], [21.1, 80.2],
    [8.0, 90.6], [15.9, 92.0], [25.5, 90.3],
  ]),
  kSeal: slots("kSeal", 8.4, [
    [13.4, 36.6], [21.9, 31.5], [27.8, 22.8],
    [35.2, 17.2], [44.3, 10.8], [54.3, 6.0],
    [58.0, 18.1], [20.6, 46.9], [13.1, 48.3],
  ]),
  kGlyph: slots("kGlyph", 8.8, [
    [64.6, 11.7], [74.5, 10.1], [85.9, 10.6],
    [69.7, 22.8], [78.9, 20.5], [93.9, 18.6],
    [76.9, 31.3], [88.3, 29.4], [92.3, 38.8],
  ]),
  kQuintessence: slots("kQuintessence", 12.4, [
    [12.9, 15.9], [35.8, 60.0], [72.1, 51.5],
  ]),
}

export const CLASSIC_RUNE_CAPACITY: Readonly<Record<ClassicRuneType, number>> = {
  kMark: CLASSIC_RUNE_SLOTS.kMark.length,
  kSeal: CLASSIC_RUNE_SLOTS.kSeal.length,
  kGlyph: CLASSIC_RUNE_SLOTS.kGlyph.length,
  kQuintessence: CLASSIC_RUNE_SLOTS.kQuintessence.length,
}

const classicType = (value?: string): value is ClassicRuneType =>
  value === "kMark"
  || value === "kSeal"
  || value === "kGlyph"
  || value === "kQuintessence"

/**
 * Expands the count stored by Classic's rune-page payload into physical board
 * sockets. Unknown runes stay out of the visual rather than being guessed.
 */
export function placeClassicRunes(
  selections: RuneSelection[],
  metadata: Record<number, { type?: string }>,
): ClassicRunePlacement[] {
  const placed: ClassicRunePlacement[] = []
  const used: Record<ClassicRuneType, number> = {
    kMark: 0,
    kSeal: 0,
    kGlyph: 0,
    kQuintessence: 0,
  }

  for (const selection of selections) {
    const type = metadata[selection.runeId]?.type
    if (!classicType(type)) continue

    const requested = Math.max(1, Math.trunc(selection.count ?? 1))
    for (let copy = 0; copy < requested; copy += 1) {
      const socket = CLASSIC_RUNE_SLOTS[type][used[type]]
      if (!socket) break
      placed.push({ ...socket, runeId: selection.runeId, selection })
      used[type] += 1
    }
  }

  return placed
}
