const BASE_URL = 'https://vp-api.avlokai.com'

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

const request = async (endpoint, options = {}) => {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    const responseData = await response.json()
    if (!response.ok) {
      console.error(`API Error [${response.status}] ${endpoint}:`, responseData)
      throw { response: { data: responseData } }
    }
    
    // Handle both { data: [...] } and direct [...] responses
    let data = responseData?.data ?? responseData
    
    // Apply transformer if available for this endpoint
    if (Array.isArray(data) && transformers[endpoint]) {
      data = transformers[endpoint](data)
    }
    
    console.log(`API Success ${endpoint}:`, data)
    return { data }
  } catch (error) {
    console.error(`API Request Failed ${endpoint}:`, error)
    if (error.response) throw error
    throw { response: { data: { error: error.message } } }
  }
}

const api = {
  get: (endpoint) => request(endpoint),
  post: (endpoint, body) => request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
}

export default api
