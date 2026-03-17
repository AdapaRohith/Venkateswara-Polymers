import { useState, useMemo } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import { WastageAreaChart } from '../components/Charts'
import { useToast } from '../components/Toast'

const historyColumns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'order_number', label: 'Order' },
    { key: 'grossWeight', label: 'Gross Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'actualWeight', label: 'Actual Weight', render: (v) => Number(v).toFixed(2) },
]

// Convert any unit to kg
function toKg(value, unit) {
    if (unit === 'tons') return value * 1000
    return value
}

function formatKg(kg) {
    if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(2)} tons`
    return `${kg.toFixed(2)} kg`
}

export default function Wastage({ rawMaterials, manufacturingData, wastageData = [], setWastageData, stockUsage = [], setStockUsage }) {
    const toast = useToast()
    const [orders, setOrders] = useState([])
    const [form, setForm] = useState({
        order_number: '',
        newOrder: '',
        newClient: '',
        gross_weight: '',
        net_weight: '',
        fromStockId: '',
    })
    const [submitting, setSubmitting] = useState(false)
    const [showNewOrder, setShowNewOrder] = useState(false)



    // Fixed: rawMaterials use quantityInKg, not netWeight
    const totalRawIn = rawMaterials.reduce((s, i) => s + (i.quantityInKg || 0), 0)
    const totalMfgOutput = manufacturingData.reduce((s, i) => s + (i.netWeight || 0), 0)
    const totalMfgInput = manufacturingData.reduce((s, i) => s + (i.materialUsed || i.netWeight || 0), 0)
    const totalWasteLogged = wastageData.reduce((s, i) => s + (i.actualWeight || 0), 0)
    const autoWastage = Math.max(0, totalMfgInput - totalMfgOutput)

    // ── Per-order wastage breakdown ──
    const perOrderData = useMemo(() => {
        const orderMap = {}
        manufacturingData.forEach((m) => {
            const o = m.order_number || 'Unknown'
            if (!orderMap[o]) orderMap[o] = { order: o, materialUsed: 0, output: 0, rolls: 0 }
            orderMap[o].materialUsed += (m.materialUsed || m.netWeight || 0)
            orderMap[o].output += (m.netWeight || 0)
            orderMap[o].rolls += 1
        })
        return Object.values(orderMap).map((row) => ({
            ...row,
            wastage: Math.max(0, row.materialUsed - row.output),
            wastagePercent: row.materialUsed > 0 ? Math.max(0, ((row.materialUsed - row.output) / row.materialUsed) * 100) : 0,
        }))
    }, [manufacturingData])

    const chartData = useMemo(() => [
        { name: 'Raw Material In', value: totalRawIn },
        { name: 'Mfg Output', value: totalMfgOutput },
        { name: 'Process Wastage', value: autoWastage },
    ], [totalRawIn, totalMfgOutput, autoWastage])

    // ── Stock batch calculations ──
    const stockBatches = useMemo(() => {
        return rawMaterials
            .filter((r) => r.quantityInKg > 0)
            .map((r) => {
                const usedFromThisBatch = stockUsage
                    .filter((u) => u.fromStockId === r.id)
                    .reduce((s, u) => s + u.quantityInKg, 0)
                const remaining = (r.quantityInKg || 0) - usedFromThisBatch
                return {
                    ...r,
                    initialQty: r.quantityInKg || 0,
                    totalUsed: usedFromThisBatch,
                    remaining,
                    label: `${r.date} — ${r.quantityDisplay || formatKg(r.quantityInKg || 0)}`,
                }
            })
    }, [rawMaterials, stockUsage])

    const availableBatches = stockBatches.filter((b) => b.remaining > 0)
    const totalStockIn = stockBatches.reduce((s, b) => s + b.initialQty, 0)
    const totalStockUsed = stockBatches.reduce((s, b) => s + b.totalUsed, 0)
    const currentStock = totalStockIn - totalStockUsed

    const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }))

    const handleSubmit = async (e) => {
        e.preventDefault()
        let orderNum = form.order_number
        if (showNewOrder) {
            if (!form.newOrder.trim() || !form.newClient.trim()) {
                toast.error('Please fill order number and client name')
                return
            }
            orderNum = form.newOrder.trim()
            const alreadyExists = orders.some((o) => o.order_number === orderNum)
            if (!alreadyExists) {
                setOrders((prev) => [...prev, { order_number: orderNum, client_name: form.newClient.trim() }])
            }
            toast.success(`Order "${orderNum}" created`)
        }

        const gross = parseFloat(form.gross_weight)
        const net = parseFloat(form.net_weight)
        if (!orderNum || isNaN(gross) || isNaN(net)) { toast.error('Fill all required fields'); return }
        if (gross < net) { toast.error('Gross weight must be ≥ Net weight'); return }

        const actualWeight = gross - net

        // Validate stock batch if selected
        let stockEntry = null
        if (form.fromStockId) {
            const batch = stockBatches.find((b) => b.id === Number(form.fromStockId))
            if (!batch) {
                toast.error('Selected stock batch not found')
                return
            }
            if (actualWeight > batch.remaining) {
                toast.error(`Cannot use ${formatKg(actualWeight)} — only ${formatKg(batch.remaining)} remaining in this stock.`)
                return
            }

            stockEntry = {
                id: Date.now() + 1,
                sno: stockUsage.length + 1,
                date: new Date().toISOString().split('T')[0],
                quantityUsed: actualWeight,
                quantityUnit: 'kg',
                quantityInKg: actualWeight,
                fromStockId: batch.id,
                fromStockLabel: batch.label,
                beforeBalance: batch.remaining,
                afterBalance: batch.remaining - actualWeight,
                logMessage: `${formatKg(actualWeight)} wasted (${orderNum}) from stock (${batch.label})`,
                source: 'Wastage',
            }
        }

        setSubmitting(true)

        const entryId = Date.now()
        const entry = {
            id: entryId,
            sno: wastageData.length + 1,
            date: new Date().toISOString().split('T')[0],
            order_number: orderNum,
            grossWeight: gross,
            netWeight: net,
            actualWeight: actualWeight,
            stockUsageId: stockEntry ? stockEntry.id : null,
        }
        setWastageData((prev) => [...prev, entry].map((item, idx) => ({ ...item, sno: idx + 1 })))

        // Auto-deduct from stock
        if (stockEntry && setStockUsage) {
            stockEntry.linkedEntryId = entryId
            setStockUsage((prev) => [...prev, stockEntry])
        }

        toast.success('Waste entry added')
        setForm(p => ({ ...p, gross_weight: '', net_weight: '', newOrder: '', newClient: '', fromStockId: '' }))
        setShowNewOrder(false)
        setSubmitting(false)
    }

    const handleDelete = (id) => {
        // Find and remove corresponding stock usage entry
        const entry = wastageData.find((item) => item.id === id)
        if (entry?.stockUsageId && setStockUsage) {
            setStockUsage((prev) => prev.filter((u) => u.id !== entry.stockUsageId).map((u, idx) => ({ ...u, sno: idx + 1 })))
        }
        setWastageData((prev) => prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 })))
        toast.success('Waste entry deleted')
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Wastage</h2>
                <p className="text-sm text-text-secondary mt-1">Per-order wastage breakdown &amp; waste roll logging</p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/80 via-blue-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Raw Material In</p>
                    <p className="text-3xl font-semibold text-blue-400">{formatKg(totalRawIn)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">total received</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Material Used</p>
                    <p className="text-3xl font-semibold text-accent-gold">{formatKg(totalMfgInput)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">consumed in mfg</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Mfg Output</p>
                    <p className="text-3xl font-semibold text-emerald-400">{formatKg(totalMfgOutput)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">net weight produced</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Process Wastage</p>
                    <p className="text-3xl font-semibold text-red-400">{formatKg(autoWastage)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">
                        {totalMfgInput > 0 ? `${((autoWastage / totalMfgInput) * 100).toFixed(1)}% of material` : 'no data'}
                    </p>
                </div>
            </div>

            {/* Per-Order Wastage Breakdown Table */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                <div className="px-6 pt-6 pb-4">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Per-Order Wastage Breakdown</h3>
                    <p className="text-xs text-text-secondary/40 mt-1">Material Used vs. Manufacturing Output per order</p>
                </div>
                {perOrderData.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-t border-b border-border-default bg-bg-input/40">
                                    <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Order</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Rolls</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Material Used</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Output</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Wastage</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Wastage %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perOrderData.map((row) => (
                                    <tr key={row.order} className="border-b border-border-default/50 hover:bg-bg-input/20 transition-colors">
                                        <td className="px-6 py-3 text-text-primary font-medium">{row.order}</td>
                                        <td className="text-right px-6 py-3 text-text-secondary">{row.rolls}</td>
                                        <td className="text-right px-6 py-3 text-accent-gold">{row.materialUsed.toFixed(2)} kg</td>
                                        <td className="text-right px-6 py-3 text-emerald-400">{row.output.toFixed(2)} kg</td>
                                        <td className="text-right px-6 py-3 text-red-400 font-semibold">{row.wastage.toFixed(2)} kg</td>
                                        <td className="text-right px-6 py-3">
                                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                                row.wastagePercent > 10 ? 'bg-red-500/20 text-red-400' :
                                                row.wastagePercent > 5 ? 'bg-amber-500/20 text-amber-400' :
                                                'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                                {row.wastagePercent.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-border-default bg-bg-input/30">
                                    <td className="px-6 py-3 text-text-primary font-semibold">Total</td>
                                    <td className="text-right px-6 py-3 text-text-primary font-semibold">{perOrderData.reduce((s, r) => s + r.rolls, 0)}</td>
                                    <td className="text-right px-6 py-3 text-accent-gold font-semibold">{totalMfgInput.toFixed(2)} kg</td>
                                    <td className="text-right px-6 py-3 text-emerald-400 font-semibold">{totalMfgOutput.toFixed(2)} kg</td>
                                    <td className="text-right px-6 py-3 text-red-400 font-bold">{autoWastage.toFixed(2)} kg</td>
                                    <td className="text-right px-6 py-3">
                                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                                            totalMfgInput > 0 && ((autoWastage / totalMfgInput) * 100) > 10 ? 'bg-red-500/20 text-red-400' :
                                            'bg-amber-500/20 text-amber-400'
                                        }`}>
                                            {totalMfgInput > 0 ? ((autoWastage / totalMfgInput) * 100).toFixed(1) : '0.0'}%
                                        </span>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ) : (
                    <div className="px-6 pb-6">
                        <p className="text-sm text-text-secondary/50 italic">No manufacturing data yet. Add manufacturing entries with "Material Used" to see per-order wastage.</p>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Log Waste Form */}
                <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                        Log Waste Roll to Backend
                    </h3>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order</label>
                                <button type="button" onClick={() => setShowNewOrder(!showNewOrder)} className="text-[10px] text-accent-gold hover:underline">
                                    {showNewOrder ? 'Select existing' : '+ New order'}
                                </button>
                            </div>
                            {showNewOrder ? (
                                <div className="space-y-2">
                                    <InputWithCamera type="text" name="newOrder" value={form.newOrder} onChange={handleChange} placeholder="Order number" />
                                    <InputWithCamera type="text" name="newClient" value={form.newClient} onChange={handleChange} placeholder="Client name" />
                                </div>
                            ) : (
                                <select name="order_number" value={form.order_number} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`} required={!showNewOrder}>
                                    <option value="">Select order...</option>
                                    {orders.map((o) => (
                                        <option key={o.order_number} value={o.order_number}>{o.order_number}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* From Stock Batch */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">From Stock Batch</label>
                            <select
                                name="fromStockId"
                                value={form.fromStockId}
                                onChange={handleChange}
                                className={`${inputClass} cursor-pointer`}
                            >
                                <option value="">Select stock batch (optional)...</option>
                                {availableBatches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.label} — {formatKg(b.remaining)} remaining
                                    </option>
                                ))}
                            </select>
                            {form.fromStockId && (
                                <p className="text-[10px] text-emerald-400/70">Stock will be auto-deducted on submit</p>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross Weight</label>
                                <InputWithCamera type="number" name="gross_weight" value={form.gross_weight} onChange={handleChange} step="0.01" placeholder="0.00" required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net Weight</label>
                                <InputWithCamera type="number" name="net_weight" value={form.net_weight} onChange={handleChange} step="0.01" placeholder="0.00" required />
                            </div>
                        </div>

                        {form.gross_weight && form.net_weight && (
                            <div className="bg-bg-input border border-border-default rounded-lg px-4 py-2.5 text-sm">
                                <span className="text-text-secondary">Actual Weight: </span>
                                <span className="text-red-400 font-semibold">
                                    {Math.max(0, parseFloat(form.gross_weight) - parseFloat(form.net_weight)).toFixed(2)}
                                </span>
                            </div>
                        )}

                        <button type="submit" disabled={submitting} className="w-full bg-red-500/80 text-white font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-red-500 active:scale-[0.98] disabled:opacity-50">
                            {submitting ? 'Logging...' : 'Log Waste Entry'}
                        </button>
                    </form>
                </div>

                {/* Chart */}
                <WastageAreaChart data={chartData} />
            </div>

            {/* Wastage History Table */}
            <DataTable columns={historyColumns} data={wastageData} emptyMessage="No wastage entries logged yet." onDelete={handleDelete} />
        </div>
    )
}
