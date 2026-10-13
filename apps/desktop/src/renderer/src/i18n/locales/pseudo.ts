/**
 * Development-only pseudo-locale: transforms English text so untranslated or
 * hard-coded strings stand out. Keys and `{{placeholder}}` segments stay intact.
 */

const ACCENTS: Record<string, string> = {
  a: 'å',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ô',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ô',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž'
}

const PLACEHOLDER = /(\{\{[^{}]+\}\})/g

export function pseudoLocalizeString(value: string): string {
  if (value.length === 0) return value
  const mapped = value
    .split(PLACEHOLDER)
    .map((part) => (part.startsWith('{{') ? part : [...part].map((char) => ACCENTS[char] ?? char).join('')))
    .join('')
  return `⟦${mapped}⟧`
}

export function pseudoLocalizeTree<T>(resource: T): T {
  if (typeof resource === 'string') return pseudoLocalizeString(resource) as T
  if (Array.isArray(resource)) return resource.map((entry) => pseudoLocalizeTree(entry)) as T
  if (resource !== null && typeof resource === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resource)) {
      result[key] = pseudoLocalizeTree(value)
    }
    return result as T
  }
  return resource
}
