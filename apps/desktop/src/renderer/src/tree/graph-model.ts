import type { CommitInfo, GitRef, RefKind } from '@gitreedesk/shared'

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

const REF_KIND_RANK: Record<RefKind, number> = { branch: 0, remote: 1, tag: 2 }

/** HEAD first, then branches, remotes and tags; ties break by short name. */
export function compareRefs(a: GitRef, b: GitRef): number {
  if (a.isHead !== b.isHead) return a.isHead ? -1 : 1
  return REF_KIND_RANK[a.kind] - REF_KIND_RANK[b.kind] || a.name.localeCompare(b.name)
}

/** Groups refs by the commit they point at; each group is display-ordered. */
export function refsBySha(refs: readonly GitRef[]): Map<string, GitRef[]> {
  const grouped = new Map<string, GitRef[]>()
  for (const ref of refs) {
    const group = grouped.get(ref.sha)
    if (group === undefined) grouped.set(ref.sha, [ref])
    else group.push(ref)
  }
  for (const group of grouped.values()) group.sort(compareRefs)
  return grouped
}

/** The ref a commit is best known by: HEAD, then branch, remote and tag. */
export function prioritizedRefName(refs: readonly GitRef[]): string | null {
  const best = refs.reduce<GitRef | null>(
    (current, ref) => (current === null || compareRefs(ref, current) < 0 ? ref : current),
    null
  )
  if (best === null) return null
  return best.isHead ? 'HEAD' : best.name
}

/** Widest lane spacing the gutter uses when lanes are few. */
export const LANE_MAX_SPACING = 14
/** Tightest spacing lanes are squeezed to before the gutter stops shrinking. */
export const LANE_MIN_SPACING = 3
/** The gutter never gets narrower or wider than these bounds. */
export const GUTTER_MIN_WIDTH = 56
export const GUTTER_MAX_WIDTH = 420
/** Share of the pane the gutter may claim before lanes start compressing. */
export const GUTTER_DEFAULT_SHARE = 0.35

export interface GutterLayout {
  width: number
  /** Horizontal distance between lane centers. */
  spacing: number
}

/**
 * Lane gutter geometry for a graph pane. Few lanes get their natural width;
 * many lanes compress the spacing so the widest repo stays readable and the
 * commit text keeps its column. A user-set width wins, and is still clamped to
 * the pane.
 */
export function gutterLayout(
  laneCount: number,
  paneWidth: number,
  userWidth: number | null
): GutterLayout {
  const lanes = Math.max(laneCount, 1)
  const pane = paneWidth > 0 ? paneWidth : GUTTER_MAX_WIDTH
  const natural = lanes * LANE_MAX_SPACING
  const ceiling = Math.max(GUTTER_MIN_WIDTH, Math.min(GUTTER_MAX_WIDTH, pane * GUTTER_DEFAULT_SHARE))
  const requested = userWidth ?? Math.min(natural, ceiling)
  const width = Math.min(Math.max(requested, GUTTER_MIN_WIDTH), Math.max(GUTTER_MIN_WIDTH, pane * 0.6))
  const spacing = Math.min(LANE_MAX_SPACING, Math.max(LANE_MIN_SPACING, width / lanes))
  return { width, spacing }
}
