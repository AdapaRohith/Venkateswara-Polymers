import { useState, useEffect } from 'react'
import { useToast } from '../components/Toast'
import { fetchDailyReport, fetchOrderDetails, deleteRoll } from '../utils/api'

export default function LogHistory() {
    const toast = useToast()
    const today = new Date().toISOString().split('T')[0]

    const [date, setDate] = useState(today)
    const [report, setReport] = useState([])
    const [loading, setLoading] = useState(true)
    const [expandedOrder, setExpandedOrder] = useState(null)
    const [orderRolls, setOrderRolls] = useState([])
    const [rollsLoading, setRollsLoading] = useState(false)

    const loadReport = async (d) => {
        setLoading(true)
        setExpandedOrder(null)
        try {
            const data = await fetchDailyReport(d)
            setReport(data)
        } catch (err) {
            toast.error(err.message)
            setReport([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadReport(date)
    }, [date])

    const handleExpand = async (orderNumber) => {
        if (expandedOrder === orderNumber) {
            setExpandedOrder(null)
            return
        }
        setExpandedOrder(orderNumber)
        setRollsLoading(true)
        try {
            const data = await fetchOrderDetails(orderNumber)
            setOrderRolls(data.rolls || [])
        } catch (err) {
            toast.error(err.message)
            setOrderRolls([])
        } finally {
            setRollsLoading(false)
        }
    }

    const handleDelete = async (rollId) => {
        if (!confirm('Delete this roll entry?')) return
        try {
            await deleteRoll(rollId)
            toast.success('Roll deleted successfully')
            // Refresh both the rolls and the report
            if (expandedOrder) {
                const data = await fetchOrderDetails(expandedOrder)
                setOrderRolls(data.rolls || [])
            }
            loadReport(date)
        } catch (err) {
            toast.error(err.message)
        }
    }

    const inputClass =
        'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold'

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Log History</h2>
                    <p className="text-sm text-text-secondary mt-1">View and manage daily production records</p>
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={inputClass}
                    />
                </div>
            </div>

            {/* Report Table */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                <div className="px-6 py-4 border-b border-border-default">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">
                        Daily Report — {date}
                    </h3>
                </div>

                {loading ? (
                    <div className="p-12 text-center">
                        <div className="inline-block w-6 h-6 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                    </div>
                ) : report.length === 0 ? (
                    <p className="text-text-secondary/50 text-sm text-center py-12">No records found for this date</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border-default">
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Order</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Material</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Rolls</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Gross</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Net</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Actual</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.map((row, idx) => (
                                    <>
                                        <tr
                                            key={`${row.order_number}-${row.material}`}
                                            className={`border-b border-border-subtle cursor-pointer transition-colors hover:bg-white/[0.02] ${idx % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                                            onClick={() => handleExpand(row.order_number)}
                                        >
                                            <td className="px-6 py-3 text-text-primary/90 font-medium">{row.order_number}</td>
                                            <td className="px-6 py-3">
                                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-accent-gold/15 text-accent-gold">
                                                    {row.material}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-text-primary/90">{row.rolls}</td>
                                            <td className="px-6 py-3 text-text-primary/90">{Number(row.gross_total).toFixed(2)}</td>
                                            <td className="px-6 py-3 text-text-primary/90">{Number(row.net_total).toFixed(2)}</td>
                                            <td className="px-6 py-3 text-accent-gold font-medium">{Number(row.actual_total).toFixed(2)}</td>
                                            <td className="px-6 py-3 text-text-secondary/40">
                                                <svg className={`w-4 h-4 transition-transform ${expandedOrder === row.order_number ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </td>
                                        </tr>

                                        {/* Expanded rolls */}
                                        {expandedOrder === row.order_number && (
                                            <tr key={`${row.order_number}-expanded`}>
                                                <td colSpan={7} className="p-0">
                                                    <div className="bg-bg-primary/50 border-y border-border-default px-8 py-4">
                                                        {rollsLoading ? (
                                                            <div className="text-center py-4">
                                                                <div className="inline-block w-5 h-5 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                                                            </div>
                                                        ) : orderRolls.length === 0 ? (
                                                            <p className="text-text-secondary/50 text-xs text-center py-4">No individual rolls found</p>
                                                        ) : (
                                                            <table className="w-full text-xs">
                                                                <thead>
                                                                    <tr className="border-b border-border-subtle">
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium">ID</th>
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium">Date</th>
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium">Material</th>
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium">Gross</th>
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium">Net</th>
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium">Actual</th>
                                                                        <th className="text-left px-3 py-2 text-text-secondary/50 font-medium"></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {orderRolls.map((roll) => (
                                                                        <tr key={roll.id} className="border-b border-border-subtle/50 hover:bg-white/[0.02]">
                                                                            <td className="px-3 py-2 text-text-secondary">{roll.id}</td>
                                                                            <td className="px-3 py-2 text-text-primary/80">{roll.entry_date}</td>
                                                                            <td className="px-3 py-2 text-text-primary/80">{roll.material}</td>
                                                                            <td className="px-3 py-2 text-text-primary/80">{Number(roll.gross_weight).toFixed(2)}</td>
                                                                            <td className="px-3 py-2 text-text-primary/80">{Number(roll.net_weight).toFixed(2)}</td>
                                                                            <td className="px-3 py-2 text-accent-gold font-medium">{Number(roll.actual_weight).toFixed(2)}</td>
                                                                            <td className="px-3 py-2">
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); handleDelete(roll.id) }}
                                                                                    className="text-red-400/70 hover:text-red-400 transition-colors"
                                                                                    title="Delete roll"
                                                                                >
                                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                                                    </svg>
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
