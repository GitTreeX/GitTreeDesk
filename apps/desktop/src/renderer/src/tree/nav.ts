/** Index of the next row in `direction` that can take the cursor; `from` when none. */
export function nextSelectable<T>(
  rows: readonly T[],
  from: number,
  direction: 1 | -1,
  isSelectable: (row: T) => boolean
): number {
  let index = from
  for (let step = 0; step < rows.length; step += 1) {
    index += direction
    if (index < 0 || index >= rows.length) return from
    const row = rows[index]
    if (row !== undefined && isSelectable(row)) return index
  }
  return from
}

/** First selectable index scanning from `start` in `direction`, or `-1`. */
export function seekSelectable<T>(
  rows: readonly T[],
  start: number,
  direction: 1 | -1,
  isSelectable: (row: T) => boolean
): number {
  let index = start
  while (index >= 0 && index < rows.length) {
    const row = rows[index]
    if (row !== undefined && isSelectable(row)) return index
    index += direction
  }
  return -1
}
