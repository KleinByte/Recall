import type { NormalizedPoint } from "../../../src/shared/minimap/contracts.js"
import { normalizedDistance } from "../../../src/shared/minimap/contracts.js"

export interface NavigationNode {
  id: string
  point: NormalizedPoint
  tags: readonly ("base" | "lane" | "river" | "jungle" | "camp" | "objective")[]
}

export interface NavigationEdge {
  from: string
  to: string
  weight?: number
}

export interface NavigationGraph {
  version: number
  nodes: readonly NavigationNode[]
  edges: readonly NavigationEdge[]
}

const node = (
  id: string,
  x: number,
  y: number,
  ...tags: NavigationNode["tags"]
): NavigationNode => ({ id, point: { x, y }, tags: tags.flat() })

const bidirectional = (pairs: Array<[string, string]>): NavigationEdge[] =>
  pairs.flatMap(([from, to]) => [{ from, to }, { from: to, to: from }])

export const SUMMONERS_RIFT_GRAPH: NavigationGraph = {
  version: 1,
  nodes: [
    node("blue_base", 0.07, 0.92, "base"),
    node("blue_gate", 0.15, 0.84, "base", "lane"),
    node("red_base", 0.93, 0.08, "base"),
    node("red_gate", 0.85, 0.16, "base", "lane"),

    node("top_blue_outer", 0.10, 0.67, "lane"),
    node("top_blue_river", 0.17, 0.37, "lane", "river"),
    node("top_center", 0.34, 0.18, "lane"),
    node("top_red_outer", 0.67, 0.10, "lane"),
    node("top_red_gate", 0.84, 0.14, "lane"),

    node("mid_blue_outer", 0.26, 0.74, "lane"),
    node("mid_blue_river", 0.39, 0.61, "lane", "river"),
    node("mid_center", 0.50, 0.50, "lane", "river"),
    node("mid_red_river", 0.61, 0.39, "lane", "river"),
    node("mid_red_outer", 0.74, 0.26, "lane"),

    node("bot_blue_gate", 0.16, 0.86, "lane"),
    node("bot_blue_outer", 0.33, 0.90, "lane"),
    node("bot_center", 0.66, 0.82, "lane"),
    node("bot_red_river", 0.83, 0.63, "lane", "river"),
    node("bot_red_outer", 0.90, 0.33, "lane"),

    node("river_north", 0.39, 0.39, "river"),
    node("river_north_mid", 0.45, 0.45, "river"),
    node("river_south_mid", 0.55, 0.55, "river"),
    node("river_south", 0.61, 0.61, "river"),
    node("baron_pit", 0.39, 0.47, "river", "objective"),
    node("dragon_pit", 0.61, 0.53, "river", "objective"),

    node("west_blue", 0.275, 0.704, "jungle", "camp"),
    node("west_gromp", 0.205, 0.758, "jungle", "camp"),
    node("west_wolves", 0.35, 0.625, "jungle", "camp"),
    node("west_raptors", 0.465, 0.676, "jungle", "camp"),
    node("west_red", 0.525, 0.754, "jungle", "camp"),
    node("west_krugs", 0.61, 0.835, "jungle", "camp"),
    node("west_top_entry", 0.25, 0.49, "jungle", "river"),
    node("west_mid_entry", 0.42, 0.62, "jungle", "lane"),
    node("west_bot_entry", 0.54, 0.79, "jungle", "lane"),

    node("east_blue", 0.725, 0.296, "jungle", "camp"),
    node("east_gromp", 0.795, 0.242, "jungle", "camp"),
    node("east_wolves", 0.65, 0.375, "jungle", "camp"),
    node("east_raptors", 0.535, 0.324, "jungle", "camp"),
    node("east_red", 0.475, 0.246, "jungle", "camp"),
    node("east_krugs", 0.39, 0.165, "jungle", "camp"),
    node("east_top_entry", 0.46, 0.21, "jungle", "lane"),
    node("east_mid_entry", 0.58, 0.38, "jungle", "lane"),
    node("east_bot_entry", 0.75, 0.51, "jungle", "river"),
  ],
  edges: bidirectional([
    ["blue_base", "blue_gate"],
    ["blue_gate", "top_blue_outer"],
    ["blue_gate", "mid_blue_outer"],
    ["blue_gate", "bot_blue_gate"],
    ["bot_blue_gate", "bot_blue_outer"],
    ["top_blue_outer", "top_blue_river"],
    ["top_blue_river", "top_center"],
    ["top_center", "top_red_outer"],
    ["top_red_outer", "top_red_gate"],
    ["top_red_gate", "red_gate"],
    ["red_gate", "red_base"],
    ["mid_blue_outer", "mid_blue_river"],
    ["mid_blue_river", "mid_center"],
    ["mid_center", "mid_red_river"],
    ["mid_red_river", "mid_red_outer"],
    ["mid_red_outer", "red_gate"],
    ["bot_blue_outer", "bot_center"],
    ["bot_center", "bot_red_river"],
    ["bot_red_river", "bot_red_outer"],
    ["bot_red_outer", "red_gate"],

    ["top_blue_river", "river_north"],
    ["river_north", "river_north_mid"],
    ["river_north_mid", "mid_center"],
    ["mid_center", "river_south_mid"],
    ["river_south_mid", "river_south"],
    ["river_south", "bot_red_river"],
    ["river_north_mid", "baron_pit"],
    ["river_south_mid", "dragon_pit"],

    ["blue_gate", "west_gromp"],
    ["west_gromp", "west_blue"],
    ["west_blue", "west_wolves"],
    ["west_wolves", "west_top_entry"],
    ["west_top_entry", "top_blue_river"],
    ["west_wolves", "mid_blue_river"],
    ["west_wolves", "west_mid_entry"],
    ["west_mid_entry", "west_raptors"],
    ["west_raptors", "west_red"],
    ["west_red", "west_krugs"],
    ["west_krugs", "bot_center"],
    ["west_red", "west_bot_entry"],
    ["west_bot_entry", "bot_center"],
    ["west_raptors", "mid_blue_river"],

    ["red_gate", "east_gromp"],
    ["east_gromp", "east_blue"],
    ["east_blue", "east_wolves"],
    ["east_wolves", "east_bot_entry"],
    ["east_bot_entry", "bot_red_river"],
    ["east_wolves", "mid_red_river"],
    ["east_wolves", "east_mid_entry"],
    ["east_mid_entry", "east_raptors"],
    ["east_raptors", "east_red"],
    ["east_red", "east_krugs"],
    ["east_krugs", "top_center"],
    ["east_red", "east_top_entry"],
    ["east_top_entry", "top_center"],
    ["east_raptors", "mid_red_river"],
  ]),
}

