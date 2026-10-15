import { describe, expect, it } from 'vitest'
import { parseLog } from '../src/log'

const NUL = '\0'

function commit(fields: {
  sha: string
  parents: string
  subject: string
  decoration: string
  authorName?: string
  body?: string
}): string {
  return [
    fields.sha,
    fields.parents,
    fields.authorName ?? 'Test Author',
    'author@example.com',
    '2026-10-13T08:00:00+08:00',
    'Test Committer',
    'committer@example.com',
    '2026-10-13T08:05:00+08:00',
    fields.subject,
    fields.decoration,
    fields.body ?? ''
  ].join(NUL)
}

describe('parseLog', () => {
  it('parses commits with decorations and parents', () => {
    const stdout =
      commit({
        sha: 'a'.repeat(40),
        parents: 'b'.repeat(40),
        subject: 'add 中文 文档',
        decoration: 'HEAD -> main, origin/main, tag: v1.0.0'
      }) +
      NUL +
      commit({ sha: 'b'.repeat(40), parents: '', subject: 'Initial commit', decoration: '' }) +
      NUL

    const commits = parseLog(stdout)
    expect(commits).toHaveLength(2)

    expect(commits[0]).toEqual({
      sha: 'a'.repeat(40),
      parents: ['b'.repeat(40)],
      author: { name: 'Test Author', email: 'author@example.com', date: '2026-10-13T08:00:00+08:00' },
      committer: { name: 'Test Committer', email: 'committer@example.com', date: '2026-10-13T08:05:00+08:00' },
      subject: 'add 中文 文档',
      body: '',
      refs: ['main', 'origin/main', 'v1.0.0']
    })

    expect(commits[1]?.parents).toEqual([])
    expect(commits[1]?.refs).toEqual([])
  })

  it('keeps a detached HEAD marker', () => {
    const commits = parseLog(
      commit({ sha: 'c'.repeat(40), parents: '', subject: 'detached', decoration: 'HEAD' }) + NUL
    )
    expect(commits[0]?.refs).toEqual(['HEAD'])
  })

  it('keeps the message body trimmed', () => {
    const commits = parseLog(
      commit({
        sha: 'd'.repeat(40),
        parents: '',
        subject: 'subject line',
        decoration: '',
        body: '\nExplains why the change was needed.\n\nMore detail.'
      }) + NUL
    )
    expect(commits[0]?.subject).toBe('subject line')
    expect(commits[0]?.body).toBe('Explains why the change was needed.\n\nMore detail.')
  })

  it('returns an empty list for empty output', () => {
    expect(parseLog('')).toEqual([])
  })
})
