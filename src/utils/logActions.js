import api from './api'
import { normalizeImpactReceipt } from './stockLedger'

export const canModifyLocalEntry = (user, entry) => {
  if (!entry || entry.is_legacy || entry.isLegacy) return false
  if (['owner', 'admin'].includes(user?.role)) return true
  const userId = Number(user?.id ?? user?.user_id ?? user?.userId)
  const createdBy = Number(entry.created_by ?? entry.createdBy)
  return Number.isFinite(userId) && Number.isFinite(createdBy) && userId === createdBy
}

export const impactReceiptFromResponse = (payload) => normalizeImpactReceipt(
  payload?.impact_receipt ?? payload?.stock_receipt ?? payload?.data?.stock_receipt,
)

export const updateRawMaterialBatch = (id, payload) => api.put(`/raw-material/batches/${id}`, payload)
export const deleteRawMaterialBatch = (id) => api.delete(`/raw-material/batches/${id}`)
export const bulkDeleteRawMaterialBatches = (ids) => api.post('/raw-material/batches/bulk-delete', { ids })

export const updateFloorTransaction = (id, payload) => api.put(`/floor/transactions/${id}`, payload)
export const deleteFloorTransaction = (id) => api.delete(`/floor/transactions/${id}`)
export const bulkDeleteFloorTransactions = (ids) => api.post('/floor/transactions/bulk-delete', { ids })

export const updateProductionLog = (id, payload) => api.put(`/production/logs/${id}`, payload)
export const deleteProductionLog = (id) => api.delete(`/production/logs/${id}`)
export const bulkDeleteProductionLogs = (ids) => api.post('/production/logs/bulk-delete', { ids })

export const updateWastageEntry = (id, payload) => api.put(`/wastage/${id}`, payload)
export const deleteWastageEntry = (id) => api.delete(`/wastage/${id}`)
