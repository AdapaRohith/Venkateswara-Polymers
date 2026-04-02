import api from './api'

function buildOrderQuery(options = {}) {
  const params = new URLSearchParams()

  if (options.includeItems) {
    params.set('include_items', '1')
  }

  return params.toString() ? `?${params.toString()}` : ''
}

export async function getOrders(options = {}) {
  const { data } = await api.get(`/orders${buildOrderQuery(options)}`)
  return Array.isArray(data) ? data : []
}

export async function createOrder(payload) {
  const { data } = await api.post('/orders', payload)
  return data
}

export async function deleteOrder(id) {
  const { data } = await api.delete(`/orders/${id}`)
  return data
}

export async function updateOrderStatus(id, status) {
  const { data } = await api.put(`/orders/${id}/status`, { status })
  return data
}

export async function getOrderItems(orderNumber) {
  const { data } = await api.get(`/orders/${encodeURIComponent(orderNumber)}/items`)
  return Array.isArray(data) ? data : []
}

export async function recordFulfillment(payload) {
  const { data } = await api.post('/fulfillment', payload)
  return data
}

export async function getFulfillmentRecords(orderNumber) {
  const query = orderNumber ? `?order_number=${encodeURIComponent(orderNumber)}` : ''
  const { data } = await api.get(`/fulfillment${query}`)
  return Array.isArray(data) ? data : []
}
