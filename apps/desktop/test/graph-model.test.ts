import { describe, expect, it } from 'vitest'
import type { CommitInfo } from '@gitreedesk/shared'
import { layoutCommits } from '../src/renderer/src/tree/graph-model'

function commit(sha: string, parents: string[] = []): CommitInfo {
  const person = { name: 'Test', email: 'test@gitreedesk.invalid', date: '2026-01-01T00:00:00Z' }
  return { sha, parents, author: person, committer: person, subject: sha, refs: [] }
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
