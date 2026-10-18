import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  ChangeKind,
  DiffSource,
  FileChange,
  FsFileKind,
  GitDiffRequest,
  GitDiffResponse,
  GitDiffSide
} from '@gitreedesk/shared'
import { classifyContent, contentCapFor, DIFF_LIMITS } from './content'
import { runGit, runGitOrThrow, runGitRaw } from './run'
import { LITERAL_PATHS_ENV } from './staging'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const PATCH_LIMIT = 4 * 1024 * 1024

export interface ReadDiffOptions {
  signal?: AbortSignal
}

interface SideContent {
  exists: boolean
  size: number
  kind: FsFileKind
  text: string | null
  dataUrl: string | null
}

const MISSING_SIDE: SideContent = { exists: false, size: 0, kind: 'text', text: null, dataUrl: null }

/** `rev:path` resolves the path as a tree glob; escaping keeps names like `a[1].txt` literal. */
function escapeRevPath(filePath: string): string {
  return filePath.replace(/[\\?*[\]]/g, '\\$&')
}

async function resolveEffectiveRev(repoPath: string, rev: string, signal?: AbortSignal): Promise<string> {
  if (rev.toUpperCase() !== 'HEAD') return rev
  const probe = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: repoPath, signal })
  return probe.code === 0 ? rev : EMPTY_TREE
}

async function worktreeRoot(repoPath: string, signal?: AbortSignal): Promise<string | null> {
  const result = await runGit(['rev-parse', '--show-toplevel'], { cwd: repoPath, signal })
  if (result.code !== 0) return null
  const top = result.stdout.trim()
  return top.length > 0 ? top.replace(/\\/g, '/') : null
}

/** Index entry for a path: stage 0 normally, ours/theirs for conflicts. */
async function indexBlobSha(repoPath: string, filePath: string, signal?: AbortSignal): Promise<string | null> {
  const result = await runGit(['ls-files', '--stage', '-z', '--', filePath], {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal
  })
  if (result.code !== 0) return null
  const byStage = new Map<number, string>()
  for (const entry of result.stdout.split('\0')) {
    if (entry.length === 0) continue
    const tab = entry.indexOf('\t')
    if (tab === -1) continue
    const meta = entry.slice(0, tab).split(' ')
    if (meta.length < 3) continue
    const sha = meta[1]
    const stage = Number.parseInt(meta[2] ?? '', 10)
    if (sha !== undefined && !Number.isNaN(stage)) byStage.set(stage, sha)
  }
  return byStage.get(0) ?? byStage.get(2) ?? byStage.get(3) ?? null
}

async function readObjectSide(
  repoPath: string,
  spec: string,
  filePath: string,
  allowLarge: boolean,
  signal?: AbortSignal
): Promise<SideContent> {
  const sized = await runGit(['cat-file', '-s', spec], { cwd: repoPath, signal })
  if (sized.code !== 0) return MISSING_SIDE
  const size = Number.parseInt(sized.stdout.trim(), 10)
  if (Number.isNaN(size)) return MISSING_SIDE
  if (size > contentCapFor(filePath, allowLarge, DIFF_LIMITS)) {
    return { exists: true, size, kind: 'tooLarge', text: null, dataUrl: null }
  }
  const blob = await runGitRaw(['cat-file', 'blob', spec], { cwd: repoPath, signal })
  if (blob.code !== 0) return MISSING_SIDE
  return { exists: true, size, ...classifyContent(blob.stdout, filePath, allowLarge, DIFF_LIMITS) }
}

async function readWorktreeSide(
  root: string,
  filePath: string,
  allowLarge: boolean,
  signal?: AbortSignal
): Promise<SideContent> {
  const absolute = path.join(root, ...filePath.split('/'))
  try {
    const stats = await stat(absolute)
    if (!stats.isFile()) return MISSING_SIDE
    if (stats.size > contentCapFor(filePath, allowLarge, DIFF_LIMITS)) {
      return { exists: true, size: stats.size, kind: 'tooLarge', text: null, dataUrl: null }
    }
    const buffer = await readFile(absolute, { signal })
    return { exists: true, size: stats.size, ...classifyContent(buffer, filePath, allowLarge, DIFF_LIMITS) }
  } catch {
    return MISSING_SIDE
  }
}

interface SideRead {
  label: string
  side: SideContent
}

async function readSide(
  repoPath: string,
  root: string | null,
  source: DiffSource,
  filePath: string,
  allowLarge: boolean,
  signal?: AbortSignal
): Promise<SideRead> {
  if (source.kind === 'worktree') {
    const side = root === null ? MISSING_SIDE : await readWorktreeSide(root, filePath, allowLarge, signal)
    return { label: 'WORKTREE', side }
  }
  if (source.kind === 'index') {
    const sha = await indexBlobSha(repoPath, filePath, signal)
    const side = sha === null ? MISSING_SIDE : await readObjectSide(repoPath, sha, filePath, allowLarge, signal)
    return { label: 'INDEX', side }
  }
  const rev = source.rev ?? 'HEAD'
  const effective = await resolveEffectiveRev(repoPath, rev, signal)
  const side = await readObjectSide(repoPath, `${effective}:${escapeRevPath(filePath)}`, filePath, allowLarge, signal)
  return { label: rev, side }
}

