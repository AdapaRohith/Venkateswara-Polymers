const GET_API = 'https://get-info.avlokai.com'
const POST_API = 'https://post-info.avlokai.com'

async function request(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data
}

// ── GET endpoints ──
export const fetchDashboardToday = () => request(`${GET_API}/dashboard/today`)
export const fetchMaterialBreakdown = () => request(`${GET_API}/dashboard/material-breakdown`)
export const fetchOrdersSummary = () => request(`${GET_API}/dashboard/orders-summary`)
export const fetchOrderDetails = (orderNumber) => request(`${GET_API}/orders/${encodeURIComponent(orderNumber)}/details`)
export const fetchDailyReport = (date) => request(`${GET_API}/reports/daily${date ? `?date=${date}` : ''}`)

// ── POST/DELETE endpoints ──
export const createOrder = (body) =>
    request(`${POST_API}/orders`, { method: 'POST', body: JSON.stringify(body) })

export const logRoll = (body) =>
    request(`${POST_API}/rolls`, { method: 'POST', body: JSON.stringify(body) })

export const deleteRoll = (id) =>
    request(`${POST_API}/rolls/${id}`, { method: 'DELETE' })
