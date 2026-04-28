import { useEffect, useMemo, useState } from 'react'
import SummaryCard from '../components/SummaryCard'
import { SectionBarChart, TrendLineChart } from '../components/Charts'
import api from '../utils/api'

function toNumber(value, fallback = 0) {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : fallback
}

function firstNumber(...values) {
    for (const value of values) {
        const numericValue = Number(value)
        if (Number.isFinite(numericValue)) return numericValue
    }
    return 0
}

function extractRows(payload) {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.data)) return payload.data
    if (Array.isArray(payload?.rows)) return payload.rows
    if (Array.isArray(payload?.logs)) return payload.logs
    if (Array.isArray(payload?.items)) return payload.items
    if (Array.isArray(payload?.results)) return payload.results
    if (Array.isArray(payload?.wastage)) return payload.wastage
    if (Array.isArray(payload?.wastage_logs)) return payload.wastage_logs
    if (Array.isArray(payload?.wastageLogs)) return payload.wastageLogs
    return []
}

function formatDate(value) {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    })
}

function getRowDate(row = {}) {
    const rawDate = row.date ?? row.created_at ?? row.createdAt ?? row.transaction_date ?? row.transactionDate
    if (!rawDate) return ''
    return String(rawDate).slice(0, 10)
}

function getRowQuantityKg(row = {}) {
    return firstNumber(row.quantity_kg, row.quantityKg, row.quantity_in_kg, row.quantityInKg, row.quantity, row.total_quantity_kg, row.totalQuantityKg)
}

function normalizeWastageRow(row = {}, index = 0) {
    return {
        ...row,
        id: row.id ?? row.transactionId ?? `wastage-${index}`,
        sno: row.sno ?? index + 1,
        date: row.date ?? String(row.created_at ?? row.createdAt ?? '').slice(0, 10),
        order_number: row.order_number ?? row.orderNumber ?? '',
        grossWeight: firstNumber(row.grossWeight, row.gross_weight),
        netWeight: firstNumber(row.netWeight, row.net_weight),
        actualWeight: firstNumber(row.actualWeight, row.actual_weight, row.weight, row.wastage_generated, row.quantity_kg, row.quantity, row.net_weight, row.netWeight),
    }
}

