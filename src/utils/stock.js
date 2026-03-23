export function toKg(value, unit) {
  const numericValue = Number(value) || 0
  if (unit === 'tons') return numericValue * 1000
  if (unit === 'grams') return numericValue / 1000
  return numericValue
}

export function formatKg(kg) {
  const numericValue = Number(kg) || 0
  if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(2)} tons`
  return `${numericValue.toFixed(2)} kg`
}

const MAX_POSTGRES_INTEGER = 2147483647

function normalizeId(value) {
  return value === undefined || value === null ? '' : String(value)
}

function getBalance(stockBalances = {}, stockId) {
  const key = normalizeId(stockId)
  if (!key) return null
  if (!Object.prototype.hasOwnProperty.call(stockBalances, key)) return null
  return Number(stockBalances[key]) || 0
}

export function getNextStockId({ stockBalances = {}, collections = [], startAt = 1000 } = {}) {
  const knownIds = [
    ...Object.keys(stockBalances),
    ...collections.flatMap((collection) =>
      (Array.isArray(collection) ? collection : []).flatMap((item) => [
        item?.id,
        item?.stockId,
        item?.fromStockId,
        item?.issuedStockId,
      ]),
    ),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value < MAX_POSTGRES_INTEGER)

  const nextId = Math.max(startAt - 1, ...knownIds) + 1
  if (nextId >= MAX_POSTGRES_INTEGER) {
    throw new Error('Unable to generate a safe stock ID')
  }

  return nextId
}

export function getUsageForIssuance(issuanceId, stockUsage = []) {
  return stockUsage
    .filter((usage) => normalizeId(usage.issuanceId) === normalizeId(issuanceId))
    .reduce((sum, usage) => sum + (Number(usage.quantityInKg) || 0), 0)
}

export function buildStockBatches(rawMaterials = [], stockUsage = [], stockIssuances = [], stockBalances = {}) {
  return rawMaterials
    .filter((item) => (Number(item.quantityInKg) || 0) > 0)
    .map((item) => {
      const initialQty = Number(item.quantityInKg) || 0
      const totalUsed = stockUsage
        .filter((usage) => normalizeId(usage.fromStockId) === normalizeId(item.id))
        .reduce((sum, usage) => sum + (Number(usage.quantityInKg) || 0), 0)

      const relatedIssuances = stockIssuances.filter(
        (issuance) => normalizeId(issuance.fromStockId) === normalizeId(item.id),
      )

      const issuedOutstanding = relatedIssuances.reduce((sum, issuance) => {
        const issuedQty = Number(issuance.quantityInKg) || 0
        const issuedBalance = getBalance(stockBalances, issuance.issuedStockId || issuance.stockId)
        if (issuedBalance !== null) return sum + Math.max(issuedBalance, 0)

        const usedAgainstIssue = getUsageForIssuance(issuance.id, stockUsage)
        return sum + Math.max(issuedQty - usedAgainstIssue, 0)
      }, 0)

      const serverBalance = getBalance(stockBalances, item.id)
      const physicalRemaining = serverBalance !== null ? Math.max(serverBalance, 0) : Math.max(initialQty - totalUsed, 0)
      const availableToIssue = serverBalance !== null
        ? Math.max(physicalRemaining, 0)
        : Math.max(physicalRemaining - issuedOutstanding, 0)
      const label = `${item.date} - ${item.quantityDisplay || formatKg(initialQty)}${item.brandName ? ` [${item.brandName}]` : ''}${item.codeName ? ` (${item.codeName})` : ''}`

      return {
        ...item,
        initialQty,
        totalUsed,
        physicalRemaining,
        issuedOutstanding,
        availableToIssue,
        label,
      }
    })
}

export function buildStockIssuances(stockIssuances = [], rawMaterials = [], stockUsage = [], stockBalances = {}) {
  const stockBatches = buildStockBatches(rawMaterials, stockUsage, stockIssuances, stockBalances)
  const batchMap = new Map(stockBatches.map((batch) => [normalizeId(batch.id), batch]))

  return stockIssuances
    .map((issuance) => {
      const batch = batchMap.get(normalizeId(issuance.fromStockId))
      const quantityInKg = Number(issuance.quantityInKg) || 0
      const issuedBalance = getBalance(stockBalances, issuance.issuedStockId || issuance.stockId)
      const usedInKg = issuedBalance !== null
        ? Math.max(quantityInKg - issuedBalance, 0)
        : getUsageForIssuance(issuance.id, stockUsage)
      const remainingInKg = issuedBalance !== null
        ? Math.max(issuedBalance, 0)
        : Math.max(quantityInKg - usedInKg, 0)

      return {
        ...issuance,
        quantityIssued: Number(issuance.quantityIssued) || quantityInKg,
        quantityInKg,
        fromStockLabel: issuance.fromStockLabel || batch?.label || 'Unknown batch',
        brandName: issuance.brandName || batch?.brandName || '',
        codeName: issuance.codeName || batch?.codeName || '',
        usedInKg,
        remainingInKg,
        status: remainingInKg <= 0 ? 'Closed' : usedInKg > 0 ? 'In Use' : 'Open',
      }
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}
