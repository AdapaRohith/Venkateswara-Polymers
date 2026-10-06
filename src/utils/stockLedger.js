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
