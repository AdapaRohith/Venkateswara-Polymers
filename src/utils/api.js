import axios from 'axios'

export const BASE_URL = 'https://vp-api.avlokai.com'
const AUTH_TOKEN_KEY = 'token'

const ensureLoginRedirect = () => {
  if (typeof window === 'undefined') return
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

const apiClient = axios.create({
  baseURL: BASE_URL,
})

apiClient.interceptors.request.use(
  (config) => {
    const skipAuth = config.skipAuth === true
    const token = sessionStorage.getItem(AUTH_TOKEN_KEY)

    if (!skipAuth) {
      if (!token) {
        ensureLoginRedirect()
      } else {
        config.headers = {
          ...(config.headers ?? {}),
          Authorization: `Bearer ${token}`,
        }
      }
    }

    config.headers = {
      Accept: 'application/json',
      ...(config.headers ?? {}),
    }

    const method = (config.method ?? 'get').toLowerCase()
    if (!config.headers['Content-Type'] && ['post', 'put', 'patch'].includes(method)) {
      config.headers['Content-Type'] = 'application/json'
    }

    delete config.skipAuth

    return config
  },
  (error) => Promise.reject(error),
)

// Helper: Convert seconds/tons to kg
function toKg(value, unit) {
  if (unit === 'tons') return value * 1000
  if (unit === 'grams') return value / 1000
  return value // kg
}

// Data transformers to convert snake_case API responses to camelCase frontend format
const transformers = {
  '/raw-materials': (items) => items.map(item => ({
    ...item,
    quantityReceived: item.quantity_received ? parseFloat(item.quantity_received) : 0,
    quantityUnit: item.quantity_unit || 'kg',
    quantityInKg: item.quantity_received ? toKg(parseFloat(item.quantity_received), item.quantity_unit || 'kg') : 0,
    quantityDisplay: item.quantity_display || `${item.quantity_received} ${item.quantity_unit || 'kg'}`,
    brandName: item.brand_name || item.brandName || '',
    codeName: item.code_name || item.codeName || '',
  })),
  '/manufacturing': (items) => items.map(item => ({
    ...item,
    order_number: item.order_number || item.orderNumber || '',
    grossWeight: item.gross_weight !== undefined ? parseFloat(item.gross_weight) : 0,
    tareWeight: item.tare_weight !== undefined ? parseFloat(item.tare_weight) : 0,
    netWeight: item.net_weight !== undefined ? parseFloat(item.net_weight) : 0,
    materialUsed: item.material_used !== undefined ? parseFloat(item.material_used) : 0,
    sizeMic: item.size_mic || item.sizeMic || '',
  })),
  '/trading': (items) => items.map(item => ({
    ...item,
    order_number: item.order_number || item.orderNumber || '',
    netWeight: item.net_weight !== undefined ? parseFloat(item.net_weight) : 0,
    rate: item.rate !== undefined ? parseFloat(item.rate) : 0,
    totalValue: item.total_value !== undefined ? parseFloat(item.total_value) : 0,
    sizeMic: item.size_mic || item.sizeMic || '',
    type: item.type || 'Buy',
  })),
  '/wastage': (items) => items.map(item => ({
    ...item,
    order_number: item.order_number || item.orderNumber || '',
    grossWeight: item.gross_weight !== undefined ? parseFloat(item.gross_weight) : 0,
    netWeight: item.net_weight !== undefined ? parseFloat(item.net_weight) : 0,
    actualWeight: item.actual_weight !== undefined ? parseFloat(item.actual_weight) : 0,
  })),
  '/stock-usage': (items) => items.map(item => ({
    ...item,
    quantityUsed: item.quantity_used ? parseFloat(item.quantity_used) : 0,
    quantityUnit: item.quantity_unit || 'kg',
    quantityInKg: item.quantity_in_kg ? parseFloat(item.quantity_in_kg) : 0,
    beforeBalance: item.before_balance ? parseFloat(item.before_balance) : 0,
    afterBalance: item.after_balance ? parseFloat(item.after_balance) : 0,
    fromStockId: item.from_stock_id || item.fromStockId,
    fromStockLabel: item.from_stock_label || item.fromStockLabel || '',
  })),
  '/orders': (items) => items.map(item => ({
    ...item,
    order_number: item.order_number || item.orderNumber || '',
    client_name: item.client_name || item.clientName || '',
    id: item.id || Date.now(),
  })),
}

apiClient.interceptors.response.use(
  (response) => {
    const rawData = response.data?.data ?? response.data
    const transformerKey = (response.config?.url ?? '').split('?')[0]
    let data = rawData

    if (Array.isArray(data) && transformers[transformerKey]) {
      data = transformers[transformerKey](data)
    }

    response.data = data
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem(AUTH_TOKEN_KEY)
      ensureLoginRedirect()
    }
    return Promise.reject(error)
  },
)

const withData = (promise) =>
  promise.then((response) => ({
    data: response.data,
  }))

const api = {
  get: (endpoint, config = {}) => withData(apiClient.get(endpoint, config)),
  post: (endpoint, body, config = {}) => withData(apiClient.post(endpoint, body, config)),
  put: (endpoint, body, config = {}) => withData(apiClient.put(endpoint, body, config)),
  delete: (endpoint, config = {}) => withData(apiClient.delete(endpoint, config)),
}

export function getAuthHeaders() {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY)
  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {}
}

export const fetchPendingUsers = () => api.get('/admin/pending-users')

export const clearAuthToken = () => {
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
}

export default api
