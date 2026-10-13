import type { BackupRef } from '@gitreedesk/shared'
import { runGit, runGitOrThrow } from './run'

export const BACKUP_REF_PREFIX = 'refs/gitreedesk/backup/'

const OP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const OP_MAX_LENGTH = 40

/** `yyyyMMdd-HHmmss` in UTC. */
export function formatBackupTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  )
}

export function parseBackupTimestamp(stamp: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp)
  if (match === null) return null

  const [, year, month, day, hour, minute, second] = match
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null
  }

  const monthNumber = Number(month)
  const dayNumber = Number(day)
  const hourNumber = Number(hour)
  const minuteNumber = Number(minute)
  const secondNumber = Number(second)
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31 ||
    hourNumber > 23 ||
    minuteNumber > 59 ||
    secondNumber > 59
  ) {
    return null
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
}

export function parseBackupRefName(fullName: string): { op: string; createdAt: string } | null {
  if (!fullName.startsWith(BACKUP_REF_PREFIX)) return null

  const rest = fullName.slice(BACKUP_REF_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null

  const op = rest.slice(0, slash)
  if (op.length > OP_MAX_LENGTH || !OP_SLUG_RE.test(op)) return null

  let stamp = rest.slice(slash + 1)
  const suffixed = /^(\d{8}-\d{6})-(\d+)$/.exec(stamp)
  if (suffixed !== null) stamp = suffixed[1] ?? ''

  const createdAt = parseBackupTimestamp(stamp)
  if (createdAt === null) return null
  return { op, createdAt }
}

export interface CreateBackupRefOptions {
  repoPath: string
  /** Operation slug such as `reset-hard` or `branch-delete`. */
  op: string
  /** Revision to back up; resolved to a commit before the ref is created. */
  target: string
  signal?: AbortSignal
}

export async function createBackupRef(options: CreateBackupRefOptions): Promise<BackupRef> {
  const { op, target } = options
  if (op.length > OP_MAX_LENGTH || !OP_SLUG_RE.test(op)) throw new Error(`Invalid backup op: ${op}`)
  if (target.length === 0 || target.startsWith('-')) throw new Error(`Invalid backup target: ${target}`)

  const resolved = await runGitOrThrow(['rev-parse', '--verify', `${target}^{commit}`], {
    cwd: options.repoPath,
    signal: options.signal
  })
  const sha = resolved.stdout.trim()

  const now = new Date()
  const iso = `${now.toISOString().slice(0, 19)}Z`
  const stamp = formatBackupTimestamp(now)

  let ref = `${BACKUP_REF_PREFIX}${op}/${stamp}`
  let suffix = 1
  for (;;) {
    const probe = await runGit(['show-ref', '--verify', '--quiet', ref], {
      cwd: options.repoPath,
      signal: options.signal
    })
    if (probe.code !== 0) break
    suffix += 1
    ref = `${BACKUP_REF_PREFIX}${op}/${stamp}-${String(suffix)}`
  }

  await runGitOrThrow(['update-ref', ref, sha], { cwd: options.repoPath, signal: options.signal })
  return { ref, op, sha, createdAt: iso }
}

export function parseBackupRefs(stdout: string): BackupRef[] {
  const backups: BackupRef[] = []

  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue

    const [ref = '', sha = ''] = line.split('\0')
    const parsed = parseBackupRefName(ref)
    if (parsed === null || sha.length === 0) continue

    backups.push({ ref, op: parsed.op, sha, createdAt: parsed.createdAt })
  }

  return backups
}

export interface ListBackupRefsOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function listBackupRefs(options: ListBackupRefsOptions): Promise<BackupRef[]> {
  const result = await runGitOrThrow(
    ['for-each-ref', '--format=%(refname)%00%(objectname)', BACKUP_REF_PREFIX],
    { cwd: options.repoPath, signal: options.signal }
  )
  return parseBackupRefs(result.stdout).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.ref.localeCompare(a.ref)
  )
}
