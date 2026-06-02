import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSSE from '../hooks/useSSE'
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

function getCurrentMonth() {
    return new Date().toISOString().slice(0, 7)
}

function getMonthRange(month) {
    const normalizedMonth = /^\d{4}-\d{2}$/.test(month) ? month : getCurrentMonth()
    const [year, monthIndex] = normalizedMonth.split('-').map(Number)
    const start = `${normalizedMonth}-01`
    const endDate = new Date(year, monthIndex, 0)
    const end = `${normalizedMonth}-${String(endDate.getDate()).padStart(2, '0')}`

    return { start, end }
}

function formatMonthLabel(month) {
    const [year, monthIndex] = String(month || '').split('-').map(Number)
    if (!year || !monthIndex) return 'Selected month'

    return new Date(year, monthIndex - 1, 1).toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
    })
}

function isRowInMonth(row, month) {
    const date = getRowDate(row)
    return Boolean(date && date.startsWith(month))
}

export default function Dashboard() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [metrics, setMetrics] = useState({ totalInputKg: 0, totalOutputKg: 0 })
    const [floorTransactions, setFloorTransactions] = useState([])
    const [wastageRows, setWastageRows] = useState([])
    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth)

    const monthRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth])
    const monthLabel = useMemo(() => formatMonthLabel(selectedMonth), [selectedMonth])

    const cancelledRef = useRef(false)

    const fetchMetrics = useCallback(async () => {
        setLoading(true)
        setError('')

        try {
            const params = {
                date_from: monthRange.start,
                date_to: monthRange.end,
            }

            const [efficiencyRes, txRes, wastageRes, productionRes, rawMaterialRes] = await Promise.allSettled([
                api.get('/analytics/plant-efficiency-v2', { params }),
                api.get('/floor/transactions', { params }),
                api.get('/wastage', { params }),
                api.get('/production/logs', { params }),
                api.get('/inventory/transactions', { params }),
            ])

            const efficiencyData = efficiencyRes.status === 'fulfilled' ? efficiencyRes.value?.data : null
            const txData = txRes.status === 'fulfilled' ? txRes.value?.data : null
            const wastageDataRaw = wastageRes.status === 'fulfilled' ? wastageRes.value?.data : null
            const productionDataRaw = productionRes.status === 'fulfilled' ? productionRes.value?.data : null
            const rawMaterialDataRaw = rawMaterialRes.status === 'fulfilled' ? rawMaterialRes.value?.data : null

            const row = efficiencyData?.data?.[0] ?? efficiencyData ?? {}
            const txRows = extractRows(txData).filter((item) => isRowInMonth(item, selectedMonth))
            const wastageData = extractRows(wastageDataRaw).filter((item) => isRowInMonth(item, selectedMonth))
            const productionRows = extractRows(productionDataRaw).filter((item) => isRowInMonth(item, selectedMonth))
            const rawMaterialRows = extractRows(rawMaterialDataRaw).filter((item) => isRowInMonth(item, selectedMonth))

            const computedInputKg = rawMaterialRows.reduce((sum, item) => sum + getRowQuantityKg(item), 0)
            const computedOutputKg = productionRows.reduce(
                (sum, item) => sum + firstNumber(item.net_weight, item.netWeight, toNumber(item.gross_weight) - toNumber(item.tare_weight)),
                0,
            )

            const totalInputKg = rawMaterialRes.status === 'fulfilled'
                ? computedInputKg
                : toNumber(row.total_input_kg ?? row.total_input ?? row.totalInputKg ?? row.totalInput)
            const totalOutputKg = productionRes.status === 'fulfilled'
                ? computedOutputKg
                : toNumber(row.total_output_kg ?? row.total_output ?? row.totalOutputKg ?? row.totalOutput)

            if (!cancelledRef.current) {
                setMetrics({ totalInputKg, totalOutputKg })
                setFloorTransactions(txRows)
                setWastageRows(wastageData.map(normalizeWastageRow))
                const failed = [efficiencyRes, txRes, wastageRes, productionRes, rawMaterialRes].some((result) => result.status === 'rejected')
                setError(failed ? 'Some dashboard data could not be loaded. Check your internet connection and refresh.' : '')
            }
        } catch (err) {
            console.error('Failed to load plant analytics', err)
            if (!cancelledRef.current) setError(err?.response?.data?.error || err?.message || 'Failed to load analytics')
        } finally {
            if (!cancelledRef.current) setLoading(false)
        }
    }, [monthRange.start, monthRange.end, selectedMonth])

    useSSE(['production','raw_material','floor_stock','orders','wastage','trading'], fetchMetrics)

    useEffect(() => {
        cancelledRef.current = false
        fetchMetrics()
        return () => {
            cancelledRef.current = true
        }
    }, [fetchMetrics])

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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="text-xl font-bold text-text-primary tracking-tight">Dashboard</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">Plant overview · {monthLabel}</p>
                </div>
                <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-text-secondary/70">Period</label>
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(event) => setSelectedMonth(event.target.value || getCurrentMonth())}
                        className="bg-bg-input text-text-primary border border-border-default rounded-md px-3 py-2 text-sm focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30 transition-all cursor-pointer"
                    />
                </div>
            </div>

            {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/8 px-4 py-3 text-sm text-red-500 flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    {error}
                </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SummaryCard
                    title="Total Input"
                    value={metrics.totalInputKg}
                    subtitle={loading ? 'Loading...' : `${monthLabel} raw material received (kg)`}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                        </svg>
                    }
                />
                <SummaryCard
                    title="Total Output"
                    value={metrics.totalOutputKg}
                    subtitle={loading ? 'Loading...' : `${monthLabel} production logged (kg)`}
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
                    subtitle={loading ? 'Loading...' : `${monthLabel} logged wastage (kg)`}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.108 0 00-7.5 0" />
                        </svg>
                    }
                />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <SectionBarChart data={totalsChartData} title={`${monthLabel} Plant Totals (kg)`} />
                <TrendLineChart data={dailyOutputTrend} title={`${monthLabel} Daily Output (kg)`} gradientId="gradDailyOut" />
                <TrendLineChart data={dailyInputTrend} title={`${monthLabel} Daily Input (kg)`} color="var(--chart-bar2)" gradientId="gradDailyIn" />
            </div>

            {/* Recent Wastage Logs */}
            <div className="bg-bg-card rounded-lg border border-border-default overflow-hidden mt-2">
                <div className="px-5 py-3.5 border-b border-border-default bg-bg-primary/40">
                    <h3 className="text-xs font-semibold text-text-secondary tracking-widest uppercase">{monthLabel} Wastage Logs</h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border-default bg-bg-primary/40">
                                <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-wider uppercase text-text-secondary">Date</th>
                                <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-wider uppercase text-text-secondary">Order</th>
                                <th className="px-5 py-3 text-right text-[11px] font-semibold tracking-wider uppercase text-text-secondary">Wastage (kg)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {!loading && recentWastage.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="py-14 text-center text-sm text-text-secondary/50">
                                        No wastage entries logged yet.
                                    </td>
                                </tr>
                            ) : (
                                recentWastage.map((row, index) => (
                                    <tr
                                        key={row.id ?? row.transactionId ?? `${row.date}-${index}`}
                                        style={{ backgroundColor: index % 2 !== 0 ? 'var(--bg-row-alt)' : 'transparent' }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-row-hover)' }}
                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = index % 2 !== 0 ? 'var(--bg-row-alt)' : 'transparent' }}
                                        className="transition-colors duration-100"
                                    >
                                        <td className="px-5 py-3 text-text-primary text-sm">{formatDate(row.date)}</td>
                                        <td className="px-5 py-3 text-text-primary text-sm">{row.order_number || '—'}</td>
                                        <td className="px-5 py-3 text-right font-semibold text-accent-gold tabular-nums text-sm">
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

