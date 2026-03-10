import { useState, useEffect, useMemo } from 'react'
import DataTable from '../components/DataTable'
import { WastageAreaChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import { logRoll, fetchOrdersSummary, createOrder, deleteRoll } from '../utils/api'

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

    useEffect(() => {
        fetchOrdersSummary().then(setOrders).catch(() => { })
    }, [])

    const totalRawNet = rawMaterials.reduce((s, i) => s + i.netWeight, 0)
    const totalMfgNet = manufacturingData.reduce((s, i) => s + i.netWeight, 0)
    const totalWasteLogged = wastageData.reduce((s, i) => s + (i.actualWeight || 0), 0)
    const autoWastage = Math.max(0, totalRawNet - totalMfgNet)

    const chartData = useMemo(() => [
        { name: 'Raw Material', value: totalRawNet },
        { name: 'Manufacturing', value: totalMfgNet },
        { name: 'Wastage', value: autoWastage },
    ], [totalRawNet, totalMfgNet, autoWastage])

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
            try {
                await createOrder({ order_number: form.newOrder.trim(), client_name: form.newClient.trim() })
                toast.success(`Order "${form.newOrder.trim()}" created`)
                orderNum = form.newOrder.trim()
                fetchOrdersSummary().then(setOrders).catch(() => { })
            } catch (err) {
                if (!err.message.includes('already exists')) { toast.error(err.message); return }
                orderNum = form.newOrder.trim()
            }
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
        try {
            const result = await logRoll({ order_number: orderNum, material: 'waste', gross_weight: gross, net_weight: net })

            const entryId = result?.id || Date.now()
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

            toast.success('Waste entry logged to backend')
            setForm(p => ({ ...p, gross_weight: '', net_weight: '', newOrder: '', newClient: '', fromStockId: '' }))
            setShowNewOrder(false)
        } catch (err) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        // Find and remove corresponding stock usage entry
        const entry = wastageData.find((item) => item.id === id)
        if (entry?.stockUsageId && setStockUsage) {
            setStockUsage((prev) => prev.filter((u) => u.id !== entry.stockUsageId).map((u, idx) => ({ ...u, sno: idx + 1 })))
        }

        try {
            await deleteRoll(id)
            toast.success('Waste entry deleted from backend')
        } catch (err) {
            toast.error(err.message)
        }
        setWastageData((prev) => prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 })))
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Wastage</h2>
                <p className="text-sm text-text-secondary mt-1">Auto-calculated wastage &amp; log waste rolls to backend</p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Auto-calculated wastage card */}
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Auto Wastage</p>
                    <p className="text-3xl font-semibold text-red-400">{autoWastage.toFixed(2)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">Raw − Manufacturing</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500/80 via-amber-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Logged Wastage</p>
                    <p className="text-3xl font-semibold text-amber-400">{totalWasteLogged.toFixed(2)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">{wastageData.length} entries</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Current Stock</p>
                    <p className={`text-3xl font-semibold ${currentStock >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>{formatKg(currentStock)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">available in raw material</p>
                </div>
            </div>

            {/* Detailed wastage breakdown */}
            <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-8 overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Auto-Calculated Wastage</h3>
                </div>
                <p className="text-5xl font-bold text-text-primary mb-4">{autoWastage.toFixed(2)}</p>
                <div className="text-sm text-text-secondary space-y-1">
                    <p>Raw Material Net: <span className="text-text-primary font-medium">{totalRawNet.toFixed(2)}</span></p>
                    <p>Manufacturing Net: <span className="text-text-primary font-medium">{totalMfgNet.toFixed(2)}</span></p>
                    <p className="text-accent-gold pt-2 font-medium">Wastage = Raw - Manufacturing</p>
                </div>
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
                                    <input type="text" name="newOrder" value={form.newOrder} onChange={handleChange} placeholder="Order number" className={inputClass} />
                                    <input type="text" name="newClient" value={form.newClient} onChange={handleChange} placeholder="Client name" className={inputClass} />
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
                                <input type="number" name="gross_weight" value={form.gross_weight} onChange={handleChange} step="0.01" placeholder="0.00" className={inputClass} required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net Weight</label>
                                <input type="number" name="net_weight" value={form.net_weight} onChange={handleChange} step="0.01" placeholder="0.00" className={inputClass} required />
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
