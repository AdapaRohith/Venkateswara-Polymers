import { useState } from 'react'
import DataTable from '../components/DataTable'

const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'grossWeight', label: 'Gross Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'tareWeight', label: 'Tare Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'sizeMic', label: 'Size & Mic' },
]

export default function RawMaterial({ data, setData }) {
    const [form, setForm] = useState({
        date: '',
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

        const entry = {
            id: Date.now(),
            sno: data.length + 1,
            date: form.date,
            grossWeight: parseFloat(form.grossWeight),
            tareWeight: parseFloat(form.tareWeight),
            netWeight,
            sizeMic: form.sizeMic,
        }

        setData((prev) => [...prev, entry])
        setForm({ date: '', grossWeight: '', tareWeight: '', sizeMic: '' })
    }

    const handleDelete = (id) => {
        setData((prev) => prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 })))
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Raw Material</h2>
                <p className="text-sm text-text-secondary mt-1">Track incoming raw material entries</p>
            </div>

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
                            className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold"
                            required
                        />
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
                            className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30"
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
                            className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30"
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
                            className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30"
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
