import { useState, useMemo } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import api from '../utils/api'

const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'order_number', label: 'Order' },
    { key: 'grossWeight', label: 'Gross Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'tareWeight', label: 'Tare Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'materialUsed', label: 'Material Used', render: (v) => v ? Number(v).toFixed(2) : '—' },
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

export default function Manufacturing({ user, data, setData, rawMaterials = [], stockUsage = [], setStockUsage, ordersList = [] }) {
    const toast = useToast()
    const [form, setForm] = useState({
        date: '',
        order_number: '',
        newOrder: '',
        newClient: '',
        grossWeight: '',
        tareWeight: '',
        materialUsed: '',
        sizeMic: '',
        fromStockId: '',
    })
    const [submitting, setSubmitting] = useState(false)
    const [filterBrand, setFilterBrand] = useState('')
    const [filterCode, setFilterCode] = useState('')

    // Unique brand/code values from raw materials
    const uniqueBrands = useMemo(() => [...new Set(rawMaterials.map(r => r.brandName).filter(Boolean))].sort(), [rawMaterials])
    const uniqueCodes = useMemo(() => [...new Set(rawMaterials.map(r => r.codeName).filter(Boolean))].sort(), [rawMaterials])



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
                    label: `${r.date} — ${r.quantityDisplay || formatKg(r.quantityInKg || 0)}${r.brandName ? ` [${r.brandName}]` : ''}${r.codeName ? ` (${r.codeName})` : ''}`,
                }
            })
    }, [rawMaterials, stockUsage])

    const availableBatches = stockBatches.filter((b) => {
        if (b.remaining <= 0) return false
        if (filterBrand && b.brandName !== filterBrand) return false
        if (filterCode && b.codeName !== filterCode) return false
        return true
    })
    const totalStockIn = stockBatches.reduce((s, b) => s + b.initialQty, 0)
    const totalStockUsed = stockBatches.reduce((s, b) => s + b.totalUsed, 0)
    const currentStock = totalStockIn - totalStockUsed

    const handleSubmit = async (e) => {
        e.preventDefault()

        let orderNum = form.order_number

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
        // Material used = user-specified input, or defaults to net weight
        const matUsed = form.materialUsed ? parseFloat(form.materialUsed) : net
        if (matUsed < net) {
            toast.error('Material used cannot be less than net weight output')
            return
        }

        // Validate stock batch if selected
        let stockEntry = null
        if (form.fromStockId) {
            const batch = stockBatches.find((b) => b.id === Number(form.fromStockId))
            if (!batch) {
                toast.error('Selected stock batch not found')
                return
            }
            // Deduct by material used (raw material consumed), not net weight (output)
            if (matUsed > batch.remaining) {
                toast.error(`Cannot use ${formatKg(matUsed)} — only ${formatKg(batch.remaining)} remaining in this stock.`)
                return
            }

            stockEntry = {
                id: Date.now() + 1,
                sno: stockUsage.length + 1,
                date: form.date,
                quantityUsed: matUsed,
                quantityUnit: 'kg',
                quantityInKg: matUsed,
                fromStockId: batch.id,
                fromStockLabel: batch.label,
                beforeBalance: batch.remaining,
                afterBalance: batch.remaining - matUsed,
                logMessage: `${formatKg(matUsed)} used for Manufacturing (${orderNum}) from stock (${batch.label})`,
                source: 'Manufacturing',
                order_number: orderNum,
            }
        }

        setSubmitting(true)

        const entryId = Date.now()
        const entry = {
            id: entryId,
            sno: data.length + 1,
            date: form.date,
            order_number: orderNum,
            grossWeight: gross,
            tareWeight: tare,
            netWeight: net,
            materialUsed: matUsed,
            sizeMic: form.sizeMic,
            stockUsageId: stockEntry ? stockEntry.id : null,
        }

        try {
            await api.post('/manufacturing', entry)
        } catch (err) {
            console.error('Failed to save manufacturing entry', err)
        }

        setData((prev) => [...prev, entry])

        // Auto-deduct from stock
        if (stockEntry && setStockUsage) {
            stockEntry.linkedEntryId = entryId
            try {
                await api.post('/stock-usage', stockEntry)
            } catch (err) {
                console.error('Failed to save stock usage entry', err)
            }
            setStockUsage((prev) => [...prev, stockEntry])
        }

        toast.success('Manufacturing entry added')
        setForm({ date: '', order_number: orderNum, newOrder: '', newClient: '', grossWeight: '', tareWeight: '', materialUsed: '', sizeMic: '', fromStockId: '' })
        setSubmitting(false)
    }

    const handleDelete = (id) => {
        // Find and remove corresponding stock usage entry
        const entry = data.find((item) => item.id === id)
        if (entry?.stockUsageId && setStockUsage) {
            setStockUsage((prev) => prev.filter((u) => u.id !== entry.stockUsageId).map((u, idx) => ({ ...u, sno: idx + 1 })))
        }
        setData((prev) => prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 })))
        toast.success('Entry deleted')
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
                        <InputWithCamera type="date" name="date" value={form.date} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order</label>
                        <select name="order_number" value={form.order_number} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`} required>
                            <option value="">Select order...</option>
                            {ordersList.map((o) => (
                                <option key={o.order_number} value={o.order_number}>{o.order_number} {o.client_name ? `(${o.client_name})` : ''}</option>
                            ))}
                        </select>
                    </div>

                    {/* Brand / Code Filters */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Filter by Brand</label>
                        <select
                            value={filterBrand}
                            onChange={(e) => { setFilterBrand(e.target.value); setForm(prev => ({ ...prev, fromStockId: '' })) }}
                            className={`${inputClass} cursor-pointer`}
                        >
                            <option value="">All Brands</option>
                            {uniqueBrands.map((b) => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Filter by Code</label>
                        <select
                            value={filterCode}
                            onChange={(e) => { setFilterCode(e.target.value); setForm(prev => ({ ...prev, fromStockId: '' })) }}
                            className={`${inputClass} cursor-pointer`}
                        >
                            <option value="">All Codes</option>
                            {uniqueCodes.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
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
                        <InputWithCamera type="number" name="grossWeight" value={form.grossWeight} onChange={handleChange} step="0.01" placeholder="0.00" required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Tare Weight</label>
                        <InputWithCamera type="number" name="tareWeight" value={form.tareWeight} onChange={handleChange} step="0.01" placeholder="0.00" required />
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
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                            Material Used (kg) <span className="text-text-secondary/50 normal-case">(raw material consumed)</span>
                        </label>
                        <InputWithCamera type="number" name="materialUsed" value={form.materialUsed} onChange={handleChange} step="0.01" placeholder={netWeight > 0 ? `Default: ${netWeight.toFixed(2)}` : '0.00'} />
                        {form.materialUsed && parseFloat(form.materialUsed) > netWeight && netWeight > 0 && (
                            <p className="text-[10px] text-red-400/70">
                                Wastage: {(parseFloat(form.materialUsed) - netWeight).toFixed(2)} kg ({((parseFloat(form.materialUsed) - netWeight) / parseFloat(form.materialUsed) * 100).toFixed(1)}%)
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Size & Mic</label>
                        <InputWithCamera type="text" name="sizeMic" value={form.sizeMic} onChange={handleChange} placeholder="e.g. 12mm / 3.5 mic" />
                    </div>

                    <div className="flex items-end md:col-span-2">
                        <button type="submit" disabled={submitting} className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50">
                            {submitting ? 'Logging...' : 'Add Entry'}
                        </button>
                    </div>
                </form>
            </div>

            <DataTable columns={columns} data={data} emptyMessage="No manufacturing entries yet." onDelete={user?.role === 'owner' ? handleDelete : undefined} />
        </div>
    )
}
