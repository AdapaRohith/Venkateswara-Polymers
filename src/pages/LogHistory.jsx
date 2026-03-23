import { useState, useMemo } from 'react'

// Format kg into a readable string
function formatKg(kg) {
    if (kg === undefined || kg === null) return '0.00 kg'
    if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(2)} tons`
    return `${kg.toFixed(2)} kg`
}

export default function LogHistory({ rawMaterials = [], manufacturingData = [], tradingData = [], wastageData = [], stockUsage = [] }) {
    const [date, setDate] = useState('')

    // Combine all section data into a single list with a section label
    const allEntries = useMemo(() => {
        const entries = []

        rawMaterials.forEach((r) => {
            entries.push({
                id: r.id,
                section: 'Raw Material',
                date: r.date,
                order_number: r.order_number || '—',
                grossWeight: r.grossWeight,
                tareWeight: r.tareWeight,
                netWeight: r.netWeight,
                sizeMic: r.sizeMic || '',
            })
        })

        manufacturingData.forEach((m) => {
            entries.push({
                id: m.id,
                section: 'Manufacturing',
                date: m.date,
                order_number: m.order_number || '—',
                grossWeight: m.grossWeight,
                tareWeight: m.tareWeight,
                netWeight: m.netWeight,
                sizeMic: m.sizeMic || '',
            })
        })

        tradingData.forEach((t) => {
            entries.push({
                id: t.id,
                section: 'Trading',
                date: t.date,
                order_number: t.order_number || '—',
                grossWeight: t.netWeight,
                tareWeight: 0,
                netWeight: t.netWeight,
                sizeMic: t.sizeMic || '',
                rate: t.rate,
                totalValue: t.totalValue,
                type: t.type,
            })
        })

        wastageData.forEach((w) => {
            entries.push({
                id: w.id,
                section: 'Wastage',
                date: w.date,
                order_number: w.order_number || '—',
                grossWeight: w.grossWeight,
                tareWeight: w.netWeight,
                netWeight: w.actualWeight || (w.grossWeight - w.netWeight),
                sizeMic: '',
            })
        })

        stockUsage.forEach((u) => {
            entries.push({
                id: u.id,
                section: 'Stock Usage',
                date: u.date,
                order_number: '—',
                grossWeight: 0,
                tareWeight: 0,
                netWeight: u.quantityInKg,
                sizeMic: '',
                stockBatch: u.fromStockLabel,
                beforeBalance: u.beforeBalance,
                afterBalance: u.afterBalance,
                source: u.source || 'Manual',
                logMessage: u.logMessage,
            })
        })

        return entries
    }, [rawMaterials, manufacturingData, tradingData, wastageData, stockUsage])

    // Filter by selected date (if set)
    const filtered = useMemo(() => {
        if (!date) return allEntries
        return allEntries.filter((e) => e.date === date)
    }, [allEntries, date])

    // Group by section for display
    const grouped = useMemo(() => {
        const map = {}
        filtered.forEach((e) => {
            if (!map[e.section]) map[e.section] = []
            map[e.section].push(e)
        })
        return map
    }, [filtered])

    const sectionOrder = ['Raw Material', 'Manufacturing', 'Trading', 'Wastage', 'Stock Usage']
    const sectionColors = {
        'Raw Material': 'bg-blue-500/15 text-blue-400',
        Manufacturing: 'bg-accent-gold/15 text-accent-gold',
        Trading: 'bg-emerald-500/15 text-emerald-400',
        Wastage: 'bg-red-500/15 text-red-400',
        'Stock Usage': 'bg-violet-500/15 text-violet-400',
    }

    const inputClass =
        'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold'

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Log History</h2>
                    <p className="text-sm text-text-secondary mt-1">View records from Raw Material, Manufacturing, Trading, Wastage &amp; Stock Usage sections</p>
                </div>
                <div className="flex items-end gap-3">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Filter by Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    {date && (
                        <button
                            onClick={() => setDate('')}
                            className="text-xs text-accent-gold hover:underline pb-2.5"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                {sectionOrder.map((sec) => (
                    <div key={sec} className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                        <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">{sec}</p>
                        <p className="text-3xl font-semibold text-text-primary">{(grouped[sec] || []).length}</p>
                        <p className="text-xs text-text-secondary/50 mt-1">entries{date ? ` on ${date}` : ''}</p>
                    </div>
                ))}
            </div>

            {/* Tables per section */}
            {filtered.length === 0 ? (
                <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                    <p className="text-text-secondary/50 text-sm text-center py-12">
                        No records found{date ? ` for ${date}` : ''}. Add entries in Raw Material, Manufacturing or Trading sections first.
                    </p>
                </div>
            ) : (
                sectionOrder.map((sec) => {
                    const rows = grouped[sec]
                    if (!rows || rows.length === 0) return null

                    // Special layout for Stock Usage section
                    if (sec === 'Stock Usage') {
                        return (
                            <div key={sec} className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                                <div className="px-6 py-4 border-b border-border-default flex items-center gap-3">
                                    <span className={`px-2.5 py-1 rounded text-xs font-medium ${sectionColors[sec]}`}>
                                        {sec}
                                    </span>
                                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">
                                        — {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                                    </h3>
                                </div>
                                <div className="px-4 pb-4 pt-2 space-y-2">
                                    {rows.map((row, idx) => (
                                        <div
                                            key={row.id}
                                            className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border-default/50 bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
                                        >
                                            <div className="mt-1.5 w-2 h-2 rounded-full bg-violet-400 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-text-primary leading-relaxed">
                                                    <span className="font-semibold text-violet-400">{formatKg(row.netWeight)}</span>
                                                    {' '}used from stock{' '}
                                                    <span className="font-medium text-accent-gold">({row.stockBatch})</span>
                                                    {row.source && row.source !== 'Manual' && (
                                                        <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-medium ${row.source === 'Manufacturing' ? 'bg-accent-gold/15 text-accent-gold' : 'bg-red-500/15 text-red-400'}`}>
                                                            {row.source}
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-xs text-text-secondary/60 mt-0.5">
                                                    {formatKg(row.beforeBalance)} → {formatKg(row.afterBalance)} remaining
                                                </p>
                                                <p className="text-[10px] text-text-secondary/40 mt-1">{row.date}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    }

                    return (
                        <div key={sec} className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                            <div className="px-6 py-4 border-b border-border-default flex items-center gap-3">
                                <span className={`px-2.5 py-1 rounded text-xs font-medium ${sectionColors[sec]}`}>
                                    {sec}
                                </span>
                                <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">
                                    — {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                                </h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border-default">
                                            <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">S.No</th>
                                            <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Date</th>
                                            {sec !== 'Raw Material' && (
                                                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Order</th>
                                            )}
                                            <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Gross</th>
                                            <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Tare</th>
                                            <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Net</th>
                                            {sec === 'Trading' && (
                                                <>
                                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Rate</th>
                                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Total</th>
                                                    <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Type</th>
                                                </>
                                            )}
                                            <th className="text-left px-6 py-3 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">Size & Mic</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, idx) => (
                                            <tr
                                                key={row.id}
                                                className={`border-b border-border-subtle transition-colors hover:bg-white/[0.02] ${idx % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                                            >
                                                <td className="px-6 py-3 text-text-secondary">{idx + 1}</td>
                                                <td className="px-6 py-3 text-text-primary/90">{row.date}</td>
                                                {sec !== 'Raw Material' && (
                                                    <td className="px-6 py-3 text-text-primary/90 font-medium">{row.order_number}</td>
                                                )}
                                                <td className="px-6 py-3 text-text-primary/90">{Number(row.grossWeight).toFixed(2)}</td>
                                                <td className="px-6 py-3 text-text-primary/90">{Number(row.tareWeight).toFixed(2)}</td>
                                                <td className="px-6 py-3 text-accent-gold font-medium">{Number(row.netWeight).toFixed(2)}</td>
                                                {sec === 'Trading' && (
                                                    <>
                                                        <td className="px-6 py-3 text-text-primary/90">₹{Number(row.rate).toFixed(2)}</td>
                                                        <td className="px-6 py-3 text-text-primary/90">₹{Number(row.totalValue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                        <td className="px-6 py-3">
                                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.type === 'Buy' ? 'bg-accent-gold/15 text-accent-gold' : 'bg-emerald-500/15 text-emerald-400'}`}>
                                                                {row.type}
                                                            </span>
                                                        </td>
                                                    </>
                                                )}
                                                <td className="px-6 py-3 text-text-secondary">{row.sizeMic || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                })
            )}
        </div>
    )
}
