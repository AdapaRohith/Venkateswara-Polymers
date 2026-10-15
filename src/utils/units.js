// Weight units used across the plant.
//
// Everything is stored and calculated in kilograms. A bag is 25 kg. For display,
// quantities below 1,000 kg read in kg; from 1,000 kg up they read in tons
// (1 t = 1,000 kg) so large stock figures stay legible.

export const BAG_KG = 25
export const TON_KG = 1000

const finite = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const trim = (text) => text.replace(/\.?0+$/, '')

export function bagsToKg(bags) {
  return Math.round(finite(bags) * BAG_KG * 1000) / 1000
}

export function kgToBags(kg) {
  return finite(kg) / BAG_KG
}

/** Turn an entry typed in `unit` ('kg' | 'bags' | 'tons') into kilograms. */
export function toKg(value, unit = 'kg') {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (unit === 'bags') return bagsToKg(number)
  if (unit === 'tons') return Math.round(number * TON_KG * 1000) / 1000
  return Math.round(number * 1000) / 1000
}

/** "975 kg", "1.25 t", "12.3 t" — kg below 1,000 kg, tons from 1,000 kg. */
export function formatWeight(kg, { signed = false, empty = '0 kg' } = {}) {
  if (kg === null || kg === undefined || kg === '') return empty
  const value = finite(kg)
  const sign = signed && value > 0 ? '+' : value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (abs >= TON_KG) {
    const tons = abs / TON_KG
    return `${sign}${trim(tons.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }))} t`
  }
  return `${sign}${trim(abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} kg`
}

/** "40 bags", "2.5 bags", "1 bag". */
export function formatBags(kg) {
  const bags = Math.round(kgToBags(kg) * 100) / 100
  const text = trim(Math.abs(bags).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  return `${bags < 0 ? '−' : ''}${text} ${Math.abs(bags) === 1 ? 'bag' : 'bags'}`
}

/** Primary weight plus the bag equivalent: "1.25 t · 50 bags". */
export function formatWeightWithBags(kg, options) {
  return `${formatWeight(kg, options)} · ${formatBags(kg)}`
}
