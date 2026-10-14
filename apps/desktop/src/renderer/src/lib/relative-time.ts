/** Localized "3 days ago" for an ISO date; empty string when there is nothing to show. */
export function relativeTime(iso: string | null, locale: string, now: number = Date.now()): string {
  if (iso === null) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const seconds = Math.round((then - now) / 1000)
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(seconds / 3600)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(seconds / 86_400)
  if (Math.abs(days) < 30) return formatter.format(days, 'day')
  const months = Math.round(seconds / 2_592_000)
  if (Math.abs(months) < 12) return formatter.format(months, 'month')
  return formatter.format(Math.round(seconds / 31_536_000), 'year')
}
