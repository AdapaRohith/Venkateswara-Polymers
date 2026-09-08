/**
 * One clock for the whole app: IST, dd/mm/yyyy, hh:mm:ss am/pm.
 *
 * The API stores and returns naive wall-clock strings already in IST
 * ("2026-09-08T17:24:05.123456", no trailing Z). Handing those to `new Date()`
 * makes the browser reinterpret them in whatever zone the machine happens to be
 * in, which is how the same entry used to show two different days. So we parse
 * the parts by hand and format them ourselves — the output is identical whether
 * the page is opened on the shop floor or from anywhere else.
 */

const pad = (n, width = 2) => String(n).padStart(width, '0')

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/

/** Wall-clock parts of an API timestamp, or null when it is unusable. */
export function parseIST(value) {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return {
      year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(),
      hour: value.getHours(), minute: value.getMinutes(), second: value.getSeconds(),
      hasTime: true,
    }
  }
  const text = String(value).trim()
  if (!text) return null

  const naive = NAIVE.exec(text)
  // A zone-qualified string is a real instant, so convert it to IST properly.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
  if (naive && !zoned) {
    return {
      year: +naive[1], month: +naive[2], day: +naive[3],
      hour: +(naive[4] ?? 0), minute: +(naive[5] ?? 0), second: +(naive[6] ?? 0),
      hasTime: naive[4] !== undefined,
    }
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(parsed).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {})
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second,
    hasTime: true,
  }
}

/** dd/mm/yyyy */
export function formatDate(value, fallback = '—') {
  const p = parseIST(value)
  if (!p) return fallback
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`
}

/** hh:mm:ss am/pm */
export function formatTime(value, fallback = '—') {
  const p = parseIST(value)
  if (!p) return fallback
  const suffix = p.hour < 12 ? 'am' : 'pm'
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  return `${pad(hour12)}:${pad(p.minute)}:${pad(p.second)} ${suffix}`
}

/** dd/mm/yyyy hh:mm:ss am/pm */
export function formatDateTime(value, fallback = '—') {
  const p = parseIST(value)
  if (!p) return fallback
  return `${formatDate(value)} ${formatTime(value)}`
}

/** dd/mm — for dense table cells where the year is obvious from context. */
export function formatDayMonth(value, fallback = '—') {
  const p = parseIST(value)
  if (!p) return fallback
  return `${pad(p.day)}/${pad(p.month)}`
}

/** yyyy-mm-dd — the shape `<input type="date">` and the API both expect. */
export function toDateInputValue(value) {
  const p = parseIST(value)
  if (!p) return ''
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Today in IST, as yyyy-mm-dd. Use instead of `new Date().toISOString()`. */
export function todayIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  return parts // en-CA already yields yyyy-mm-dd
}

/** N days before today in IST, as yyyy-mm-dd — for default report ranges. */
export function daysAgoIST(days) {
  const d = new Date(`${todayIST()}T00:00:00`)
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Now in IST, as the naive string the API accepts. */
export function nowIST() {
  const d = todayIST()
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date())
  return `${d}T${t}`
}

/** Sort key for grouping rows by day — descending gives newest first. */
export function dayKey(value) {
  return toDateInputValue(value)
}

/** "Today" / "Yesterday" / dd/mm/yyyy — for date group headers. */
export function formatDayHeading(value) {
  const key = toDateInputValue(value)
  if (!key) return '—'
  const today = todayIST()
  if (key === today) return 'Today'
  const y = new Date(`${today}T00:00:00`)
  y.setDate(y.getDate() - 1)
  const yesterday = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`
  if (key === yesterday) return 'Yesterday'
  return formatDate(value)
}
