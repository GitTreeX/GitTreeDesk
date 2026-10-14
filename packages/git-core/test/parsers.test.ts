import { describe, expect, it } from 'vitest'
import { BACKUP_REF_PREFIX, formatBackupTimestamp, parseBackupRefName, parseBackupRefs, parseBackupTimestamp } from '../src/backup'
import { parseStashList } from '../src/stashes'
import { parseSubmoduleStatus } from '../src/submodules'
import { parseWorktreeList } from '../src/worktrees'

const NUL = '\0'
const sha40 = (char: string): string => char.repeat(40)

describe('parseWorktreeList', () => {
  it('parses main, detached locked and bare worktrees', () => {
    const stdout = [
      'worktree C:/projects/acme/mobile-app',
      `HEAD ${sha40('a')}`,
      'branch refs/heads/main',
      '',
      'worktree C:/projects/acme/mobile-app_wt-dark-mode',
      `HEAD ${sha40('b')}`,
      'detached',
      'locked in use by tooling',
      '',
      'worktree C:/projects/acme/api-server.git',
      `HEAD ${sha40('c')}`,
      'bare',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')

    const worktrees = parseWorktreeList(stdout)
    expect(worktrees).toHaveLength(3)
    expect(worktrees[0]).toEqual({
      path: 'C:/projects/acme/mobile-app',
      sha: sha40('a'),
      branch: 'refs/heads/main',
      detached: false,
      bare: false,
      locked: null,
      prunable: null
    })
    expect(worktrees[1]?.detached).toBe(true)
    expect(worktrees[1]?.branch).toBeNull()
    expect(worktrees[1]?.locked).toBe('in use by tooling')
    expect(worktrees[2]?.bare).toBe(true)
    expect(worktrees[2]?.prunable).toBe('gitdir file points to non-existent location')
  })
})

describe('parseSubmoduleStatus', () => {
  it('maps prefixes to checkout states and extracts describe', () => {
    const stdout = [
      ` ${sha40('a')} libs/core (v1.2.3)`,
      `-${sha40('b')} libs/uninit`,
      `+${sha40('c')} libs/my lib (heads/main)`,
      `U${sha40('d')} libs/conflict`,
      'garbage line'
    ].join('\n')

    expect(parseSubmoduleStatus(stdout)).toEqual([
      { path: 'libs/core', sha: sha40('a'), describe: 'v1.2.3', checkout: 'in-sync' },
      { path: 'libs/uninit', sha: sha40('b'), describe: null, checkout: 'uninitialized' },
      { path: 'libs/my lib', sha: sha40('c'), describe: 'heads/main', checkout: 'different' },
      { path: 'libs/conflict', sha: sha40('d'), describe: null, checkout: 'conflict' }
    ])
  })

  it('returns an empty list for empty output', () => {
    expect(parseSubmoduleStatus('')).toEqual([])
  })
})

describe('parseStashList', () => {
  it('parses selector, sha, subject, branch and date per entry', () => {
    const stdout =
      ['stash@{0}', sha40('a'), 'On main: second stash', '2026-10-13T08:05:03+02:00'].join(NUL) +
      NUL +
      ['stash@{1}', sha40('b'), 'WIP on main: abc123 first stash', '2026-10-12T01:02:03+02:00'].join(
        NUL
      ) +
      NUL +
      ['stash@{2}', sha40('c'), 'a plain subject', '2026-10-11T00:00:00+02:00'].join(NUL) +
      NUL

    expect(parseStashList(stdout)).toEqual([
      {
        index: 0,
        selector: 'stash@{0}',
        sha: sha40('a'),
        subject: 'On main: second stash',
        branch: 'main',
        at: '2026-10-13T08:05:03+02:00',
        files: 0
      },
      {
        index: 1,
        selector: 'stash@{1}',
        sha: sha40('b'),
        subject: 'WIP on main: abc123 first stash',
        branch: 'main',
        at: '2026-10-12T01:02:03+02:00',
        files: 0
      },
      {
        index: 2,
        selector: 'stash@{2}',
        sha: sha40('c'),
        subject: 'a plain subject',
        branch: null,
        at: '2026-10-11T00:00:00+02:00',
        files: 0
      }
    ])
  })
})

describe('backup ref naming', () => {
  it('formats and parses UTC timestamps', () => {
    const date = new Date(Date.UTC(2026, 9, 13, 8, 5, 3))
    expect(formatBackupTimestamp(date)).toBe('20261013-080503')
    expect(parseBackupTimestamp('20261013-080503')).toBe('2026-10-13T08:05:03Z')
    expect(parseBackupTimestamp('20261301-000000')).toBeNull()
    expect(parseBackupTimestamp('20261013-250000')).toBeNull()
    expect(parseBackupTimestamp('not-a-stamp')).toBeNull()
  })

  it('parses ref names with and without a collision suffix', () => {
    expect(parseBackupRefName(`${BACKUP_REF_PREFIX}reset-hard/20261013-080503`)).toEqual({
      op: 'reset-hard',
      createdAt: '2026-10-13T08:05:03Z'
    })
    expect(parseBackupRefName(`${BACKUP_REF_PREFIX}branch-delete/20261013-080503-2`)).toEqual({
      op: 'branch-delete',
      createdAt: '2026-10-13T08:05:03Z'
    })
    expect(parseBackupRefName('refs/heads/main')).toBeNull()
    expect(parseBackupRefName(`${BACKUP_REF_PREFIX}Reset Hard/20261013-080503`)).toBeNull()
    expect(parseBackupRefName(`${BACKUP_REF_PREFIX}reset-hard/garbage`)).toBeNull()
  })

  it('parses for-each-ref output and skips malformed lines', () => {
    const stdout = [
      `${BACKUP_REF_PREFIX}reset-hard/20261013-080503${NUL}${sha40('a')}`,
      'refs/heads/main' + NUL + sha40('b'),
      `${BACKUP_REF_PREFIX}rebase/20261013-090000${NUL}${sha40('c')}`
    ].join('\n')

    expect(parseBackupRefs(stdout)).toEqual([
      { ref: `${BACKUP_REF_PREFIX}reset-hard/20261013-080503`, op: 'reset-hard', sha: sha40('a'), createdAt: '2026-10-13T08:05:03Z' },
      { ref: `${BACKUP_REF_PREFIX}rebase/20261013-090000`, op: 'rebase', sha: sha40('c'), createdAt: '2026-10-13T09:00:00Z' }
    ])
  })
})
