import { describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS } from '../src/ipc'
import { invokeSchemas } from '../src/validate'

describe('invokeSchemas', () => {
  it('covers every invoke channel', () => {
    for (const channel of INVOKE_CHANNELS) {
      expect(invokeSchemas[channel]).toBeDefined()
    }
    expect(Object.keys(invokeSchemas).sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('accepts a workspace:open request', () => {
    const result = invokeSchemas['workspace:open'].safeParse({ root: 'E:/work/acme' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty workspace root', () => {
    expect(invokeSchemas['workspace:open'].safeParse({ root: '' }).success).toBe(false)
    expect(invokeSchemas['workspace:open'].safeParse({}).success).toBe(false)
    expect(invokeSchemas['workspace:open'].safeParse(null).success).toBe(false)
  })

  it('requires undefined payloads for no-request channels', () => {
    expect(invokeSchemas['workspace:close'].safeParse(undefined).success).toBe(true)
    expect(invokeSchemas['workspace:close'].safeParse({}).success).toBe(false)
    expect(invokeSchemas['app:info'].safeParse(undefined).success).toBe(true)
  })

  it('accepts an optional dirs list for workspace:rescan', () => {
    expect(invokeSchemas['workspace:rescan'].safeParse({}).success).toBe(true)
    expect(invokeSchemas['workspace:rescan'].safeParse({ dirs: ['E:/work/acme/api'] }).success).toBe(true)
    expect(invokeSchemas['workspace:rescan'].safeParse({ dirs: [''] }).success).toBe(false)
    expect(invokeSchemas['workspace:rescan'].safeParse({ raiseBudget: true }).success).toBe(true)
    expect(invokeSchemas['workspace:rescan'].safeParse({ raiseBudget: 1 }).success).toBe(false)
  })

  it('validates the workspace pick and recent-removal payloads', () => {
    expect(invokeSchemas['workspace:pick'].safeParse(undefined).success).toBe(true)
    expect(invokeSchemas['workspace:pick'].safeParse({}).success).toBe(false)
    expect(invokeSchemas['workspace:removeRecent'].safeParse({ root: 'E:/work/acme' }).success).toBe(true)
    expect(invokeSchemas['workspace:removeRecent'].safeParse({ root: '' }).success).toBe(false)
  })

  it('accepts arbitrary JSON-ish values for settings', () => {
    const request = {
      scope: 'workspace',
      keyPath: ['editor', 'fontSize'],
      value: 14
    }
    const result = invokeSchemas['settings:set'].safeParse(request)
    expect(result.success).toBe(true)
    expect(result.success && result.data.value).toBe(14)
  })

  it('rejects an unknown settings scope', () => {
    expect(
      invokeSchemas['settings:get'].safeParse({ scope: 'project', keyPath: ['theme'] }).success
    ).toBe(false)
  })

  it('requires at least one key path segment', () => {
    expect(invokeSchemas['settings:getEffective'].safeParse({ keyPath: ['theme'] }).success).toBe(true)
    expect(invokeSchemas['settings:getEffective'].safeParse({ keyPath: [] }).success).toBe(false)
    expect(invokeSchemas['settings:getEffective'].safeParse({ keyPath: [''] }).success).toBe(false)
  })

  it('validates wrapper payloads', () => {
    expect(invokeSchemas['git:status'].safeParse({ gitDir: '/work/acme/.git' }).success).toBe(true)
    expect(invokeSchemas['git:status'].safeParse({ gitDir: '/work/acme/.git', refresh: true }).success).toBe(true)
    expect(invokeSchemas['git:status'].safeParse({ gitDir: '/work/acme/.git', refresh: 'yes' }).success).toBe(false)
    expect(invokeSchemas['trust:grant'].safeParse({ trusted: true }).success).toBe(true)
    expect(invokeSchemas['trust:grant'].safeParse({}).success).toBe(false)
    expect(invokeSchemas['ui-state:keys'].safeParse({}).success).toBe(true)
    expect(invokeSchemas['ui-state:keys'].safeParse({ prefix: 'explorer' }).success).toBe(true)
  })

  it('validates filesystem requests', () => {
    expect(invokeSchemas['fs:readDir'].safeParse({ path: '/work/acme' }).success).toBe(true)
    expect(invokeSchemas['fs:readDir'].safeParse({ path: '' }).success).toBe(false)

    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: 'notes.md', kind: 'file' }).success).toBe(true)
    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: 'docs', kind: 'dir' }).success).toBe(true)
    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: 'a/b', kind: 'file' }).success).toBe(false)
    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: 'a\\b', kind: 'file' }).success).toBe(false)
    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: '..', kind: 'dir' }).success).toBe(false)
    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: '', kind: 'dir' }).success).toBe(false)
    expect(invokeSchemas['fs:create'].safeParse({ parent: '/work/acme', name: 'ok', kind: 'link' }).success).toBe(false)

    expect(invokeSchemas['fs:rename'].safeParse({ path: '/work/acme/a.txt', newName: 'b.txt' }).success).toBe(true)
    expect(invokeSchemas['fs:rename'].safeParse({ path: '/work/acme/a.txt', newName: 'nested/b.txt' }).success).toBe(false)
    expect(invokeSchemas['fs:trash'].safeParse({ path: '/work/acme/a.txt' }).success).toBe(true)
    expect(invokeSchemas['fs:reveal'].safeParse({}).success).toBe(false)
  })

  it('validates editor and clipboard requests', () => {
    expect(invokeSchemas['editor:openInCode'].safeParse({ path: '/work/acme/src/main.ts' }).success).toBe(true)
    expect(
      invokeSchemas['editor:openInCode'].safeParse({ path: '/work/acme/src/main.ts', line: 42 }).success
    ).toBe(true)
    expect(
      invokeSchemas['editor:openInCode'].safeParse({ path: '/work/acme/src/main.ts', line: 0 }).success
    ).toBe(false)
    expect(invokeSchemas['app:copyText'].safeParse({ text: '/work/acme/src/main.ts' }).success).toBe(true)
    expect(invokeSchemas['app:copyText'].safeParse({}).success).toBe(false)
  })

  it('validates worktree requests', () => {
    const gitDir = '/work/acme/.git'
    const path = '/work/acme-feat'

    expect(invokeSchemas['git:worktrees'].safeParse({ gitDir }).success).toBe(true)
    expect(invokeSchemas['git:worktrees'].safeParse({}).success).toBe(false)

    expect(invokeSchemas['git:worktreeAdd'].safeParse({ gitDir, path, branch: 'feat' }).success).toBe(true)
    expect(
      invokeSchemas['git:worktreeAdd'].safeParse({ gitDir, path, newBranch: 'feat', base: 'main' }).success
    ).toBe(true)
    expect(invokeSchemas['git:worktreeAdd'].safeParse({ gitDir, path, detachAt: 'v1.0.0' }).success).toBe(true)

    // Exactly one mode, and base belongs to newBranch only.
    expect(invokeSchemas['git:worktreeAdd'].safeParse({ gitDir, path }).success).toBe(false)
    expect(
      invokeSchemas['git:worktreeAdd'].safeParse({ gitDir, path, branch: 'a', detachAt: 'b' }).success
    ).toBe(false)
    expect(
      invokeSchemas['git:worktreeAdd'].safeParse({ gitDir, path, branch: 'feat', base: 'main' }).success
    ).toBe(false)

    expect(
      invokeSchemas['git:worktreeRemove'].safeParse({ gitDir, path, force: true }).success
    ).toBe(true)
    expect(invokeSchemas['git:worktreeRemove'].safeParse({ gitDir }).success).toBe(false)
    expect(invokeSchemas['git:worktreePrune'].safeParse({ gitDir }).success).toBe(true)
    expect(
      invokeSchemas['git:worktreeLock'].safeParse({ gitDir, path, reason: 'in use' }).success
    ).toBe(true)
    expect(invokeSchemas['git:worktreeUnlock'].safeParse({ gitDir, path }).success).toBe(true)
  })

  it('validates submodule requests', () => {
    const gitDir = '/work/acme/.git'

    expect(invokeSchemas['git:submodules'].safeParse({ gitDir }).success).toBe(true)
    expect(invokeSchemas['git:submoduleUpdate'].safeParse({ gitDir }).success).toBe(true)
    expect(
      invokeSchemas['git:submoduleUpdate'].safeParse({
        gitDir,
        paths: ['libs/core'],
        init: true,
        recursive: true
      }).success
    ).toBe(true)
    expect(invokeSchemas['git:submoduleUpdate'].safeParse({ gitDir, paths: ['../escape'] }).success).toBe(false)
    expect(invokeSchemas['git:submoduleUpdate'].safeParse({ gitDir, paths: [] }).success).toBe(false)
    expect(
      invokeSchemas['git:submoduleSync'].safeParse({ gitDir, paths: ['libs/core'], recursive: true }).success
    ).toBe(true)
    expect(invokeSchemas['git:submoduleSync'].safeParse({ gitDir, paths: ['libs\\core'] }).success).toBe(false)
  })
})
