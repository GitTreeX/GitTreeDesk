import { realpath } from 'node:fs/promises'
import { basename, dirname, posix } from 'node:path'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

/**
 * Posix real path of `path`, or — when the leaf is gone — the real path of its nearest
 * existing ancestor with the remaining segments appended. A deleted directory therefore
 * still carries the spelling every other path in the workspace uses, which is what
 * depth calculations and containment checks compare against.
 */
export async function canonicalPath(path: string): Promise<string> {
  const direct = await realpath(path).then(toPosix).catch(() => null)
  if (direct !== null) return direct

  const tail: string[] = []
  let current = path
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return toPosix(path)
    tail.unshift(basename(current))
    const base = await realpath(parent).then(toPosix).catch(() => null)
    if (base !== null) return tail.reduce((acc, segment) => posix.join(acc, segment), base)
    current = parent
  }
}
