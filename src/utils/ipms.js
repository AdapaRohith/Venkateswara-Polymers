// Shared vocabulary for the multi-location stock screens.

export const LOCATIONS = {
  WAREHOUSE: { label: 'Warehouse', short: 'WH', tone: 'sky' },
  GROUND_FLOOR: { label: 'Ground Floor', short: 'GF', tone: 'emerald' },
  FIRST_FLOOR: { label: 'First Floor', short: 'FF', tone: 'violet' },
  MACHINE: { label: 'Machine', short: 'MC', tone: 'amber' },
  MACHINES: { label: 'Machines', short: 'MC', tone: 'amber' },
  PLANT: { label: 'Plant Total', short: 'Σ', tone: 'slate' },
}

export const LEDGER_LOCATIONS = ['WAREHOUSE', 'GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINES']

export const TONE_CLASSES = {
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  slate: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

export const SHIFT_LABELS = { AM: 'AM · Morning', PM: 'PM · Night' }

export function locationLabel(location, machineName) {
  if (location === 'MACHINE' && machineName) return machineName
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

/** Which locations a material can move between, mirroring the server's rules. */
export function allowedDestinations(from, machines, fromMachineId) {
  const floorOf = (id) => machines.find((m) => String(m.id) === String(id))?.floor
  switch (from) {
    case 'WAREHOUSE': return ['GROUND_FLOOR', 'FIRST_FLOOR']
    case 'GROUND_FLOOR': return ['WAREHOUSE', 'FIRST_FLOOR', 'MACHINE']
    case 'FIRST_FLOOR': return ['WAREHOUSE', 'GROUND_FLOOR', 'MACHINE']
    case 'MACHINE': return fromMachineId ? [floorOf(fromMachineId)].filter(Boolean) : []
    default: return []
  }
}

export function machinesForFloor(machines, floor) {
  return machines.filter((m) => m.floor === floor)
}
