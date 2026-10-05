function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : NaN
}

export function previewStockAdjustment(current, operation, quantity) {
  const opening = finiteNumber(current)
  const amount = finiteNumber(quantity)
  if (!Number.isFinite(opening) || !Number.isFinite(amount) || amount <= 0) return null
  if (operation === 'add') return opening + amount
  if (operation === 'remove') return opening - amount
  return null
}

export function validateStockAdjustment({ current, operation, quantity, reason }) {
  const opening = finiteNumber(current)
  const amount = finiteNumber(quantity)
  if (!['add', 'remove'].includes(operation)) return 'Choose Add or Remove.'
  if (!Number.isFinite(amount) || amount <= 0) return 'Quantity must be greater than zero.'
  if (!String(reason ?? '').trim()) return 'Reason is required.'
  if (operation === 'remove' && amount > opening) {
    return `Cannot remove more than the available ${opening.toFixed(2)} kg.`
  }
  return ''
}
