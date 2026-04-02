import api from './api'

export const updateRawMaterialBatch = (id, payload) => api.put(`/raw-material/batches/${id}`, payload)
export const deleteRawMaterialBatch = (id) => api.delete(`/raw-material/batches/${id}`)
export const bulkDeleteRawMaterialBatches = (ids) => api.post('/raw-material/batches/bulk-delete', { ids })

export const updateFloorTransaction = (id, payload) => api.put(`/floor/transactions/${id}`, payload)
export const deleteFloorTransaction = (id) => api.delete(`/floor/transactions/${id}`)
export const bulkDeleteFloorTransactions = (ids) => api.post('/floor/transactions/bulk-delete', { ids })

export const updateProductionLog = (id, payload) => api.put(`/production/logs/${id}`, payload)
export const deleteProductionLog = (id) => api.delete(`/production/logs/${id}`)
export const bulkDeleteProductionLogs = (ids) => api.post('/production/logs/bulk-delete', { ids })
