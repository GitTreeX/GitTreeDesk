import type { GitVersionInfo } from '@gitreedesk/shared'
import { GitCommandError } from './errors'
import { runGit } from './run'

const MINIMUM = { major: 2, minor: 23 }
const RECOMMENDED = { major: 2, minor: 36 }

export async function probeGitVersion(options: { cwd?: string } = {}): Promise<GitVersionInfo> {
  const cwd = options.cwd ?? process.cwd()
  const args = ['--version'] as const
  const result = await runGit(args, { cwd, timeoutMs: 10_000 })

  if (result.code !== 0) {
    throw new GitCommandError('git --version did not run successfully', {
      args,
      cwd,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }

  const raw = result.stdout.trim()
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw)
  if (match === null) {
    throw new GitCommandError(`Unrecognized git version string: ${raw}`, {
      args,
      cwd,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }

  const [, majorStr = '0', minorStr = '0', patchStr = '0'] = match
  const major = Number(majorStr)
  const minor = Number(minorStr)
  const patch = Number(patchStr)

  const belowMinimum = major < MINIMUM.major || (major === MINIMUM.major && minor < MINIMUM.minor)
  const belowRecommended = major < RECOMMENDED.major || (major === RECOMMENDED.major && minor < RECOMMENDED.minor)

  return { raw, major, minor, patch, supported: !belowMinimum, warn: !belowMinimum && belowRecommended }
}
