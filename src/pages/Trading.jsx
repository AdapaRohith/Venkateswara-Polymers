import { useState, useEffect, useMemo } from 'react'
import DataTable from '../components/DataTable'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import { logRoll, fetchOrdersSummary, createOrder, deleteRoll } from '../utils/api'

const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'order_number', label: 'Order' },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    { key: 'rate', label: 'Rate (₹/unit)', render: (v) => `₹${Number(v).toFixed(2)}` },
    { key: 'totalValue', label: 'Total Value (₹)', render: (v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    {
        key: 'type', label: 'Type', render: (v) => (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${v === 'Buy' ? 'bg-accent-gold/15 text-accent-gold' : 'bg-emerald-500/15 text-emerald-400'}`}>
                {v}
            </span>
        )
    },
]

export default function Trading({ data, setData }) {
    const toast = useToast()
    const [orders, setOrders] = useState([])
    const [form, setForm] = useState({
        date: '',
        order_number: '',
        newOrder: '',
        newClient: '',
        netWeight: '',
        rate: '',
        sizeMic: '',
        type: 'Buy',
    })
    const [submitting, setSubmitting] = useState(false)
    const [showNewOrder, setShowNewOrder] = useState(false)

    useEffect(() => {
        fetchOrdersSummary().then(setOrders).catch(() => { })
    }, [])

    const totalValue = (parseFloat(form.netWeight) || 0) * (parseFloat(form.rate) || 0)

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

        if (!orderNum || !form.date || !form.netWeight || !form.rate) {
            toast.error('Please fill all required fields')
            return
        }

        const net = parseFloat(form.netWeight)
        const rate = parseFloat(form.rate)

        setSubmitting(true)
        try {
            const result = await logRoll({
                order_number: orderNum,
                material: 'trading',
                gross_weight: net,
                net_weight: 0,
            })

            const entry = {
                id: result?.id || Date.now(),
                sno: data.length + 1,
                date: form.date,
                order_number: orderNum,
                netWeight: net,
                rate: rate,
                totalValue: net * rate,
                sizeMic: form.sizeMic,
                type: form.type,
            }
            setData((prev) => [...prev, entry])
            toast.success('Trading entry logged to backend')
            setForm((prev) => ({ ...prev, netWeight: '', rate: '', sizeMic: '', newOrder: '', newClient: '' }))
            setShowNewOrder(false)
        } catch (err) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    const handleDelete = async (id) => {
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

    const totalBuyValue = data.filter(d => d.type === 'Buy').reduce((s, i) => s + i.totalValue, 0)
    const totalSellValue = data.filter(d => d.type === 'Sell').reduce((s, i) => s + i.totalValue, 0)
    const todayCount = todayEntries.length
    const todayValue = todayEntries.reduce((s, i) => s + i.totalValue, 0)

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

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Trading</h2>
                <p className="text-sm text-text-secondary mt-1">Track stock bought and sold — synced to backend</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{data.length}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Bought (₹)</p>
                    <p className="text-3xl font-semibold text-accent-gold">₹{totalBuyValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Sold (₹)</p>
                    <p className="text-3xl font-semibold text-emerald-400">₹{totalSellValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500/80 via-violet-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{todayCount}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">₹{todayValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })} total</p>
                </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
                <SectionBarChart data={chartData} title="Daily Trading Volume" color="#34d399" />
            )}

            {/* Form */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">Add Trading Entry</h3>
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
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Type</label>
                        <select name="type" value={form.type} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`}>
                            <option value="Buy">Buy (from supplier)</option>
                            <option value="Sell">Sell (to customer)</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net Weight</label>
                        <input type="number" name="netWeight" value={form.netWeight} onChange={handleChange} step="0.01" placeholder="0.00" className={inputClass} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Rate (₹ per unit)</label>
                        <input type="number" name="rate" value={form.rate} onChange={handleChange} step="0.01" placeholder="0.00" className={inputClass} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                            Total Value <span className="text-accent-gold/70">(auto)</span>
                        </label>
                        <div className="w-full bg-bg-input text-accent-gold border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-semibold">
                            ₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Size & Mic</label>
                        <input type="text" name="sizeMic" value={form.sizeMic} onChange={handleChange} placeholder="e.g. 10mm / 2.8 mic" className={inputClass} />
                    </div>

                    <div className="flex items-end">
                        <button type="submit" disabled={submitting} className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50">
                            {submitting ? 'Logging...' : 'Add Entry'}
                        </button>
                    </div>
                </form>
            </div>

            <DataTable columns={columns} data={data} emptyMessage="No trading entries yet." onDelete={handleDelete} />
        </div>
    )
}
