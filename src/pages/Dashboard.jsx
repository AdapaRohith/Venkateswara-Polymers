import { useMemo } from 'react'
import SummaryCard from '../components/SummaryCard'
import { ComparisonBarChart, TrendLineChart } from '../components/Charts'

export default function Dashboard({ rawMaterials, manufacturingData, tradingData }) {
    const totalRawNet = useMemo(
        () => rawMaterials.reduce((sum, item) => sum + item.quantityInKg, 0),
        [rawMaterials]
    )

    const totalMfgNet = useMemo(
        () => manufacturingData.reduce((sum, item) => sum + item.netWeight, 0),
        [manufacturingData]
    )

    const totalTradingNet = useMemo(
        () => tradingData.reduce((sum, item) => sum + item.netWeight, 0),
        [tradingData]
    )

    const totalTradingValue = useMemo(
        () => tradingData.reduce((sum, item) => sum + item.totalValue, 0),
        [tradingData]
    )

    const totalWastage = useMemo(
        () => Math.max(0, totalRawNet - totalMfgNet),
        [totalRawNet, totalMfgNet]
    )

    const barChartData = useMemo(
        () => [
            { name: 'Raw Material', value: totalRawNet },
            { name: 'Manufacturing', value: totalMfgNet },
            { name: 'Wastage', value: totalWastage },
        ],
        [totalRawNet, totalMfgNet, totalWastage]
    )

    // Build running cumulative chart data for each category
    const buildChartData = (entries) => {
        let cumulative = 0
        return entries
            .slice()
            .sort((a, b) => a.id - b.id)
            .map((entry, idx) => {
                cumulative += entry.netWeight
                return { label: `#${idx + 1}`, value: parseFloat(cumulative.toFixed(2)) }
            })
    }

    const mfgChartData = useMemo(() => buildChartData(manufacturingData), [manufacturingData])
    const tradingChartData = useMemo(() => buildChartData(tradingData), [tradingData])

    const wastageChartData = useMemo(() => {
        const allEntries = [
            ...rawMaterials.map(e => ({ id: e.id, netWeight: +e.quantityInKg })),
            ...manufacturingData.map(e => ({ id: e.id, netWeight: -e.netWeight })),
        ].sort((a, b) => a.id - b.id)

        let cumulative = 0
        return allEntries.map((entry, idx) => {
            cumulative += entry.netWeight
            return { label: `#${idx + 1}`, value: parseFloat(Math.max(0, cumulative).toFixed(2)) }
        })
    }, [rawMaterials, manufacturingData])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Dashboard</h2>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                    title="Raw Material Net"
                    value={totalRawNet}
                    subtitle={`${rawMaterials.length} entries`}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                        </svg>
                    }
                />
                <SummaryCard
                    title="Manufacturing Net"
                    value={totalMfgNet}
                    subtitle={`${manufacturingData.length} entries`}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-3.06a1.5 1.5 0 01-.54-2.05l4.5-7.09a1.5 1.5 0 012.36-.11l4.59 5.28a1.5 1.5 0 01-.3 2.2l-5.51 4.83z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18" />
                        </svg>
                    }
                />
                <SummaryCard
                    title="Trading Value"
                    value={totalTradingValue}
                    subtitle={`${tradingData.length} entries`}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    }
                />
                <SummaryCard
                    title="Wastage"
                    value={totalWastage}
                    subtitle="Auto-calculated"
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                    }
                />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <ComparisonBarChart data={barChartData} />
                <TrendLineChart
                    data={mfgChartData}
                    title="Manufacturing Trend"
                    color="#a78bfa"
                    gradientId="gradMfg"
                />
                <TrendLineChart
                    data={tradingChartData}
                    title="Trading Trend"
                    color="#7c3aed"
                    gradientId="gradTrading"
                />
                <TrendLineChart
                    data={wastageChartData}
                    title="Wastage Trend"
                    color="#f87171"
                    gradientId="gradWastage"
                />
            </div>
        </div>
    )
}