/** Hunks only make sense for content transitions git can re-apply; renames render display-only. */
async function buildPatch(repoPath: string, request: GitDiffRequest, signal?: AbortSignal): Promise<string> {
  if (request.origPath !== undefined) return ''
  const { from, to } = request
  const args: string[] = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3']
  if (from.kind === 'index' && to.kind === 'worktree') {
    // Plain `git diff` compares index to worktree.
  } else if (from.kind === 'rev' && to.kind === 'index') {
    args.push('--cached', await resolveEffectiveRev(repoPath, from.rev ?? 'HEAD', signal))
  } else if (from.kind === 'rev' && to.kind === 'worktree') {
    args.push(await resolveEffectiveRev(repoPath, from.rev ?? 'HEAD', signal))
  } else {
    return ''
  }
  const result = await runGit([...args, '--', request.path], {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal
  })
  if (result.code !== 0 || result.stdout.length > PATCH_LIMIT) return ''
  return result.stdout
}

function mergeKind(oldSide: SideContent, newSide: SideContent): FsFileKind {
  const kinds = [oldSide, newSide].filter((side) => side.exists).map((side) => side.kind)
  if (kinds.includes('tooLarge')) return 'tooLarge'
  if (kinds.includes('binary')) return 'binary'
  if (kinds.includes('image')) return 'image'
  return 'text'
}

export async function readDiff(
  repoPath: string,
  request: GitDiffRequest,
  options: ReadDiffOptions = {}
): Promise<GitDiffResponse> {
  const signal = options.signal
  const allowLarge = request.allowLarge === true
  const oldPath = request.origPath ?? request.path
  const [root, patch] = await Promise.all([
    worktreeRoot(repoPath, signal),
    buildPatch(repoPath, request, signal)
  ])
  const [oldRead, newRead] = await Promise.all([
    readSide(repoPath, root, request.from, oldPath, allowLarge, signal),
    readSide(repoPath, root, request.to, request.path, allowLarge, signal)
  ])
  const toSide = (read: SideRead): GitDiffSide => ({
    label: read.label,
    exists: read.side.exists,
    size: read.side.size,
    text: read.side.text,
    dataUrl: read.side.dataUrl
  })
  return {
    path: request.path,
    origPath: request.origPath ?? null,
    kind: mergeKind(oldRead.side, newRead.side),
    patch,
    old: toSide(oldRead),
    new: toSide(newRead)
  }
}

const KIND_BY_STATUS: Record<string, ChangeKind> = {
  A: 'added',
  M: 'modified',
  T: 'typeChanged',
  D: 'deleted',
  R: 'renamed',
  C: 'copied'
}

/**
 * Parses `git diff --name-status -z`: `<status>\0<path>\0` per entry, with
 * status and path NUL-separated; renames/copies (`R100`, `C75`, …) carry the
 * old path and the new path as two tokens.
 */
export function parseNameStatusZ(stdout: string): FileChange[] {
  const tokens = stdout.split('\0')
  const files: FileChange[] = []
  let index = 0
  while (index < tokens.length) {
    const status = tokens[index]
    index += 1
    if (status === undefined || status.length === 0) continue

    const letter = (status[0] ?? '').toUpperCase()
    const first = tokens[index] ?? ''
    index += 1
    const paired = letter === 'R' || letter === 'C'
    let second = first
    if (paired) {
      second = tokens[index] ?? ''
      index += 1
    }
    if (first.length === 0 || second.length === 0) continue

    const kind = KIND_BY_STATUS[letter] ?? 'modified'
    files.push(paired ? { path: second, origPath: first, kind } : { path: first, kind })
  }
  return files
}

export interface ListChangedFilesOptions {
  from: DiffSource
  to: DiffSource
  /** Repo-relative file or directory; only changes under it are listed. */
  path?: string
  signal?: AbortSignal
}

function assertUsableRev(rev: string): string {
  if (rev.length === 0 || rev.startsWith('-')) throw new Error(`Invalid revision: ${JSON.stringify(rev)}`)
  return rev
}

/**
 * The revision arguments of `git diff --name-status`, empty when the two sides
 * describe the same content by definition. The working tree only ever sits on
 * the new side and the index only beside the working tree, because git has no
 * argument form that reads the working tree as the older side.
 */
async function nameStatusRevs(
  repoPath: string,
  from: DiffSource,
  to: DiffSource,
  signal?: AbortSignal
): Promise<string[] | null> {
  if (from.kind === 'rev') {
    const rev = assertUsableRev(await resolveEffectiveRev(repoPath, from.rev ?? 'HEAD', signal))
    if (to.kind === 'worktree') return [rev]
    if (to.kind === 'index') return ['--cached', rev]
    const other = assertUsableRev(await resolveEffectiveRev(repoPath, to.rev ?? 'HEAD', signal))
    return rev === other ? null : [rev, other]
  }
  if (from.kind === 'index') {
    if (to.kind === 'index') return null
    if (to.kind === 'worktree') return []
    throw new Error('The index is only comparable with the working tree')
  }
  if (from.kind === 'worktree') {
    if (to.kind === 'worktree') return null
    throw new Error('The working tree can only be the newer side of a comparison')
  }
  throw new Error(`Unknown comparison side: ${JSON.stringify(from)}`)
}

/**
 * Files that differ between two sides, with rename detection on. A `path`
 * narrows the listing to one file or directory.
 */
export async function listChangedFiles(
  repoPath: string,
  options: ListChangedFilesOptions
): Promise<FileChange[]> {
  const revs = await nameStatusRevs(repoPath, options.from, options.to, options.signal)
  if (revs === null) return []
  const args = ['diff', '--name-status', '-z', '-M', ...revs]
  if (options.path !== undefined) args.push('--', options.path)
  const result = await runGitOrThrow(args, {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal: options.signal
  })
  return parseNameStatusZ(result.stdout)
}
