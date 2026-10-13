const cache = new Map<string, RegExp>()

/**
 * Minimal glob for workspace group patterns: `*` stays inside a segment, `**`
 * crosses segments, `?` matches one character. Patterns are relative to the
 * workspace root and use forward slashes.
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/')
  const cached = cache.get(normalized)
  if (cached !== undefined) return cached

  let source = '^'
  let index = 0
  while (index < normalized.length) {
    const char = normalized[index]!
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 3
        } else {
          source += '.*'
          index += 2
        }
        continue
      }
      source += '[^/]*'
      index += 1
      continue
    }
    if (char === '?') {
      source += '[^/]'
      index += 1
      continue
    }
    source += /[.*+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
    index += 1
  }
  source += '$'

  const regex = new RegExp(source)
  cache.set(normalized, regex)
  return regex
}

export function matchGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path)
}

export function matchesAnyGlob(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => matchGlob(pattern, path))
}
