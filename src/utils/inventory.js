export const INVENTORY_TRANSACTION_TYPES = {
  IN: 'IN',
  ISSUE: 'ISSUE',
  MANUFACTURING: 'MANUFACTURING',
  WASTAGE: 'WASTAGE',
  ADJUSTMENT: 'ADJUSTMENT',
}

export const INVENTORY_NOTE_CATEGORIES = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  ISSUANCE_SOURCE: 'ISSUANCE_SOURCE',
  ISSUED_STOCK: 'ISSUED_STOCK',
  DIRECT_USAGE: 'DIRECT_USAGE',
  MANUFACTURING: 'MANUFACTURING',
  MANUFACTURING_COMPONENT: 'MANUFACTURING_COMPONENT',
  WASTAGE: 'WASTAGE',
}

function normalizeId(value) {
  return value === undefined || value === null ? '' : String(value)
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function formatQuantityInKg(value) {
  return `${toNumber(value).toFixed(2)} kg`
}

function sortRows(left, right) {
  const leftDate = String(left.date || '')
  const rightDate = String(right.date || '')
  const dateCompare = leftDate.localeCompare(rightDate)
  if (dateCompare !== 0) return dateCompare

  const leftId = normalizeId(left.transactionId || left.id)
  const rightId = normalizeId(right.transactionId || right.id)
  return leftId.localeCompare(rightId)
}

function addSno(rows = []) {
  return rows.map((row, index) => ({ ...row, sno: index + 1 }))
}

export function buildInventoryNotes(metadata = {}) {
  return JSON.stringify({
    version: 1,
    ...metadata,
  })
}

export function parseInventoryNotes(notes) {
  if (!notes) return {}
  if (typeof notes === 'object') return notes

  try {
    const parsed = JSON.parse(notes)
    return parsed && typeof parsed === 'object' ? parsed : { summary: String(notes) }
  } catch {
    return { summary: String(notes) }
  }
}

export function normalizeInventoryTransaction(transaction = {}) {
  const metadata = parseInventoryNotes(transaction.notes ?? transaction.note)

  return {
    ...transaction,
    id: transaction.id,
    stockId: transaction.stock_id ?? transaction.stockId ?? metadata.stockId ?? null,
    transactionType: String(transaction.transaction_type ?? transaction.transactionType ?? '').toUpperCase(),
    direction: String(transaction.direction ?? metadata.direction ?? '').toUpperCase(),
    quantityInKg: toNumber(transaction.quantity_in_kg ?? transaction.quantityInKg),
    workerId: transaction.worker_id ?? transaction.workerId ?? metadata.workerId ?? null,
    date: metadata.date ?? transaction.date ?? String(transaction.created_at ?? transaction.createdAt ?? '').slice(0, 10),
    createdAt: transaction.created_at ?? transaction.createdAt ?? null,
    notes: transaction.notes ?? transaction.note ?? '',
    metadata,
  }
}

export function makeInventoryTransaction({
  stockId,
  transactionType,
  direction,
  quantityInKg,
  metadata = {},
}) {
  return {
    stock_id: stockId,
    transaction_type: transactionType,
    direction,
    quantity_in_kg: quantityInKg,
    note: buildInventoryNotes({
      ...metadata,
      direction,
    }),
    notes: buildInventoryNotes({
      ...metadata,
      direction,
    }),
  }
}

function normalizeMaterialSource(source = {}, index = 0) {
  return {
    slot: toNumber(source.slot, index + 1),
    sourceLabel: source.sourceLabel || source.fromStockLabel || source.source || 'Unknown source',
    quantityUsed: toNumber(source.quantityUsed ?? source.quantityInKg),
    stockId: source.stockId ?? source.sourceStockId ?? '',
    sourceStockId: source.sourceStockId ?? source.stockId ?? '',
    issuanceId: source.issuanceId ?? null,
  }
}

function getMaterialSources(metadata = {}, normalized = {}) {
  if (Array.isArray(metadata.materialSources) && metadata.materialSources.length > 0) {
    return metadata.materialSources.map((source, index) => normalizeMaterialSource(source, index))
  }

  if (metadata.fromStockLabel || metadata.sourceStockId || metadata.issuanceId || metadata.quantityUsed) {
    return [
      normalizeMaterialSource(
        {
          slot: 1,
          sourceLabel: metadata.fromStockLabel || metadata.sourceStockLabel || 'Unknown source',
          quantityUsed: metadata.quantityUsed ?? normalized.quantityInKg,
          stockId: normalized.stockId ?? metadata.sourceStockId ?? '',
          sourceStockId: metadata.sourceStockId ?? normalized.stockId ?? '',
          issuanceId: metadata.issuanceId ?? null,
        },
        0,
      ),
    ]
  }

  return []
}

export function buildBalanceLookup(balances = []) {
  return (Array.isArray(balances) ? balances : []).reduce((lookup, item) => {
    const stockId = normalizeId(item.stock_id ?? item.stockId ?? item.id)
    if (!stockId) return lookup

    return {
      ...lookup,
      [stockId]: toNumber(item.balance),
    }
  }, {})
}

export function lookupBalance(balanceLookup = {}, stockId) {
  const key = normalizeId(stockId)
  if (!key) return null
  if (!Object.prototype.hasOwnProperty.call(balanceLookup, key)) return null
  return toNumber(balanceLookup[key])
}

export function mapTransactionToRawMaterial(transaction) {
  const normalized = transaction.metadata ? transaction : normalizeInventoryTransaction(transaction)
  const metadata = normalized.metadata
  const quantityReceived = toNumber(metadata.quantityReceived, normalized.quantityInKg)

  return {
    id: normalized.stockId,
    stockId: normalized.stockId,
    transactionId: normalized.id,
    date: normalized.date,
    quantityReceived,
    quantityUnit: metadata.quantityUnit || 'kg',
    quantityInKg: normalized.quantityInKg,
    quantityDisplay: metadata.quantityDisplay || `${quantityReceived} ${metadata.quantityUnit || 'kg'}`,
    brandName: metadata.brandName || '',
    codeName: metadata.codeName || '',
  }
}

export function mapTransactionToStockIssuance(transaction, rawMaterialLookup = {}) {
  const normalized = transaction.metadata ? transaction : normalizeInventoryTransaction(transaction)
  const metadata = normalized.metadata
  const sourceStockId = metadata.sourceStockId ?? metadata.fromStockId ?? ''
  const sourceStock = rawMaterialLookup[normalizeId(sourceStockId)]

  return {
    id: normalized.id,
    transactionId: normalized.id,
    stockId: normalized.stockId,
    issuedStockId: normalized.stockId,
    sourceTransactionId: metadata.sourceTransactionId ?? metadata.linkedIssueTransactionId ?? null,
    date: normalized.date,
    fromStockId: sourceStockId,
    fromStockLabel: metadata.sourceStockLabel || metadata.fromStockLabel || sourceStock?.label || 'Unknown batch',
    brandName: metadata.brandName || sourceStock?.brandName || '',
    codeName: metadata.codeName || sourceStock?.codeName || '',
    quantityIssued: toNumber(metadata.quantityIssued, normalized.quantityInKg),
    quantityUnit: metadata.quantityUnit || 'kg',
    quantityInKg: normalized.quantityInKg,
    note: metadata.note || '',
    issuedBy: metadata.issuedBy || '',
  }
}

export function mapTransactionToStockUsage(transaction, sourceLookup = {}) {
  const normalized = transaction.metadata ? transaction : normalizeInventoryTransaction(transaction)
  const metadata = normalized.metadata
  const lookupEntry = sourceLookup[normalizeId(normalized.stockId)]

  return {
    id: normalized.id,
    transactionId: normalized.id,
    date: normalized.date,
    quantityUsed: toNumber(metadata.quantityUsed, normalized.quantityInKg),
    quantityUnit: metadata.quantityUnit || 'kg',
    quantityInKg: normalized.quantityInKg,
    fromStockId: normalized.stockId,
    fromStockLabel: metadata.fromStockLabel || metadata.sourceStockLabel || lookupEntry?.label || 'Unknown stock',
    source:
      metadata.source ||
      (metadata.category === INVENTORY_NOTE_CATEGORIES.MANUFACTURING
      || metadata.category === INVENTORY_NOTE_CATEGORIES.MANUFACTURING_COMPONENT
        ? 'Manufacturing'
        : metadata.category === INVENTORY_NOTE_CATEGORIES.WASTAGE
          ? 'Wastage'
          : 'Manual'),
    order_number: metadata.order_number || metadata.orderNumber || '',
    issuanceId: metadata.issuanceId ?? null,
    beforeBalance: toNullableNumber(metadata.beforeBalance),
    afterBalance: toNullableNumber(metadata.afterBalance),
    issueBalanceBefore: toNullableNumber(metadata.issueBalanceBefore),
    issueBalanceAfter: toNullableNumber(metadata.issueBalanceAfter),
    linkedEntryId: metadata.linkedEntryId ?? normalized.id,
    logMessage: metadata.logMessage || metadata.summary || '',
  }
}

export function mapTransactionToManufacturing(transaction) {
  const normalized = transaction.metadata ? transaction : normalizeInventoryTransaction(transaction)
  const metadata = normalized.metadata
  const materialSources = getMaterialSources(metadata, normalized)

  return {
    id: normalized.id,
    transactionId: normalized.id,
    stockUsageId: normalized.id,
    date: normalized.date,
    order_number: metadata.order_number || metadata.orderNumber || '',
    grossWeight: toNumber(metadata.grossWeight),
    tareWeight: toNumber(metadata.tareWeight),
    netWeight: toNumber(metadata.netWeight),
    materialUsed: toNumber(metadata.materialUsed, normalized.quantityInKg),
    sizeMic: metadata.sizeMic || '',
    issuanceId: metadata.issuanceId ?? null,
    materialSources,
    materialSourcesSummary: materialSources.length > 0
      ? materialSources.map((source) => `${source.sourceLabel} (${formatQuantityInKg(source.quantityUsed)})`).join(', ')
      : '-',
  }
}

export function mapTransactionToWastage(transaction) {
  const normalized = transaction.metadata ? transaction : normalizeInventoryTransaction(transaction)
  const metadata = normalized.metadata

  return {
    id: normalized.id,
    transactionId: normalized.id,
    stockUsageId: normalized.id,
    date: normalized.date,
    order_number: metadata.order_number || metadata.orderNumber || '',
    grossWeight: toNumber(metadata.grossWeight),
    netWeight: toNumber(metadata.netWeight),
    actualWeight: toNumber(metadata.actualWeight, normalized.quantityInKg),
  }
}

export function inventoryTransactionsToState(transactions = [], balances = []) {
  const normalizedTransactions = (Array.isArray(transactions) ? transactions : []).map(normalizeInventoryTransaction)
  const stockBalances = buildBalanceLookup(balances)

  const rawMaterials = addSno(
    normalizedTransactions
      .filter(
        (transaction) =>
          transaction.direction === 'IN' &&
          transaction.transactionType === INVENTORY_TRANSACTION_TYPES.IN &&
          transaction.metadata.category === INVENTORY_NOTE_CATEGORIES.RAW_MATERIAL,
      )
      .map(mapTransactionToRawMaterial)
      .sort(sortRows),
  )

  const rawMaterialLookup = rawMaterials.reduce((lookup, item) => {
    lookup[normalizeId(item.id)] = {
      ...item,
      label: `${item.date} - ${item.quantityDisplay}${item.brandName ? ` [${item.brandName}]` : ''}${item.codeName ? ` (${item.codeName})` : ''}`,
    }
    return lookup
  }, {})

  const stockIssuances = addSno(
    normalizedTransactions
      .filter(
        (transaction) =>
          transaction.direction === 'IN' &&
          transaction.transactionType === INVENTORY_TRANSACTION_TYPES.ADJUSTMENT &&
          transaction.metadata.category === INVENTORY_NOTE_CATEGORIES.ISSUED_STOCK,
      )
      .map((transaction) => mapTransactionToStockIssuance(transaction, rawMaterialLookup))
      .sort(sortRows),
  )

  const sourceLookup = {
    ...rawMaterialLookup,
    ...stockIssuances.reduce((lookup, item) => {
      lookup[normalizeId(item.issuedStockId)] = {
        label: `${item.fromStockLabel} (Issued)`,
      }
      return lookup
    }, {}),
  }

  const manufacturingData = addSno(
    normalizedTransactions
      .filter((transaction) => transaction.metadata.category === INVENTORY_NOTE_CATEGORIES.MANUFACTURING)
      .map(mapTransactionToManufacturing)
      .sort(sortRows),
  )

  const wastageData = addSno(
    normalizedTransactions
      .filter((transaction) => transaction.metadata.category === INVENTORY_NOTE_CATEGORIES.WASTAGE)
      .map(mapTransactionToWastage)
      .sort(sortRows),
  )

  const stockUsage = addSno(
    normalizedTransactions
      .filter(
        (transaction) =>
          transaction.direction === 'OUT' &&
          [
            INVENTORY_NOTE_CATEGORIES.DIRECT_USAGE,
            INVENTORY_NOTE_CATEGORIES.MANUFACTURING,
            INVENTORY_NOTE_CATEGORIES.MANUFACTURING_COMPONENT,
            INVENTORY_NOTE_CATEGORIES.WASTAGE,
          ].includes(transaction.metadata.category),
      )
      .map((transaction) => mapTransactionToStockUsage(transaction, sourceLookup))
      .sort(sortRows),
  )

  return {
    rawMaterials,
    stockIssuances,
    manufacturingData,
    wastageData,
    stockUsage,
    stockBalances,
  }
}

function buildQueryString(filters = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, value)
  })
  return params.toString()
}

export async function getInventoryTransactions(api, filters = {}) {
  const queryString = buildQueryString(filters)
  const endpoint = queryString ? `/inventory/transactions?${queryString}` : '/inventory/transactions'
  const { data } = await api.get(endpoint)
  return Array.isArray(data) ? data : data?.data || []
}

export async function getInventoryBalances(api) {
  const { data } = await api.get('/inventory/balance')
  return Array.isArray(data) ? data : data?.data || []
}

export async function getInventoryBalance(api, stockId) {
  const { data } = await api.get(`/inventory/balance/${encodeURIComponent(stockId)}`)
  return toNumber(data?.balance ?? data?.data?.balance ?? data?.data?.[0]?.balance)
}

export async function ensureInventoryBalance(api, stockId, requiredQuantityInKg) {
  const balance = await getInventoryBalance(api, stockId)
  return {
    balance,
    ok: balance >= requiredQuantityInKg,
  }
}

export async function createInventoryTransaction(api, payload) {
  const { data } = await api.post('/inventory/transaction', payload)
  return normalizeInventoryTransaction(data)
}

export async function deleteInventoryTransaction(api, transactionId) {
  return api.delete(`/inventory/transaction/${transactionId}`)
}