export default function Dashboard() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [metrics, setMetrics] = useState({ totalInputKg: 0, totalOutputKg: 0 })
    const [floorTransactions, setFloorTransactions] = useState([])
    const [wastageRows, setWastageRows] = useState([])

    useEffect(() => {
        let cancelled = false

        const fetchMetrics = async () => {
            setLoading(true)
            setError('')

            try {
                const [efficiencyRes, txRes, wastageRes] = await Promise.allSettled([
                    api.get('/analytics/plant-efficiency-v2'),
                    api.get('/floor/transactions'),
                    api.get('/wastage'),
                ])

                const efficiencyData = efficiencyRes.status === 'fulfilled' ? efficiencyRes.value?.data : null
                const txData = txRes.status === 'fulfilled' ? txRes.value?.data : null
                const wastageDataRaw = wastageRes.status === 'fulfilled' ? wastageRes.value?.data : null

                const row = efficiencyData?.data?.[0] ?? efficiencyData ?? {}
                const txRows = Array.isArray(txData) ? txData : txData?.data || []
                const wastageData = extractRows(wastageDataRaw)

                const totalInputKg = toNumber(row.total_input_kg ?? row.total_input ?? row.totalInputKg ?? row.totalInput)
                const totalOutputKg = toNumber(row.total_output_kg ?? row.total_output ?? row.totalOutputKg ?? row.totalOutput)

                if (!cancelled) {
                    setMetrics({ totalInputKg, totalOutputKg })
                    setFloorTransactions(txRows)
                    setWastageRows(wastageData.map(normalizeWastageRow))
                    const failed = [efficiencyRes, txRes, wastageRes].some((result) => result.status === 'rejected')
                    setError(failed ? 'Some dashboard data could not be loaded. Check your internet connection and refresh.' : '')
                }
            } catch (err) {
                console.error('Failed to load plant analytics', err)
                if (!cancelled) setError(err?.response?.data?.error || err?.message || 'Failed to load analytics')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        // Call immediately
        fetchMetrics()

        // Poll every 10 seconds
        const pollInterval = setInterval(fetchMetrics, 10000)

        return () => {
            cancelled = true
            clearInterval(pollInterval)
        }
    }, [])

    const wastageValue = useMemo(
        () => (Array.isArray(wastageRows) ? wastageRows : []).reduce((sum, row) => sum + toNumber(row.actualWeight), 0),
        [wastageRows],
    )

    const recentWastage = useMemo(
        () =>
            [...(Array.isArray(wastageRows) ? wastageRows : [])]
                .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))
                .slice(0, 10),
        [wastageRows]
    )

    const totalsChartData = useMemo(
        () => [
            { name: 'Total Input', value: metrics.totalInputKg },
            { name: 'Total Output', value: metrics.totalOutputKg },
            { name: 'Wastage', value: wastageValue },
        ],
        [metrics.totalInputKg, metrics.totalOutputKg, wastageValue],
    )

    const dailyOutputTrend = useMemo(() => {
        const daily = {}
        ;(Array.isArray(floorTransactions) ? floorTransactions : []).forEach((row) => {
            const date = getRowDate(row)
            if (!date) return
            const direction = String(row.direction ?? '').toUpperCase()
            if (direction !== 'OUT') return
            daily[date] = (daily[date] || 0) + getRowQuantityKg(row)
        })

        return Object.entries(daily)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ label: date, value: Number(toNumber(value).toFixed(2)) }))
    }, [floorTransactions])

    const dailyInputTrend = useMemo(() => {
        const daily = {}
        ;(Array.isArray(floorTransactions) ? floorTransactions : []).forEach((row) => {
            const date = getRowDate(row)
            if (!date) return
            const direction = String(row.direction ?? '').toUpperCase()
            const movementType = String(row.movement_type ?? row.movementType ?? '').toUpperCase()
            const isFloorInput = direction === 'OUT' || movementType === 'FLOOR_TRANSFER'
            if (!isFloorInput) return
            daily[date] = (daily[date] || 0) + getRowQuantityKg(row)
        })

        return Object.entries(daily)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ label: date, value: Number(toNumber(value).toFixed(2)) }))
    }, [floorTransactions])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Dashboard</h2>
            </div>

            {error && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SummaryCard
                    title="Total Input"
                    value={metrics.totalInputKg}
                    subtitle={loading ? 'Loading...' : 'Floor material issued (kg)'}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                        </svg>
                    }
                />
                <SummaryCard
                    title="Total Output"
                    value={metrics.totalOutputKg}
                    subtitle={loading ? 'Loading...' : 'Production logged (kg)'}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-3.06a1.5 1.5 0 01-.54-2.05l4.5-7.09a1.5 1.5 0 012.36-.11l4.59 5.28a1.5 1.5 0 01-.3 2.2l-5.51 4.83z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18" />
                        </svg>
                    }
                />
                <SummaryCard
                    title="Total Wastage"
                    value={loading ? 'Loading...' : wastageValue.toFixed(2)}
                    subtitle={loading ? 'Loading...' : 'Logged wastage from backend (kg)'}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.108 0 00-7.5 0" />
                        </svg>
                    }
                />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <SectionBarChart data={totalsChartData} title="Plant Totals (kg)" color="#a78bfa" />
                <TrendLineChart data={dailyOutputTrend} title="Daily Output (kg)" color="#a78bfa" gradientId="gradDailyOut" />
                <TrendLineChart data={dailyInputTrend} title="Daily Input (kg)" color="#60a5fa" gradientId="gradDailyIn" />
            </div>

            {/* Recent Wastage Logs */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden mt-6">
                <div className="px-6 pt-6 pb-4">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Recent Wastage Logs</h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border-default">
                                <th className="px-6 py-4 text-left text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                                    Date
                                </th>
                                <th className="px-6 py-4 text-left text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                                    Order
                                </th>
                                <th className="px-6 py-4 text-right text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                                    Actual Wastage (kg)
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && recentWastage.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="py-12 text-center text-sm text-text-secondary/50">
                                        No wastage entries logged yet.
                                    </td>
                                </tr>
                            ) : (
                                recentWastage.map((row, index) => (
                                    <tr
                                        key={row.id ?? row.transactionId ?? `${row.date}-${index}`}
                                        className={`border-b border-border-subtle transition-colors duration-150 hover:bg-white/[0.02] ${
                                            index % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'
                                        }`}
                                    >
                                        <td className="px-6 py-3.5 text-text-primary/90">{formatDate(row.date)}</td>
                                        <td className="px-6 py-3.5 text-text-primary/90">{row.order_number || '-'}</td>
                                        <td className="px-6 py-3.5 text-right font-semibold text-accent-gold">
                                            {toNumber(row.actualWeight).toFixed(2)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

