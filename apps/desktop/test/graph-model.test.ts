import { describe, expect, it } from 'vitest'
import type { CommitInfo, GitRef, RefKind } from '@gitreedesk/shared'
import {
  GUTTER_MIN_WIDTH,
  LANE_MAX_SPACING,
  LANE_MIN_SPACING,
  compareRefs,
  gutterLayout,
  layoutCommits,
  prioritizedRefName,
  refsBySha
} from '../src/renderer/src/tree/graph-model'

function commit(sha: string, parents: string[] = []): CommitInfo {
  const person = { name: 'Test', email: 'test@gitreedesk.invalid', date: '2026-01-01T00:00:00Z' }
  return { sha, parents, author: person, committer: person, subject: sha, body: '', refs: [] }
}

function ref(name: string, sha: string, kind: RefKind = 'branch', isHead = false): GitRef {
  return {
    name,
    fullName:
      kind === 'branch' ? `refs/heads/${name}` : kind === 'remote' ? `refs/remotes/${name}` : `refs/tags/${name}`,
    kind,
    sha,
    isHead,
    upstream: null,
    ahead: 0,
    behind: 0,
    subject: null,
    updatedAt: null,
    annotated: false
  }
}

describe('layoutCommits', () => {
  it('lays a linear history on one lane', () => {
    const layout = layoutCommits([commit('c', ['b']), commit('b', ['a']), commit('a')])

    expect(layout.laneCount).toBe(1)
    expect(layout.rows).toEqual([
      { sha: 'c', lane: 0, edges: [{ fromLane: -1, toLane: 0, colorLane: 0 }], laneCount: 1 },
      {
        sha: 'b',
        lane: 0,
        edges: [
          { fromLane: -1, toLane: 0, colorLane: 0 },
          { fromLane: 0, toLane: -1, colorLane: 0 }
        ],
        laneCount: 1
      },
      { sha: 'a', lane: 0, edges: [{ fromLane: 0, toLane: -1, colorLane: 0 }], laneCount: 1 }
    ])
  })

  it('fans out merge parents and joins lines that converge', () => {
    // D is a merge of C and R; both C and R descend from B.
    const layout = layoutCommits([
      commit('d', ['c', 'r']),
      commit('c', ['b']),
      commit('r', ['b']),
      commit('b', ['a']),
      commit('a')
    ])

    expect(layout.laneCount).toBe(2)
    expect(layout.rows).toEqual([
      {
        sha: 'd',
        lane: 0,
        edges: [
          { fromLane: -1, toLane: 0, colorLane: 0 },
          { fromLane: -1, toLane: 1, colorLane: 1 }
        ],
        laneCount: 2
      },
      {
        sha: 'c',
        lane: 0,
        edges: [
          { fromLane: -1, toLane: 0, colorLane: 0 },
          { fromLane: 0, toLane: -1, colorLane: 0 },
          { fromLane: 1, toLane: 1, colorLane: 1 }
        ],
        laneCount: 2
      },
      {
        sha: 'r',
        lane: 1,
        edges: [
          { fromLane: -1, toLane: 0, colorLane: 0 },
          { fromLane: 0, toLane: 0, colorLane: 0 },
          { fromLane: 1, toLane: -1, colorLane: 1 }
        ],
        laneCount: 2
      },
      {
        sha: 'b',
        lane: 0,
        edges: [
          { fromLane: -1, toLane: 0, colorLane: 0 },
          { fromLane: 0, toLane: -1, colorLane: 0 }
        ],
        laneCount: 1
      },
      { sha: 'a', lane: 0, edges: [{ fromLane: 0, toLane: -1, colorLane: 0 }], laneCount: 1 }
    ])
  })

  it('opens a lane per extra parent of an octopus merge', () => {
    const layout = layoutCommits([commit('m', ['p1', 'p2', 'p3'])])

    expect(layout.rows[0]?.edges).toEqual([
      { fromLane: -1, toLane: 0, colorLane: 0 },
      { fromLane: -1, toLane: 1, colorLane: 1 },
      { fromLane: -1, toLane: 2, colorLane: 2 }
    ])
    expect(layout.laneCount).toBe(3)
  })

  it('converges lanes that wait for the same parent', () => {
    const layout = layoutCommits([
      commit('x', ['a', 'b']),
      commit('y', ['c', 'b']),
      commit('a', ['b']),
      commit('c', ['b']),
      commit('b')
    ])

    // Both A and C join B's line instead of seeding duplicate waiting lanes.
    expect(layout.rows[2]?.edges).toContainEqual({ fromLane: -1, toLane: 1, colorLane: 1 })
    expect(layout.rows[3]?.edges).toContainEqual({ fromLane: -1, toLane: 1, colorLane: 1 })
    expect(layout.rows[4]).toMatchObject({ sha: 'b', lane: 1 })
  })

  it('reuses a freed lane for a later tip', () => {
    const layout = layoutCommits([
      commit('t1', ['b']),
      commit('b'),
      commit('t2', ['c']),
      commit('c')
    ])

    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0, 0])
    expect(layout.laneCount).toBe(1)
  })

  it('keeps dangling parents waiting across page boundaries', () => {
    const pageOne = [commit('tip', ['older'])]
    const first = layoutCommits(pageOne)
    expect(first.rows[0]?.edges).toEqual([{ fromLane: -1, toLane: 0, colorLane: 0 }])

    // Appending the parent page continues the lane instead of opening a new one.
    const full = layoutCommits([...pageOne, commit('older', ['root']), commit('root')])
    expect(full.rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(full.laneCount).toBe(1)
  })
})

