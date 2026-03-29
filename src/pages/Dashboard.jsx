import { useEffect, useMemo, useState } from 'react'
import SummaryCard from '../components/SummaryCard'
import { SectionBarChart, TrendLineChart } from '../components/Charts'
import api from '../utils/api'

function toNumber(value, fallback = 0) {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : fallback
}

export default function Dashboard() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [metrics, setMetrics] = useState({ totalInputKg: 0, totalOutputKg: 0, efficiencyPercent: 0 })
    const [floorTransactions, setFloorTransactions] = useState([])

    useEffect(() => {
        let cancelled = false

        const fetchMetrics = async () => {
            setLoading(true)
            setError('')

            try {
                const [efficiencyRes, txRes] = await Promise.all([
                    api.get('/analytics/plant-efficiency-v2'),
                    api.get('/floor/transactions'),
                ])

                const row = efficiencyRes?.data?.data?.[0] ?? efficiencyRes?.data ?? {}
                const txRows = Array.isArray(txRes?.data) ? txRes.data : txRes?.data?.data || []

                const totalInputKg = toNumber(row.total_input_kg ?? row.total_input ?? row.totalInputKg ?? row.totalInput)
                const totalOutputKg = toNumber(row.total_output_kg ?? row.total_output ?? row.totalOutputKg ?? row.totalOutput)
                const efficiencyPercent = toNumber(row.efficiency_percent ?? row.efficiency ?? row.efficiencyPercent)

                if (!cancelled) {
                    setMetrics({ totalInputKg, totalOutputKg, efficiencyPercent })
                    setFloorTransactions(txRows)
                }
            } catch (err) {
                console.error('Failed to load plant efficiency v2', err)
                if (!cancelled) setError(err?.response?.data?.error || err?.message || 'Failed to load analytics')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        fetchMetrics()

        return () => {
            cancelled = true
        }
    }, [])

    const efficiencyLabel = useMemo(() => `${metrics.efficiencyPercent.toFixed(2)}%`, [metrics.efficiencyPercent])

    const totalsChartData = useMemo(
        () => [
            { name: 'Total Input', value: metrics.totalInputKg },
            { name: 'Total Output', value: metrics.totalOutputKg },
        ],
        [metrics.totalInputKg, metrics.totalOutputKg],
    )

    const dailyOutputTrend = useMemo(() => {
        const daily = {}
        ;(Array.isArray(floorTransactions) ? floorTransactions : []).forEach((row) => {
            const date = String(row.created_at ?? row.createdAt ?? '').slice(0, 10)
            if (!date) return
            const direction = String(row.direction ?? '').toUpperCase()
            if (direction !== 'OUT') return
            daily[date] = (daily[date] || 0) + toNumber(row.quantity_kg)
        })

        return Object.entries(daily)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ label: date, value: Number(toNumber(value).toFixed(2)) }))
    }, [floorTransactions])

    const dailyInputTrend = useMemo(() => {
        const daily = {}
        ;(Array.isArray(floorTransactions) ? floorTransactions : []).forEach((row) => {
            const date = String(row.created_at ?? row.createdAt ?? '').slice(0, 10)
            if (!date) return
            const direction = String(row.direction ?? '').toUpperCase()
            if (direction !== 'IN') return
            daily[date] = (daily[date] || 0) + toNumber(row.quantity_kg)
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                    title="Efficiency"
                    value={efficiencyLabel}
                    subtitle={loading ? 'Loading...' : 'Plant efficiency %'}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    }
                />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <SectionBarChart data={totalsChartData} title="Plant Totals (kg)" color="#a78bfa" />
                <TrendLineChart data={dailyOutputTrend} title="Daily Output (kg)" color="#a78bfa" gradientId="gradDailyOut" />
                <TrendLineChart data={dailyInputTrend} title="Daily Input (kg)" color="#60a5fa" gradientId="gradDailyIn" />
            </div>
        </div>
    )
}
