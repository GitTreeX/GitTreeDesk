import { z } from 'zod'
import type { InvokeChannel, InvokeMap } from './ipc'

const pathString = z.string().min(1).max(4096)
const keyString = z.string().min(1).max(512)
const keyPath = z.array(keyString).min(1).max(32)
const scope = z.enum(['user', 'workspace'])
const refString = z.string().min(1).max(1024)
const sessionId = z.string().min(1).max(64)
const branchName = z.string().min(1).max(255)
const remoteName = z.string().min(1).max(255)
const remoteUrl = z.string().min(1).max(2048)
const entryName = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => name !== '.' && name !== '..' && !/[/\\\u0000-\u001f]/.test(name), {
    message: 'must be a plain entry name without path separators'
  })
const repoRelPath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) => {
      if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return false
      const trimmed = value.endsWith('/') ? value.slice(0, -1) : value
      if (trimmed.length === 0) return false
      return trimmed.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    },
    { message: 'must be a repo-relative path without traversal segments' }
  )

const diffSource = z.object({
  kind: z.enum(['worktree', 'index', 'rev']),
  rev: refString.optional()
})

/** A `rev` side is meaningless without the revision it names. */
const revSideComplete = (side: { kind: string; rev?: string }): boolean =>
  side.kind !== 'rev' || (side.rev !== undefined && side.rev.length > 0)

/**
 * Request schemas for every invoke channel, validated on the main side before a
 * handler runs. Responses are trusted (main authors them) and only typed.
 */
