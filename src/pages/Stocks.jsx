import { useState, useMemo } from 'react'
import { SectionBarChart } from '../components/Charts'
import InputWithCamera from '../components/InputWithCamera'
import DataTable from '../components/DataTable'

// Convert any unit to kg
function toKg(value, unit) {
    if (unit === 'tons') return value * 1000
    return value // kg
}

// Format kg into a readable string
function formatKg(kg) {
    if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(2)} tons`
    return `${kg.toFixed(2)} kg`
}

export default function Stocks({ rawMaterials, stockUsage, setStockUsage }) {
    const [form, setForm] = useState({
        date: '',
        quantityUsed: '',
        quantityUnit: 'kg',
        fromStockId: '',
    })
    const [filterBrand, setFilterBrand] = useState('')
    const [filterCode, setFilterCode] = useState('')

    // Unique brand/code values from raw materials
    const uniqueBrands = useMemo(() => [...new Set(rawMaterials.map(r => r.brandName).filter(Boolean))].sort(), [rawMaterials])
    const uniqueCodes = useMemo(() => [...new Set(rawMaterials.map(r => r.codeName).filter(Boolean))].sort(), [rawMaterials])

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    }

    // ── Calculate remaining balance per stock batch ──
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

    // Only show batches that still have stock remaining
    const availableBatches = stockBatches.filter((b) => {
        if (b.remaining <= 0) return false
        if (filterBrand && b.brandName !== filterBrand) return false
        if (filterCode && b.codeName !== filterCode) return false
        return true
    })

    const handleSubmit = (e) => {
        e.preventDefault()
        if (!form.date || !form.quantityUsed || !form.fromStockId) return

        const qty = parseFloat(form.quantityUsed)
        if (!qty || qty <= 0) return

        const unit = form.quantityUnit
        const qtyInKg = toKg(qty, unit)

        // Find the selected batch
        const batch = stockBatches.find((b) => b.id === Number(form.fromStockId))
        if (!batch) return

        // Don't allow usage greater than remaining
        if (qtyInKg > batch.remaining) {
            alert(`Cannot use ${formatKg(qtyInKg)} — only ${formatKg(batch.remaining)} remaining in this stock.`)
            return
        }

        const newRemaining = batch.remaining - qtyInKg

        const entry = {
            id: Date.now(),
            sno: stockUsage.length + 1,
            date: form.date,
            quantityUsed: qty,
            quantityUnit: unit,
            quantityInKg: qtyInKg,
            fromStockId: batch.id,
            fromStockLabel: batch.label,
            beforeBalance: batch.remaining,
            afterBalance: newRemaining,
            logMessage: `${formatKg(qtyInKg)} used from stock (${batch.label}) — ${formatKg(batch.remaining)} → ${formatKg(newRemaining)} remaining`,
        }

        setStockUsage((prev) => [...prev, entry])
        setForm({ date: '', quantityUsed: '', quantityUnit: 'kg', fromStockId: '' })
    }

    const handleDeleteUsage = (id) => {
        setStockUsage((prev) =>
            prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 }))
        )
    }

    const handlePrintStockHistory = () => {
        if (!stockUsage.length) return

        const printWindow = window.open('', '_blank', 'width=900,height=700')
        if (!printWindow) return

        const escapeHtml = (value) => String(value ?? '—')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')

        const rows = [...stockUsage]
            .reverse()
            .map((entry) => `
                <tr>
                    <td>${entry.sno ?? '—'}</td>
                    <td>${escapeHtml(entry.date)}</td>
                    <td>${escapeHtml(entry.quantityUsed)} ${escapeHtml(entry.quantityUnit)}</td>
                    <td>${formatKg(entry.quantityInKg || 0)}</td>
                    <td>${escapeHtml(entry.fromStockLabel)}</td>
                    <td>${formatKg(entry.beforeBalance || 0)}</td>
                    <td>${formatKg(entry.afterBalance || 0)}</td>
                    <td>${escapeHtml(entry.logMessage || '')}</td>
                </tr>
            `)
            .join('')

        printWindow.document.write(`
            <html>
                <head>
                    <title>Stock Usage History</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
                        h1 { margin: 0 0 6px; font-size: 20px; }
                        p { margin: 0 0 16px; color: #4b5563; font-size: 12px; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
                        th { background: #f3f4f6; font-weight: 600; }
                    </style>
                </head>
                <body>
                    <h1>Stock Usage History</h1>
                    <p>Generated on ${new Date().toLocaleString()}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Date</th>
                                <th>Quantity Used</th>
                                <th>Quantity in KG</th>
                                <th>From Stock Batch</th>
                                <th>Before Balance</th>
                                <th>After Balance</th>
                                <th>Log Message</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </body>
            </html>
        `)

        printWindow.document.close()
        printWindow.focus()
        printWindow.print()
        printWindow.close()
    }

    // ── Summary values ──
    const totalStockIn = stockBatches.reduce((s, b) => s + b.initialQty, 0)
    const totalStockUsed = stockBatches.reduce((s, b) => s + b.totalUsed, 0)
    const currentStock = totalStockIn - totalStockUsed
    const today = new Date().toISOString().split('T')[0]
    const todayUsage = stockUsage
        .filter((u) => u.date === today)
        .reduce((s, u) => s + u.quantityInKg, 0)

    // ── Chart: remaining per batch ──
    const chartData = useMemo(() => {
        return stockBatches.map((b) => ({
            name: b.date,
            value: b.remaining / 1000,
        }))
    }, [stockBatches])

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'
    const selectClass =
        'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold shrink-0 appearance-none cursor-pointer text-center'

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Stocks</h2>
                <p className="text-sm text-text-secondary mt-1">
                    Track raw material inventory — per-batch remaining balance
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Stock In</p>
                    <p className="text-3xl font-semibold text-emerald-400">{formatKg(totalStockIn)}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Stock Used</p>
                    <p className="text-3xl font-semibold text-red-400">{formatKg(totalStockUsed)}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Current Stock</p>
                    <p className={`text-3xl font-semibold ${currentStock >= 0 ? 'text-accent-gold' : 'text-red-500'}`}>
                        {formatKg(currentStock)}
                    </p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/80 via-blue-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Usage</p>
                    <p className="text-3xl font-semibold text-blue-400">{formatKg(todayUsage)}</p>
                </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
                <SectionBarChart data={chartData} title="Remaining Stock per Batch (tons)" color="#10b981" />
            )}

            {/* Stock Batches Table */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                <div className="px-6 pt-6 pb-4">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">
                        Stock Batches
                    </h3>
                    <p className="text-xs text-text-secondary/50 mt-1">Each raw material entry is a separate stock batch</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-y border-border-default bg-white/[0.02]">
                                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">#</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Date Received</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Brand</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Code</th>
                                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Initial Qty</th>
                                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Used</th>
                                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Remaining</th>
                                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stockBatches.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-10 text-center text-text-secondary/50">
                                        No stock batches. Add raw material entries to create stock.
                                    </td>
                                </tr>
                            ) : (
                                stockBatches.map((batch, idx) => (
                                    <tr
                                        key={batch.id}
                                        className={`border-b border-border-default/50 transition-colors hover:bg-white/[0.02] ${batch.remaining <= 0 ? 'opacity-50' : ''
                                            }`}
                                    >
                                        <td className="px-6 py-3 text-text-secondary">{idx + 1}</td>
                                        <td className="px-6 py-3 text-text-primary font-medium">{batch.date}</td>
                                        <td className="px-6 py-3 text-text-primary">{batch.brandName || '—'}</td>
                                        <td className="px-6 py-3 text-text-secondary">{batch.codeName || '—'}</td>
                                        <td className="px-6 py-3 text-right text-emerald-400">{formatKg(batch.initialQty)}</td>
                                        <td className="px-6 py-3 text-right text-red-400">
                                            {batch.totalUsed > 0 ? formatKg(batch.totalUsed) : '—'}
                                        </td>
                                        <td className={`px-6 py-3 text-right font-semibold ${batch.remaining > 0 ? 'text-accent-gold' : 'text-red-500'}`}>
                                            {formatKg(batch.remaining)}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            {batch.remaining <= 0 ? (
                                                <span className="text-[10px] font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded">EMPTY</span>
                                            ) : batch.totalUsed > 0 ? (
                                                <span className="text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">IN USE</span>
                                            ) : (
                                                <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">FULL</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Log Usage Form */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                    Log Raw Material Usage
                </h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                        <InputWithCamera
                            type="date"
                            name="date"
                            value={form.date}
                            onChange={handleChange}
                            required
                        />
                    </div>

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

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">From Stock Batch</label>
                        <select
                            name="fromStockId"
                            value={form.fromStockId}
                            onChange={handleChange}
                            className={`${inputClass} cursor-pointer`}
                            required
                        >
                            <option value="">Select stock batch...</option>
                            {availableBatches.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.label} — {formatKg(b.remaining)} remaining
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity Used</label>
                        <div className="flex gap-2">
                            <InputWithCamera
                                type="text"
                                inputMode="decimal"
                                name="quantityUsed"
                                value={form.quantityUsed}
                                onChange={handleChange}
                                placeholder="0.00"
                                className="flex-1"
                                required
                            />
                            <select
                                name="quantityUnit"
                                value={form.quantityUnit}
                                onChange={handleChange}
                                className={`${selectClass} w-24`}
                            >
                                <option value="kg">kg</option>
                                <option value="tons">tons</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-end">
                        <button
                            type="submit"
                            className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98]"
                        >
                            Log Usage
                        </button>
                    </div>
                </form>
            </div>

            {/* Usage Log History */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">
                        Usage Log History
                    </h3>
                    <button
                        type="button"
                        onClick={handlePrintStockHistory}
                        disabled={stockUsage.length === 0}
                        className="text-xs font-medium tracking-wide uppercase px-3 py-1.5 rounded-md border border-border-default text-text-secondary hover:text-text-primary hover:border-accent-gold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Print Stock History
                    </button>
                </div>
                {stockUsage.length === 0 ? (
                    <div className="px-6 pb-8 text-center text-text-secondary/50 text-sm">
                        No usage logged yet. Select a stock batch and log daily usage above.
                    </div>
                ) : (
                    <div className="px-4 pb-4 space-y-2">
                        {[...stockUsage].reverse().map((entry) => (
                            <div
                                key={entry.id}
                                className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border-default/50 bg-white/[0.01] hover:bg-white/[0.03] transition-colors group"
                            >
                                {/* Timeline dot */}
                                <div className="mt-1.5 w-2 h-2 rounded-full bg-red-400 shrink-0" />
                                {/* Log content */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-text-primary leading-relaxed">
                                        <span className="font-semibold text-red-400">{formatKg(entry.quantityInKg)}</span>
                                        {' '}used from stock{' '}
                                        <span className="font-medium text-accent-gold">({entry.fromStockLabel})</span>
                                    </p>
                                    <p className="text-xs text-text-secondary/60 mt-0.5">
                                        {formatKg(entry.beforeBalance)} → {formatKg(entry.afterBalance)} remaining
                                    </p>
                                    <p className="text-[10px] text-text-secondary/40 mt-1">{entry.date}</p>
                                </div>
                                {/* Delete */}
                                <button
                                    onClick={() => handleDeleteUsage(entry.id)}
                                    className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 p-1 rounded transition-all"
                                    title="Delete entry"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
