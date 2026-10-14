import type { CommitInfo } from '@gitreedesk/shared'

/**
 * One lane segment crossing a commit row. A segment runs from the lane band
 * above the row to the lane band below it; the row's dot is the meeting point
 * of the segments whose side is `-1`.
 */
export interface GraphEdge {
  /** Lane above, or `-1` when the segment starts at this row's dot. */
  fromLane: number
  /** Lane below, or `-1` when the segment ends at this row's dot. */
  toLane: number
  /** Lane whose color paints the segment. */
  colorLane: number
}

export interface GraphRow {
  sha: string
  /** Lane hosting this commit's dot. */
  lane: number
  edges: GraphEdge[]
  /** Lanes occupied while this row is drawn; the canvas width hint. */
  laneCount: number
}

export interface GraphLayout {
  /** One row per input commit, in the same order. */
  rows: GraphRow[]
  /** Widest row in the layout. */
  laneCount: number
}

/**
 * Assigns lanes to a newest-first commit list. Lanes are slots that wait for a
 * commit: a child seeds the lane with its first parent, and every commit that
 * arrives takes over the leftmost lane waiting for it, seeding that lane with
 * its own first parent. Extra parents open (or reuse) further lanes, so merges
 * fan out and separate lines of development keep their own column.
 */
export function layoutCommits(commits: readonly CommitInfo[]): GraphLayout {
  const rows: GraphRow[] = []
  const lanes: (string | null)[] = []
  let laneCount = 0

  for (const commit of commits) {
    const incoming: number[] = []
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === commit.sha) incoming.push(i)
    }

    let lane = incoming.length > 0 ? (incoming[0] as number) : -1
    if (lane < 0) {
      const free = lanes.indexOf(null)
      if (free >= 0) lane = free
      else {
        lane = lanes.length
        lanes.push(null)
      }
    }

    const edges: GraphEdge[] = []
    for (let i = 0; i < lanes.length; i += 1) {
      const expected = lanes[i]
      if (expected === null) continue
      if (expected === commit.sha) {
        edges.push({ fromLane: i, toLane: -1, colorLane: i })
        if (i !== lane) lanes[i] = null
      } else {
        edges.push({ fromLane: i, toLane: i, colorLane: i })
      }
    }

    for (let p = 0; p < commit.parents.length; p += 1) {
      const parent = commit.parents[p] as string
      const existing = lanes.findIndex((value, index) => index !== lane && value === parent)
      if (existing >= 0) {
        // Another line of development already waits here; the dot joins it.
        edges.push({ fromLane: -1, toLane: existing, colorLane: existing })
        if (p === 0) lanes[lane] = null
        continue
      }
      let target = p === 0 ? lane : lanes.indexOf(null)
      if (target < 0) {
        target = lanes.length
        lanes.push(null)
      }
      lanes[target] = parent
      edges.push({ fromLane: -1, toLane: target, colorLane: target })
    }
    if (commit.parents.length === 0) lanes[lane] = null

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    let width = lane + 1
    for (const edge of edges) {
      if (edge.fromLane >= 0) width = Math.max(width, edge.fromLane + 1)
    }
    width = Math.max(width, lanes.length)
    edges.sort((a, b) => a.fromLane - b.fromLane || a.toLane - b.toLane)

    rows.push({ sha: commit.sha, lane, edges, laneCount: width })
    laneCount = Math.max(laneCount, width)
  }

  return { rows, laneCount }
}
