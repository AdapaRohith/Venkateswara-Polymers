import { useState, useEffect } from 'react'
import DataTable from '../components/DataTable'
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

export default function Manufacturing({ data, setData }) {
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

    const handleSubmit = async (e) => {
        e.preventDefault()

        let orderNum = form.order_number
        if (showNewOrder) {
            if (!form.newOrder.trim() || !form.newClient.trim()) {
                toast.error('Please fill order number and client name')
                return
            }
            // Create new order first
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

        setSubmitting(true)
        try {
            const result = await logRoll({
                order_number: orderNum,
                material: 'manufactured',
                gross_weight: gross,
                net_weight: tare,
            })

            // Add to local state — store backend roll id
            const entry = {
                id: result?.id || Date.now(),
                sno: data.length + 1,
                date: form.date,
                order_number: orderNum,
                grossWeight: gross,
                tareWeight: tare,
                netWeight: gross - tare,
                sizeMic: form.sizeMic,
            }
            setData((prev) => [...prev, entry])
            toast.success('Manufacturing entry logged to backend')
            setForm({ date: '', order_number: orderNum, newOrder: '', newClient: '', grossWeight: '', tareWeight: '', sizeMic: '' })
            setShowNewOrder(false)
        } catch (err) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        try {
            await deleteRoll(id)
            toast.success('Entry deleted from backend')
        } catch (err) {
            toast.error(err.message)
        }
        setData((prev) => prev.filter((item) => item.id !== id).map((item, idx) => ({ ...item, sno: idx + 1 })))
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Manufacturing</h2>
                <p className="text-sm text-text-secondary mt-1">Log manufactured rolls — synced to backend</p>
            </div>

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
