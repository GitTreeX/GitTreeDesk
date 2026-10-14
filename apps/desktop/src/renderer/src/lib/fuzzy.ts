/**
 * Rank of a filter query against a display name; `null` when it does not match.
 * Prefix hits rank before word-boundary hits, then plain substrings, then
 * subsequence-only matches — the ordering used by the ref pickers.
 */
export function fuzzyRank(query: string, target: string): number | null {
  if (query.length === 0) return 0
  const needle = query.toLowerCase()
  const haystack = target.toLowerCase()

  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1
  const wordStart = haystack.split(/[/\-_. ]/).some((part) => part.startsWith(needle))
  if (wordStart) return 2
  if (haystack.includes(needle)) return 3

  let index = 0
  for (let i = 0; i < haystack.length && index < needle.length; i += 1) {
    if (haystack[i] === needle[index]) index += 1
  }
  return index === needle.length ? 4 : null
}

/** Filters and sorts entries by {@link fuzzyRank}, keeping ties in input order. */
export function fuzzyFilter<T>(query: string, items: readonly T[], name: (item: T) => string): T[] {
  const ranked: { item: T; rank: number; position: number }[] = []
  items.forEach((item, position) => {
    const rank = fuzzyRank(query.trim(), name(item))
    if (rank !== null) ranked.push({ item, rank, position })
  })
  ranked.sort((a, b) => (a.rank === b.rank ? a.position - b.position : a.rank - b.rank))
  return ranked.map((entry) => entry.item)
}
