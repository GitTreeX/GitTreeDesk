import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathExists } from '../src/fs'
import { resolveGitInstallRoot } from '../src/version'

describe('resolveGitInstallRoot', () => {
  it('returns a root that actually contains Git Bash, or null', async () => {
    const root = await resolveGitInstallRoot()
    if (root === null) return

    const hasBash =
      (await pathExists(join(root, 'bin', 'bash.exe'))) ||
      (await pathExists(join(root, 'usr', 'bin', 'bash.exe')))
    expect(hasBash).toBe(true)
  })
})