export const invokeSchemas = {
  'workspace:open': z.object({ root: pathString }),
  'workspace:close': z.undefined(),
  'workspace:recent': z.undefined(),
  'workspace:rescan': z.object({
    dirs: z.array(pathString).max(1024).optional(),
    raiseBudget: z.boolean().optional()
  }),
  'workspace:pick': z.undefined(),
  'workspace:removeRecent': z.object({ root: pathString }),
  'git:status': z.object({ gitDir: pathString, refresh: z.boolean().optional() }),
  'git:stage': z.object({ gitDir: pathString, paths: z.array(repoRelPath).min(1).max(1024) }),
  'git:unstage': z.object({ gitDir: pathString, paths: z.array(repoRelPath).min(1).max(1024) }),
  'git:discard': z.object({ gitDir: pathString, paths: z.array(repoRelPath).min(1).max(1024) }),
  'git:stageAll': z.object({ gitDir: pathString }),
  'git:unstageAll': z.object({ gitDir: pathString }),
  'git:ignore': z.object({ gitDir: pathString, path: repoRelPath }),
  'git:diff': z
    .object({
      gitDir: pathString,
      path: repoRelPath,
      origPath: repoRelPath.optional(),
      from: diffSource,
      to: diffSource,
      allowLarge: z.boolean().optional()
    })
    .refine((value) => revSideComplete(value.from) && revSideComplete(value.to), {
      message: 'rev source requires a revision'
    }),
  'git:applyHunk': z.object({
    gitDir: pathString,
    patch: z.string().min(1).max(5_000_000),
    mode: z.enum(['stage', 'unstage', 'revert']),
    zeroContext: z.boolean().optional()
  }),
  'git:commit': z.object({
    gitDir: pathString,
    message: z.string().max(100_000),
    signOff: z.boolean().optional(),
    amend: z.boolean().optional(),
    stageAll: z.boolean().optional()
  }),
  'git:headCommit': z.object({ gitDir: pathString }),
  'git:fileHistory': z.object({
    gitDir: pathString,
    path: repoRelPath,
    limit: z.number().int().min(1).max(1000).optional(),
    skip: z.number().int().min(0).max(1_000_000).optional(),
    follow: z.boolean().optional()
  }),
  'git:refs': z.object({ gitDir: pathString }),
  'git:branchCheckout': z.object({ gitDir: pathString, name: branchName }),
  'git:checkoutDetach': z.object({ gitDir: pathString, rev: refString }),
  'git:branchCreate': z.object({
    gitDir: pathString,
    name: branchName,
    startPoint: refString.optional(),
    checkout: z.boolean().optional(),
    upstream: refString.optional()
  }),
  'git:branchRename': z.object({ gitDir: pathString, name: branchName, newName: branchName }),
  'git:branchDelete': z.object({
    gitDir: pathString,
    name: branchName,
    force: z.boolean().optional()
  }),
  'git:branchSetUpstream': z.object({
    gitDir: pathString,
    name: branchName,
    upstream: refString
  }),
  'git:remotes': z.object({ gitDir: pathString }),
  'git:remoteAdd': z.object({ gitDir: pathString, name: remoteName, url: remoteUrl }),
  'git:remoteRemove': z.object({ gitDir: pathString, name: remoteName }),
  'git:remoteSetUrl': z.object({
    gitDir: pathString,
    name: remoteName,
    url: remoteUrl,
    push: z.boolean().optional()
  }),
  'git:fetch': z.object({
    gitDir: pathString,
    remote: remoteName.optional(),
    prune: z.boolean().optional(),
    followTags: z.boolean().optional()
  }),
  'git:fetchMany': z.object({
    gitDirs: z.array(pathString).min(1).max(1024),
    prune: z.boolean().optional(),
    followTags: z.boolean().optional()
  }),
  'git:pull': z.object({
    gitDir: pathString,
    remote: remoteName.optional(),
    branch: branchName.optional()
  }),
  'git:pullMany': z.object({ gitDirs: z.array(pathString).min(1).max(1024) }),
  'git:push': z.object({
    gitDir: pathString,
    branch: branchName,
    remotes: z.array(remoteName).max(32).optional(),
    upstreamRemote: remoteName.optional(),
    forceWithLease: z.boolean().optional()
  }),
  'git:tagCreate': z.object({
    gitDir: pathString,
    name: branchName,
    target: refString,
    message: z.string().max(100_000).optional(),
    push: z.boolean().optional(),
    remote: remoteName.optional()
  }),
  'git:tagDelete': z.object({ gitDir: pathString, name: branchName }),
  'git:tagPush': z.object({
    gitDir: pathString,
    name: branchName,
    remote: remoteName.optional()
  }),
  'git:tagPushAll': z.object({ gitDir: pathString, remote: remoteName.optional() }),
  'git:tagDeleteRemote': z.object({
    gitDir: pathString,
    name: branchName,
    remote: remoteName.optional()
  }),
  'git:remoteTags': z.object({ gitDir: pathString, remote: remoteName.optional() }),
  'git:diffFiles': z
    .object({
      gitDir: pathString,
      from: diffSource,
      to: diffSource,
      path: repoRelPath.optional()
    })
    .refine((value) => revSideComplete(value.from) && revSideComplete(value.to), {
      message: 'rev source requires a revision'
    }),
  'git:merge': z.object({
    gitDir: pathString,
    rev: refString,
    mode: z.enum(['default', 'no-ff', 'ff-only', 'squash']).optional()
  }),
  'git:rebase': z.object({ gitDir: pathString, onto: refString }),
  'git:rebasePlan': z.object({ gitDir: pathString, base: refString }),
  'git:rebaseInteractive': z.object({
    gitDir: pathString,
    base: refString,
    steps: z
      .array(
        z.object({
          sha: refString,
          action: z.enum(['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']),
          message: z.string().max(100_000).optional()
        })
      )
      .min(1)
      .max(1000)
  }),
  'git:opContinue': z.object({ gitDir: pathString }),
  'git:opSkip': z.object({ gitDir: pathString }),
  'git:opAbort': z.object({ gitDir: pathString }),
  'git:cherryPick': z.object({
    gitDir: pathString,
    revs: z.array(refString).min(1).max(100),
    noCommit: z.boolean().optional(),
    mainline: z.number().int().min(1).max(100).optional()
  }),
  'git:revert': z.object({
    gitDir: pathString,
    revs: z.array(refString).min(1).max(100),
    noCommit: z.boolean().optional(),
    mainline: z.number().int().min(1).max(100).optional()
  }),
  'git:reset': z.object({
    gitDir: pathString,
    target: refString,
    mode: z.enum(['soft', 'mixed', 'hard'])
  }),
  'git:conflictResolve': z.object({
    gitDir: pathString,
    path: repoRelPath,
    resolution: z.enum(['ours', 'theirs', 'both'])
  }),
  'git:openMergeTool': z.object({ gitDir: pathString, path: pathString }),
  'git:stashCreate': z.object({
    gitDir: pathString,
    message: z.string().max(10_000).optional(),
    includeUntracked: z.boolean().optional(),
    keepIndex: z.boolean().optional(),
    paths: z.array(repoRelPath).min(1).max(1024).optional()
  }),
  'git:stashList': z.object({ gitDir: pathString }),
  'git:stashFiles': z.object({ gitDir: pathString, stash: refString }),
  'git:stashDiff': z.object({ gitDir: pathString, stash: refString, path: repoRelPath.optional() }),
  'git:stashApply': z.object({ gitDir: pathString, stash: refString }),
  'git:stashPop': z.object({ gitDir: pathString, stash: refString }),
  'git:stashDrop': z.object({ gitDir: pathString, stash: refString }),
  'git:log': z.object({
    gitDir: pathString,
    revs: z.array(refString).max(64).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    skip: z.number().int().min(0).max(1_000_000).optional()
  }),
  'git:graph': z.object({
    gitDir: pathString,
    revs: z.array(refString).max(64).optional(),
    author: z.string().max(1000).optional(),
    since: z.string().max(1000).optional(),
    until: z.string().max(1000).optional(),
    grep: z.string().max(1000).optional(),
    path: repoRelPath.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    skip: z.number().int().min(0).max(1_000_000).optional(),
    countTotal: z.boolean().optional()
  }),
  'git:activity': z.object({
    gitDirs: z.array(pathString).max(2000),
    since: z.string().max(1000).optional(),
    maxPerRepo: z.number().int().min(1).max(2000).optional(),
    author: z.string().max(1000).optional(),
    grep: z.string().max(1000).optional()
  }),
  'git:commitDetails': z.object({ gitDir: pathString, sha: refString }),
  'git:editCommit': z
    .object({
      gitDir: pathString,
      targets: z.array(refString).min(1).max(100),
      message: z.string().min(1).max(100_000).optional(),
      authorName: z.string().min(1).max(1000).optional(),
      authorEmail: z.string().min(1).max(1000).optional(),
      authorDate: z.string().min(1).max(1000).optional(),
      committerDate: z.string().min(1).max(1000).optional()
    })
    .refine((value) => value.targets.length === 1 || value.message === undefined, {
      message: 'a replacement message is only valid for a single commit'
    })
    .refine((value) => (value.authorName === undefined) === (value.authorEmail === undefined), {
      message: 'the author name and email go together'
    }),
  'git:oplog': z.object({
    gitDir: pathString,
    limit: z.number().int().min(1).max(500).optional()
  }),
  'git:oplogUndo': z.object({ gitDir: pathString, entryId: z.number().int().positive() }),
  'git:backups': z.object({ gitDir: pathString }),
  'git:restoreBackup': z.object({ gitDir: pathString, ref: refString }),
  'git:worktrees': z.object({ gitDir: pathString }),
  'git:worktreeAdd': z
    .object({
      gitDir: pathString,
      path: pathString,
      branch: branchName.optional(),
      newBranch: branchName.optional(),
      base: refString.optional(),
      detachAt: refString.optional()
    })
    .refine(
      (value) => {
        const modes = [value.branch, value.newBranch, value.detachAt].filter(
          (entry) => entry !== undefined
        )
        return modes.length === 1 && (value.base === undefined || value.newBranch !== undefined)
      },
      { message: 'exactly one of branch, newBranch or detachAt is required; base requires newBranch' }
    ),
  'git:worktreeMove': z.object({
    gitDir: pathString,
    path: pathString,
    target: pathString
  }),
  'git:worktreeRemove': z.object({
    gitDir: pathString,
    path: pathString,
    force: z.boolean().optional()
  }),
  'git:worktreePrune': z.object({ gitDir: pathString }),
  'git:worktreeLock': z.object({
    gitDir: pathString,
    path: pathString,
    reason: z.string().max(1000).optional()
  }),
  'git:worktreeUnlock': z.object({ gitDir: pathString, path: pathString }),
  'git:submodules': z.object({ gitDir: pathString }),
  'git:submoduleUpdate': z.object({
    gitDir: pathString,
    paths: z.array(repoRelPath).min(1).max(1024).optional(),
    init: z.boolean().optional(),
    recursive: z.boolean().optional()
  }),
  'git:submoduleSync': z.object({
    gitDir: pathString,
    paths: z.array(repoRelPath).min(1).max(1024).optional(),
    recursive: z.boolean().optional()
  }),
  'git:submoduleAdd': z.object({
    gitDir: pathString,
    /** A URL, or a local path when the file protocol is allowed. */
    url: z.string().min(1).max(2000),
    path: repoRelPath.optional(),
    branch: z.string().min(1).max(255).optional(),
    force: z.boolean().optional()
  }),
  'git:submoduleDeinit': z.object({
    gitDir: pathString,
    paths: z.array(repoRelPath).min(1).max(1024),
    force: z.boolean().optional()
  }),
  'commitmsg:generate': z.object({ gitDir: pathString }),
  'commitmsg:cancel': z.object({ generationId: z.string().min(1).max(64) }),
  'commitmsg:approveHost': z.object({ host: z.string().min(1).max(255) }),
  'commitmsg:setKey': z.object({ key: z.string().min(1).max(8192) }),
  'commitmsg:removeKey': z.undefined(),
  'commitmsg:keyStatus': z.undefined(),
  'terminal:resolve': z.object({ dir: pathString }),
  'terminal:create': z.object({
    dir: pathString,
    profileId: z.string().min(1).max(256),
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(1).max(1000)
  }),
  'terminal:quickRun': z.object({
    dir: pathString,
    name: z.string().min(1).max(256),
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(1).max(1000)
  }),
  'terminal:sessions': z.undefined(),
  'terminal:attach': z.object({ id: sessionId }),
  'terminal:write': z.object({ id: sessionId, data: z.string().max(1_000_000) }),
  'terminal:resize': z.object({
    id: sessionId,
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(1).max(1000)
  }),
  'terminal:kill': z.object({ id: sessionId }),
  'terminal:dispose': z.object({ id: sessionId }),
  'fs:readDir': z.object({ path: pathString }),
  'fs:readFile': z.object({ path: pathString, allowLarge: z.boolean().optional() }),
  'fs:stat': z.object({ path: pathString }),
  'fs:writeFile': z.object({
    path: pathString,
    text: z.string().max(20_000_000),
    expectedMtimeMs: z.number().nonnegative().optional()
  }),
  'workspace:listFiles': z.object({ limit: z.number().int().min(1).max(200_000).optional() }),
  'fs:create': z.object({ parent: pathString, name: entryName, kind: z.enum(['file', 'dir']) }),
  'fs:rename': z.object({ path: pathString, newName: entryName }),
  'fs:duplicate': z.object({ path: pathString, suffix: z.string().min(1).max(64) }),
  'fs:trash': z.object({ path: pathString }),
  'fs:reveal': z.object({ path: pathString }),
  'fs:openExternal': z.object({ path: pathString }),
  'fs:watch': z.object({ path: pathString }),
  'fs:unwatch': z.object({ path: pathString }),
  'editor:openInCode': z.object({
    path: pathString,
    line: z.number().int().positive().max(10_000_000).optional()
  }),
  'app:copyText': z.object({ text: z.string().max(1_000_000) }),
  'settings:get': z.object({ scope, keyPath }),
  'settings:getAll': z.object({ scope }),
  'settings:getEffective': z.object({ keyPath }),
  'settings:set': z.object({ scope, keyPath, value: z.unknown() }),
  'settings:remove': z.object({ scope, keyPath }),
  'keybindings:get': z.undefined(),
  'keybindings:set': z.object({ command: z.string().min(1).max(200), keys: z.string().max(200).nullable() }),
  'keybindings:reset': z.object({ command: z.string().min(1).max(200) }),
  'app:openFolder': z.object({ kind: z.enum(['logs', 'userData']) }),
  'trust:query': z.undefined(),
  'trust:grant': z.object({ trusted: z.boolean() }),
  'ui-state:get': z.object({ key: keyString }),
  'ui-state:set': z.object({ key: keyString, value: z.unknown() }),
  'ui-state:keys': z.object({ prefix: z.string().max(512).optional() }),
  'ui-state:delete': z.object({ key: keyString }),
  'app:info': z.undefined(),
  'app:perfStats': z.undefined()
} satisfies { [K in InvokeChannel]: z.ZodTypeAny }

/** Compile-time guard: every schema's output must match its channel's request type. */
export const checkedInvokeSchemas: { [K in InvokeChannel]: z.ZodType<InvokeMap[K]['request']> } =
  invokeSchemas

export type InvokeSchemaMap = { [K in InvokeChannel]: z.ZodTypeAny }
