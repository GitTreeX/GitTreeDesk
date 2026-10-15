import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalPath } from '../src/paths'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-paths-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('canonicalPath', () => {
  it('returns the real path of an existing directory with forward slashes', async () => {
    const dir = await tempDir()

    const result = await canonicalPath(dir)

    // On macOS the temp root is itself a symlink (`/var` → `/private/var`), so this
    // also covers the case that made every scoped scan come back empty.
    expect(result).toBe(toPosix(await realpath(dir)))
    expect(result).not.toContain('\\')
  })

  it.runIf(process.platform === 'darwin')('resolves the /var symlink macOS ships with', async () => {
    expect(await canonicalPath('/var')).toBe('/private/var')
  })

  it('falls back to the nearest existing ancestor when the leaf was deleted', async () => {
    const dir = await tempDir()
    const gone = join(dir, 'gone')
    await mkdir(gone)
    await rm(gone, { recursive: true, force: true })

    const expected = posix.join(toPosix(await realpath(dir)), 'gone')

    expect(await canonicalPath(gone)).toBe(expected)
  })

  it('rebuilds the whole missing tail below the nearest existing ancestor', async () => {
    const dir = await tempDir()
    const deep = join(dir, 'a', 'b', 'c')
    await mkdir(deep, { recursive: true })
    await rm(join(dir, 'a'), { recursive: true, force: true })

    const expected = posix.join(toPosix(await realpath(dir)), 'a', 'b', 'c')

    expect(await canonicalPath(deep)).toBe(expected)
  })

  it('is idempotent, so a scope can be canonicalized twice', async () => {
    const dir = await tempDir()
    const gone = join(dir, 'gone')
    await mkdir(gone)
    await rm(gone, { recursive: true, force: true })

    const once = await canonicalPath(gone)

    expect(await canonicalPath(once)).toBe(once)
  })
})
