function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function positiveQuantity(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function previewFloorTransfer({ warehouseKg, floorKg, quantityKg }) {
  const warehouse = nonNegativeNumber(warehouseKg)
  const floor = nonNegativeNumber(floorKg)
  const quantity = positiveQuantity(quantityKg)
  if (warehouse === null || floor === null || quantity === null) {
    return { error: 'Enter a valid quantity greater than zero.' }
  }
  if (quantity > warehouse) {
    return { error: `Only ${warehouse.toFixed(2)} kg is available in Warehouse Stock.` }
  }
  return {
    warehouseOpeningKg: warehouse,
    warehouseClosingKg: warehouse - quantity,
    floorOpeningKg: floor,
    floorClosingKg: floor + quantity,
    plantOpeningKg: warehouse + floor,
    plantClosingKg: warehouse + floor,
  }
}

export function previewProductionUsage({ warehouseKg = 0, floorKg, quantityKg }) {
  const warehouse = nonNegativeNumber(warehouseKg)
  const floor = nonNegativeNumber(floorKg)
  const quantity = positiveQuantity(quantityKg)
  if (warehouse === null || floor === null || quantity === null) {
    return { error: 'Enter a valid quantity greater than zero.' }
  }
  if (quantity > floor) {
    return { error: `Only ${floor.toFixed(2)} kg is available in Floor Stock.` }
  }
  return {
    warehouseOpeningKg: warehouse,
    warehouseClosingKg: warehouse,
    floorOpeningKg: floor,
    floorClosingKg: floor - quantity,
    plantOpeningKg: warehouse + floor,
    plantClosingKg: warehouse + floor - quantity,
  }
}

export function describeEntryReversal({ sourceDomain, materialName, quantityKg }) {
  const quantity = Number(quantityKg)
  const amount = Number.isFinite(quantity) ? quantity.toFixed(2) : '0.00'
  const material = String(materialName || 'this material').trim()
  const suffix = 'The reversal will remain visible in Stock Activity.'
  if (String(sourceDomain).toUpperCase() === 'PRODUCTION') {
    return `Delete this production entry? ${amount} kg of ${material} will be restored to Floor Stock. ${suffix}`
  }
  if (String(sourceDomain).toUpperCase() === 'FLOOR_TRANSFER') {
    return `Delete this floor transfer? ${amount} kg of ${material} will move from Floor Stock back to Warehouse Stock. ${suffix}`
  }
  return `Delete this entry? ${amount} kg of ${material} will be reversed. ${suffix}`
}

export function normalizeStockReceipt(receipt) {
  if (!receipt) return null
  const read = (camel, snake) => {
    const value = Number(receipt[camel] ?? receipt[snake])
    return Number.isFinite(value) ? value : 0
  }
  return {
    warehouseOpeningKg: read('warehouseOpeningKg', 'warehouse_opening_kg'),
    warehouseClosingKg: read('warehouseClosingKg', 'warehouse_closing_kg'),
    floorOpeningKg: read('floorOpeningKg', 'floor_opening_kg'),
    floorClosingKg: read('floorClosingKg', 'floor_closing_kg'),
    plantOpeningKg: read('plantOpeningKg', 'plant_opening_kg'),
    plantClosingKg: read('plantClosingKg', 'plant_closing_kg'),
  }
}

const RECEIPT_FIELDS = [
  ['warehouseOpeningKg', 'warehouse_opening_kg'],
  ['warehouseClosingKg', 'warehouse_closing_kg'],
  ['floorOpeningKg', 'floor_opening_kg'],
  ['floorClosingKg', 'floor_closing_kg'],
  ['plantOpeningKg', 'plant_opening_kg'],
  ['plantClosingKg', 'plant_closing_kg'],
]

export function normalizeImpactReceipt(receipt) {
  if (!receipt) return null
  return RECEIPT_FIELDS.reduce((normalized, [camel, snake]) => {
    const raw = receipt[camel] ?? receipt[snake]
    const value = Number(raw)
    if (raw !== undefined && raw !== null && Number.isFinite(value)) normalized[camel] = value
    return normalized
  }, {})
}

export function getRecordBadge(kind) {
  if (kind === 'activity') {
    return { label: 'Read-only activity', tone: 'slate' }
  }
  return { label: 'Editable entry', tone: 'gold' }
}

export function activityActionLabel(sourceDomain, action) {
  const source = String(sourceDomain || '').toUpperCase()
  const verb = String(action || '').toUpperCase()
  if (verb === 'LEGACY') return 'Legacy'
  if (verb === 'REVERSE') return 'Reversed'
  if (verb === 'UPDATE') return 'Corrected'
  return {
    RAW_INPUT: 'Received',
    FLOOR_TRANSFER: 'Moved to Floor',
    PRODUCTION: 'Used in Production',
    WASTAGE: 'Wastage Reported',
    MANUAL_ADJUSTMENT: 'Corrected',
  }[source] || 'Recorded'
}

export function activityRowActions({ entryPath, sourceId }) {
  if (!entryPath || !sourceId) return []
  return [{ label: 'View Entry', path: entryPath, sourceId }]
}

export function serializeActivityFilters(filters = {}) {
  const names = {
    dateFrom: 'date_from',
    dateTo: 'date_to',
    materialId: 'material_id',
    sourceDomain: 'source_domain',
    action: 'action',
    operatorId: 'operator_id',
    limit: 'limit',
    offset: 'offset',
  }
  const params = new URLSearchParams()
  Object.entries(names).forEach(([key, param]) => {
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '') params.set(param, value)
  })
  return params.toString()
}
