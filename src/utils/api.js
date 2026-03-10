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

// Fetch all rolls across all orders, grouped by material
export async function fetchAllRolls() {
    const orders = await fetchOrdersSummary()
    const allRolls = { manufactured: [], trading: [], waste: [] }

    const details = await Promise.all(
        orders.map((o) => fetchOrderDetails(o.order_number).catch(() => ({ rolls: [] })))
    )

    details.forEach((d) => {
        (d.rolls || []).forEach((roll) => {
            const mat = (roll.material || '').toLowerCase()
            if (allRolls[mat]) {
                allRolls[mat].push(roll)
            }
        })
    })

    return allRolls
}