export function graphIndex(graph: NavigationGraph) {
  const nodes = new Map(graph.nodes.map((entry) => [entry.id, entry]))
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>()
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) throw new Error(`invalid_graph_edge:${edge.from}:${edge.to}`)
    const neighbours = adjacency.get(edge.from) ?? []
    neighbours.push({
      id: edge.to,
      weight: edge.weight ?? normalizedDistance(from.point, to.point),
    })
    adjacency.set(edge.from, neighbours)
  }
  return { nodes, adjacency }
}

export function nearestNavigationNode(
  point: NormalizedPoint,
  graph: NavigationGraph = SUMMONERS_RIFT_GRAPH,
) {
  return [...graph.nodes]
    .map((entry) => ({ node: entry, distance: normalizedDistance(point, entry.point) }))
    .sort((left, right) => left.distance - right.distance)[0]
}

export function shortestGraphPath(
  startId: string,
  endId: string,
  graph: NavigationGraph = SUMMONERS_RIFT_GRAPH,
) {
  const { nodes, adjacency } = graphIndex(graph)
  if (!nodes.has(startId) || !nodes.has(endId)) return undefined
  const distances = new Map<string, number>([[startId, 0]])
  const previous = new Map<string, string>()
  const pending = new Set(nodes.keys())
  while (pending.size > 0) {
    let current: string | undefined
    let currentDistance = Number.POSITIVE_INFINITY
    for (const id of pending) {
      const distance = distances.get(id) ?? Number.POSITIVE_INFINITY
      if (distance < currentDistance) {
        current = id
        currentDistance = distance
      }
    }
    if (!current || currentDistance === Number.POSITIVE_INFINITY) break
    pending.delete(current)
    if (current === endId) break
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!pending.has(neighbour.id)) continue
      const candidate = currentDistance + neighbour.weight
      if (candidate < (distances.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbour.id, candidate)
        previous.set(neighbour.id, current)
      }
    }
  }
  if (!distances.has(endId)) return undefined
  const ids = [endId]
  while (ids[0] !== startId) {
    const parent = previous.get(ids[0])
    if (!parent) return undefined
    ids.unshift(parent)
  }
  return {
    ids,
    points: ids.map((id) => nodes.get(id)!.point),
    distance: distances.get(endId)!,
  }
}
