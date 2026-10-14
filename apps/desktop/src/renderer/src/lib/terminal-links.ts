/**
 * Plain-text link extraction for terminal output: `path:line` / `path:line:col`
 * tokens. Pure string work so it runs (and is tested) outside the renderer.
 */

export interface PathLink {
  /** The matched token, e.g. `src/app.ts:12:3`. */
  text: string
  /** The path part, e.g. `src/app.ts`. */
  path: string
  line: number
  column: number | null
  /** Index of the match start within the line. */
  start: number
  /** Index just past the match end. */
  end: number
}

const TOKEN = /[^\s"'`()[\]{}<>]+?:\d+(?::\d+)?/g
const SCHEME = /^[a-z][\w+.-]*:\/\//i

/** A real path needs a separator or an extension; this filters out `12:30`-style hits. */
function looksLikePath(text: string): boolean {
  return /[\\/]/.test(text) || /\.[A-Za-z0-9]+$/.test(text)
}

/** Finds `path:line[:col]` tokens in one line; URLs are skipped. */
export function findPathLinks(text: string): PathLink[] {
  const links: PathLink[] = []
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0]
    if (SCHEME.test(token)) continue
    const parts = token.split(':')
    const last = parts[parts.length - 1] ?? ''
    const secondLast = parts[parts.length - 2] ?? ''
    let line: number
    let column: number | null = null
    let pathParts: string[]
    if (parts.length >= 3 && /^\d+$/.test(last) && /^\d+$/.test(secondLast)) {
      column = Number(last)
      line = Number(secondLast)
      pathParts = parts.slice(0, -2)
    } else if (/^\d+$/.test(last)) {
      line = Number(last)
      pathParts = parts.slice(0, -1)
    } else {
      continue
    }
    // A drive letter stays part of the path: positions were taken from the end.
    const path = pathParts.join(':')
    if (!looksLikePath(path)) continue
    links.push({ text: token, path, line, column, start: match.index, end: match.index + token.length })
  }
  return links
}

/** Resolves a link target against the terminal cwd; forward-slash absolute paths. */
export function resolveLinkPath(cwd: string, pathText: string): string {
  const normalized = pathText.replace(/\\/g, '/')
  if (/^([A-Za-z]:)?\//.test(normalized)) return normalized
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = `${base}/${normalized}`.split('/')
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' && out.length === 0) {
      out.push('')
      continue
    }
    if (segment === '.') continue
    if (segment === '..') {
      if (out.length > 1) out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}
