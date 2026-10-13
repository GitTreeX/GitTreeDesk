import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectOperation, readStashCount } from '../src/repo'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-repo-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('detectOperation', () => {
  it('detects each in-progress operation from state files', async () => {
    const dir = await tempDir()
    expect(await detectOperation(dir)).toBe('none')

    await writeFile(join(dir, 'MERGE_HEAD'), 'a'.repeat(40) + '\n')
    expect(await detectOperation(dir)).toBe('merge')
    await rm(join(dir, 'MERGE_HEAD'))

    await mkdir(join(dir, 'rebase-apply'))
    expect(await detectOperation(dir)).toBe('rebase')
    await rm(join(dir, 'rebase-apply'), { recursive: true })

    await mkdir(join(dir, 'rebase-merge'))
    expect(await detectOperation(dir)).toBe('rebase')
    await writeFile(join(dir, 'rebase-merge', 'interactive'), '')
    expect(await detectOperation(dir)).toBe('rebase-interactive')
    await rm(join(dir, 'rebase-merge'), { recursive: true })

    await writeFile(join(dir, 'CHERRY_PICK_HEAD'), 'b'.repeat(40) + '\n')
    expect(await detectOperation(dir)).toBe('cherry-pick')
    await rm(join(dir, 'CHERRY_PICK_HEAD'))

    await writeFile(join(dir, 'REVERT_HEAD'), 'c'.repeat(40) + '\n')
    expect(await detectOperation(dir)).toBe('revert')
    await rm(join(dir, 'REVERT_HEAD'))

    await writeFile(join(dir, 'BISECT_LOG'), 'git bisect start\n')
    expect(await detectOperation(dir)).toBe('bisect')
  })

  it('prioritizes an interrupted rebase over a stale merge head', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'MERGE_HEAD'), 'a'.repeat(40) + '\n')
    await mkdir(join(dir, 'rebase-merge'))
    expect(await detectOperation(dir)).toBe('rebase')
  })
})

describe('readStashCount', () => {
  it('counts non-empty reflog lines and tolerates a missing file', async () => {
    const dir = await tempDir()
    expect(await readStashCount(dir)).toBe(0)

    await mkdir(join(dir, 'logs', 'refs'), { recursive: true })
    await writeFile(join(dir, 'logs', 'refs', 'stash'), 'line one\nline two\n')
    expect(await readStashCount(dir)).toBe(2)
  })
})
