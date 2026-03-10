import { useState, useMemo } from 'react'
import DataTable from '../components/DataTable'
import { SectionBarChart } from '../components/Charts'

const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'quantityDisplay', label: 'Qty Received' },
    { key: 'grossWeight', label: 'Gross Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'tareWeight', label: 'Tare Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'sizeMic', label: 'Size & Mic' },
]

export default function RawMaterial({ data, setData }) {
    const [form, setForm] = useState({
        date: '',
        quantityReceived: '',
        quantityUnit: 'kg',
        grossWeight: '',
        tareWeight: '',
        sizeMic: '',
    })

    const netWeight = Math.max(0, (parseFloat(form.grossWeight) || 0) - (parseFloat(form.tareWeight) || 0))

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    }

    const handleSubmit = (e) => {
        e.preventDefault()
        if (!form.date || !form.grossWeight || !form.tareWeight) return

        const qty = parseFloat(form.quantityReceived) || 0
        const unit = form.quantityUnit
        // Convert to kg for calculations
        const qtyInKg = unit === 'tons' ? qty * 1000 : unit === 'grams' ? qty / 1000 : qty

        const entry = {
            id: Date.now(),
            sno: data.length + 1,
            date: form.date,
            quantityReceived: qty,
            quantityUnit: unit,
            quantityInKg: qtyInKg,
            quantityDisplay: `${qty} ${unit}`,
            grossWeight: parseFloat(form.grossWeight),
            tareWeight: parseFloat(form.tareWeight),
            netWeight,
            sizeMic: form.sizeMic,
        }

        setData((prev) => [...prev, entry])
        setForm({ date: '', quantityReceived: '', quantityUnit: 'kg', grossWeight: '', tareWeight: '', sizeMic: '' })
    }

    const handleDelete = (id) => {
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
    const selectClass =
        'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold w-24 shrink-0 appearance-none cursor-pointer text-center'

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Raw Material</h2>
                <p className="text-sm text-text-secondary mt-1">Track incoming raw material entries</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/80 via-blue-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{totalEntries}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/80 via-blue-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Net Weight</p>
                    <p className="text-3xl font-semibold text-blue-400">{totalNetWeight.toFixed(2)}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{todayCount}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Net</p>
                    <p className="text-3xl font-semibold text-accent-gold">{todayNet.toFixed(2)}</p>
                </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
                <SectionBarChart data={chartData} title="Daily Raw Material Imported" color="#60a5fa" />
            )}

            {/* Form */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                    Add New Entry
                </h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                        <input
                            type="date"
                            name="date"
                            value={form.date}
                            onChange={handleChange}
                            className={inputClass}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity Received</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                inputMode="decimal"
                                name="quantityReceived"
                                value={form.quantityReceived}
                                onChange={handleChange}
                                placeholder="0.00"
                                className={`${inputClass} flex-1`}
                                required
                            />
                            <select
                                name="quantityUnit"
                                value={form.quantityUnit}
                                onChange={handleChange}
                                className={selectClass}
                            >
                                <option value="kg">kg</option>
                                <option value="tons">tons</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross Weight</label>
                        <input
                            type="number"
                            name="grossWeight"
                            value={form.grossWeight}
                            onChange={handleChange}
                            step="0.01"
                            placeholder="0.00"
                            className={inputClass}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Tare Weight</label>
                        <input
                            type="number"
                            name="tareWeight"
                            value={form.tareWeight}
                            onChange={handleChange}
                            step="0.01"
                            placeholder="0.00"
                            className={inputClass}
                            required
                        />
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
                        <input
                            type="text"
                            name="sizeMic"
                            value={form.sizeMic}
                            onChange={handleChange}
                            placeholder="e.g. 12mm / 3.5 mic"
                            className={inputClass}
                        />
                    </div>

                    <div className="flex items-end">
                        <button
                            type="submit"
                            className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98]"
                        >
                            Add Entry
                        </button>
                    </div>
                </form>
            </div>

            {/* Table */}
            <DataTable columns={columns} data={data} emptyMessage="No raw material entries yet. Add one above." onDelete={handleDelete} />
        </div>
    )
}
