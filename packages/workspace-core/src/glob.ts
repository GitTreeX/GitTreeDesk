import picomatch from 'picomatch'

const NOCASE = process.platform === 'win32'

/** Matches POSIX relative paths against glob patterns. Empty pattern lists match nothing. */
export function createPathMatcher(patterns: readonly string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false
  const isMatch = picomatch([...patterns], { dot: true, nocase: NOCASE })
  return (path: string) => isMatch(path)
}

/**
 * Subtree selector semantics: true when the path itself or any ancestor segment chain
 * matches one of the patterns. `backend/*` therefore also selects `backend/team/api`.
 */
export function matchesSubtree(patterns: readonly string[], path: string): boolean {
  const match = createPathMatcher(patterns)
  if (match(path)) return true

  const segments = path.split('/')
  for (let i = segments.length - 1; i > 0; i -= 1) {
    if (match(segments.slice(0, i).join('/'))) return true
  }
  return false
}
