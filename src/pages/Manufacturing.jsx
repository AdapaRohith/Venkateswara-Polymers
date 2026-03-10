import { useState, useEffect, useMemo } from 'react'
import DataTable from '../components/DataTable'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import { logRoll, fetchOrdersSummary, createOrder, deleteRoll } from '../utils/api'

const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'order_number', label: 'Order' },
    { key: 'grossWeight', label: 'Gross Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'tareWeight', label: 'Tare Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'sizeMic', label: 'Size & Mic' },
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

export default function Manufacturing({ data, setData, rawMaterials = [], stockUsage = [], setStockUsage }) {
    const toast = useToast()
    const [orders, setOrders] = useState([])
    const [form, setForm] = useState({
        date: '',
        order_number: '',
        newOrder: '',
        newClient: '',
        grossWeight: '',
        tareWeight: '',
        sizeMic: '',
        fromStockId: '',
    })
    const [submitting, setSubmitting] = useState(false)
    const [showNewOrder, setShowNewOrder] = useState(false)

    useEffect(() => {
        fetchOrdersSummary().then(setOrders).catch(() => { })
    }, [])

    const netWeight = (parseFloat(form.grossWeight) || 0) - (parseFloat(form.tareWeight) || 0)

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    }

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
                if (!err.message.includes('already exists')) {
                    toast.error(err.message)
                    return
                }
                orderNum = form.newOrder.trim()
            }
        }

        if (!orderNum || !form.date || !form.grossWeight || !form.tareWeight) {
            toast.error('Please fill all required fields')
            return
        }

        const gross = parseFloat(form.grossWeight)
        const tare = parseFloat(form.tareWeight)
        if (gross < tare) {
            toast.error('Gross weight must be ≥ Tare weight')
            return
        }

        const net = gross - tare

        // Validate stock batch if selected
        let stockEntry = null
        if (form.fromStockId) {
            const batch = stockBatches.find((b) => b.id === Number(form.fromStockId))
            if (!batch) {
                toast.error('Selected stock batch not found')
                return
            }
            // net weight is in the unit used on this page (not kg/tons), convert to kg for stock
            const netInKg = net // manufacturing net weight treated as kg
            if (netInKg > batch.remaining) {
                toast.error(`Cannot use ${formatKg(netInKg)} — only ${formatKg(batch.remaining)} remaining in this stock.`)
                return
            }

            stockEntry = {
                id: Date.now() + 1,
                sno: stockUsage.length + 1,
                date: form.date,
                quantityUsed: net,
                quantityUnit: 'kg',
                quantityInKg: netInKg,
                fromStockId: batch.id,
                fromStockLabel: batch.label,
                beforeBalance: batch.remaining,
                afterBalance: batch.remaining - netInKg,
                logMessage: `${formatKg(netInKg)} used for Manufacturing (${orderNum}) from stock (${batch.label})`,
                source: 'Manufacturing',
            }
        }

        setSubmitting(true)
        try {
            const result = await logRoll({
                order_number: orderNum,
                material: 'manufactured',
                gross_weight: gross,
                net_weight: tare,
            })

            const entryId = result?.id || Date.now()
            const entry = {
                id: entryId,
                sno: data.length + 1,
                date: form.date,
                order_number: orderNum,
                grossWeight: gross,
                tareWeight: tare,
                netWeight: net,
                sizeMic: form.sizeMic,
                stockUsageId: stockEntry ? stockEntry.id : null,
            }
            setData((prev) => [...prev, entry])

            // Auto-deduct from stock
            if (stockEntry && setStockUsage) {
                stockEntry.linkedEntryId = entryId
                setStockUsage((prev) => [...prev, stockEntry])
            }

            toast.success('Manufacturing entry logged to backend')
            setForm({ date: '', order_number: orderNum, newOrder: '', newClient: '', grossWeight: '', tareWeight: '', sizeMic: '', fromStockId: '' })
            setShowNewOrder(false)
        } catch (err) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        // Find and remove corresponding stock usage entry
        const entry = data.find((item) => item.id === id)
        if (entry?.stockUsageId && setStockUsage) {
            setStockUsage((prev) => prev.filter((u) => u.id !== entry.stockUsageId).map((u, idx) => ({ ...u, sno: idx + 1 })))
        }

        try {
            await deleteRoll(id)
            toast.success('Entry deleted from backend')
        } catch (err) {
            toast.error(err.message)
        }
        setData((prev) => prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 })))
    }

    // ── Summary calculations ──
    const today = new Date().toISOString().split('T')[0]
    const todayEntries = data.filter((d) => d.date === today)

    const totalEntries = data.length
    const totalNetWeight = data.reduce((s, i) => s + i.netWeight, 0)
    const todayCount = todayEntries.length
    const todayNet = todayEntries.reduce((s, i) => s + i.netWeight, 0)

    // Chart: daily net weight breakdown
    const chartData = useMemo(() => {
        const map = {}
        data.forEach((d) => {
            if (!map[d.date]) map[d.date] = 0
            map[d.date] += d.netWeight
        })
        return Object.entries(map)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ name: date, value }))
    }, [data])

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Manufacturing</h2>
                <p className="text-sm text-text-secondary mt-1">Log manufactured rolls — synced to backend</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{totalEntries}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Net Weight</p>
                    <p className="text-3xl font-semibold text-accent-gold">{totalNetWeight.toFixed(2)}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Current Stock</p>
                    <p className={`text-3xl font-semibold ${currentStock >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>{formatKg(currentStock)}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{todayCount}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">{todayNet.toFixed(2)} net</p>
                </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
                <SectionBarChart data={chartData} title="Daily Manufacturing Output" color="#f59e0b" />
            )}

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                    Add Manufacturing Entry
                </h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                        <input type="date" name="date" value={form.date} onChange={handleChange} className={inputClass} required />
                    </div>

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

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross Weight</label>
                        <input type="number" name="grossWeight" value={form.grossWeight} onChange={handleChange} step="0.01" placeholder="0.00" className={inputClass} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Tare Weight</label>
                        <input type="number" name="tareWeight" value={form.tareWeight} onChange={handleChange} step="0.01" placeholder="0.00" className={inputClass} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                            Net Weight <span className="text-accent-gold/70">(auto)</span>
                        </label>
                        <div className="w-full bg-bg-input text-accent-gold border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-semibold">
                            {netWeight.toFixed(2)}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Size & Mic</label>
                        <input type="text" name="sizeMic" value={form.sizeMic} onChange={handleChange} placeholder="e.g. 12mm / 3.5 mic" className={inputClass} />
                    </div>

                    <div className="flex items-end md:col-span-2">
                        <button type="submit" disabled={submitting} className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50">
                            {submitting ? 'Logging...' : 'Add Entry'}
                        </button>
                    </div>
                </form>
            </div>

            <DataTable columns={columns} data={data} emptyMessage="No manufacturing entries yet." onDelete={handleDelete} />
        </div>
    )
}