describe('refsBySha', () => {
  it('groups refs by commit and orders HEAD, branch, remote, tag', () => {
    const grouped = refsBySha([
      ref('v1', 'a', 'tag'),
      ref('origin/feature', 'a', 'remote'),
      ref('dev', 'a'),
      ref('feature', 'a', 'branch', true),
      ref('other', 'b')
    ])

    expect([...grouped.keys()].sort()).toEqual(['a', 'b'])
    expect(grouped.get('a')?.map((entry) => entry.name)).toEqual([
      'feature',
      'dev',
      'origin/feature',
      'v1'
    ])
    expect(grouped.get('b')?.map((entry) => entry.name)).toEqual(['other'])
  })

  it('breaks same-kind ties by name', () => {
    const grouped = refsBySha([ref('zeta', 'a'), ref('alpha', 'a')])
    expect(grouped.get('a')?.map((entry) => entry.name)).toEqual(['alpha', 'zeta'])
  })
})

describe('compareRefs', () => {
  it('prefers the checked-out branch over any other ref', () => {
    expect(compareRefs(ref('main', 'a', 'branch', true), ref('origin/main', 'a', 'remote'))).toBeLessThan(0)
  })

  it('prefers a branch over a remote over a tag', () => {
    expect(compareRefs(ref('b', 'a'), ref('origin/b', 'a', 'remote'))).toBeLessThan(0)
    expect(compareRefs(ref('origin/b', 'a', 'remote'), ref('v1', 'a', 'tag'))).toBeLessThan(0)
  })
})

describe('prioritizedRefName', () => {
  it('returns HEAD for the checked-out tip', () => {
    expect(prioritizedRefName([ref('v1', 'a', 'tag'), ref('main', 'a', 'branch', true)])).toBe('HEAD')
  })

  it('falls down to the best concrete ref name', () => {
    expect(prioritizedRefName([ref('v1', 'a', 'tag'), ref('origin/main', 'a', 'remote')])).toBe(
      'origin/main'
    )
    expect(prioritizedRefName([ref('v1', 'a', 'tag')])).toBe('v1')
  })

  it('returns null without refs', () => {
    expect(prioritizedRefName([])).toBeNull()
  })
})

describe('gutterLayout', () => {
  it('keeps the natural spacing when the lanes fit', () => {
    expect(gutterLayout(3, 1000, null)).toEqual({ width: GUTTER_MIN_WIDTH, spacing: LANE_MAX_SPACING })
  })

  it('caps the gutter and compresses the spacing for many lanes', () => {
    const { width, spacing } = gutterLayout(80, 1000, null)
    expect(width).toBe(350)
    expect(spacing).toBeCloseTo(4.375, 3)
  })

  it('honours a user width without letting lanes overflow the floor', () => {
    expect(gutterLayout(80, 1000, 120)).toEqual({ width: 120, spacing: LANE_MIN_SPACING })
  })

  it('clamps the width to the pane', () => {
    expect(gutterLayout(40, 400, 900)).toEqual({ width: 240, spacing: 6 })
  })

  it('falls back to a sane width before the pane is measured', () => {
    expect(gutterLayout(5, 0, null)).toEqual({ width: 70, spacing: LANE_MAX_SPACING })
  })
})
