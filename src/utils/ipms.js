// Shared vocabulary for the multi-location stock screens.

export const LOCATIONS = {
  GROUND_FLOOR: { label: 'Ground Floor', short: 'GF', tone: 'emerald' },
  FIRST_FLOOR: { label: '1st Floor Production', short: '1F', tone: 'violet' },
  ROLL_STORE: { label: 'Roll Store', short: 'RS', tone: 'sky' },
  FINISHED_STORE: { label: 'Finished Goods', short: 'FG', tone: 'amber' },
  AUTO: { label: 'Auto (1st Floor, then Ground)', short: 'Auto', tone: 'slate' },
}

export const MATERIAL_LOCATIONS = ['GROUND_FLOOR', 'FIRST_FLOOR']

// Stock alert bands, as on the plant's inventory register.
export const STATUS = {
  REORDER: { label: 'Reorder Warning', tone: 'rose' },
  BUFFER: { label: 'Buffer Stock', tone: 'amber' },
  OPTIMAL: { label: 'Optimal Stock', tone: 'emerald' },
}

export const DOC_LABELS = {
  RECEIPT: 'Received', TRANSFER: 'Moved', EXTRUSION: 'Plant production', CUTTING: 'Cutting',
  ADJUSTMENT: 'Adjustment', DISPATCH: 'Dispatch',
}

export const TONE_CLASSES = {
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  slate: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

export const SHIFT_LABELS = { AM: 'Day · AM', PM: 'Night · PM' }

export function locationLabel(location) {
  return LOCATIONS[location]?.label || location || '—'
}

export function apiError(error, fallback = 'Something went wrong') {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return detail.error || JSON.stringify(detail)
  return error?.message || fallback
}

export function shiftDate(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function formatBusinessDate(isoDate, { weekday = true } = {}) {
  if (!isoDate) return '—'
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-IN', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
    ...(weekday ? { weekday: 'short' } : {}),
  })
}

// ── Entry date / shift / time ────────────────────────────────────────────────
// Mirrors the server: AM runs amStart–pmStart, PM runs pmStart to the next
// morning and belongs to the business date it started on.

export function shiftWindows(meta) {
  const am = meta?.shifts?.find((s) => s.id === 'AM')
  return {
    amStart: am?.starts || '08:00',
    pmStart: am?.ends || '20:00',
    defaults: { AM: '09:00', PM: '21:00', ...(meta?.default_entry_times || {}) },
  }
}

/** Current date and HH:MM on the plant's clock (IST), whatever the PC's time zone. */
export function nowIST() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function shiftForTime(time, windows) {
  return time >= windows.amStart && time < windows.pmStart ? 'AM' : 'PM'
}

/** The business date + shift running right now. */
export function liveShiftContext(windows) {
  const { date, time } = nowIST()
  if (time < windows.amStart) return { date: shiftDate(date, -1), shift: 'PM', time }
  return { date, shift: shiftForTime(time, windows), time }
}

/** Calendar day an entry lands on: night-shift times after midnight fall on the next day. */
export function calendarDayFor(businessDate, time, windows) {
  return time && time < windows.amStart ? shiftDate(businessDate, 1) : businessDate
}

/** API fields for an entry's when. A blank time lets the server pick (live clock or shift default). */
export function entryWhenPayload({ date, shift, time }) {
  return { business_date: date, shift, ...(time ? { entry_time: time } : {}) }
}
