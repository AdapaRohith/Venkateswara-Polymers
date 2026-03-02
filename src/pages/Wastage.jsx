import { useState, useEffect, useMemo } from 'react'
import { WastageAreaChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import { logRoll, fetchOrdersSummary, createOrder, deleteRoll } from '../utils/api'

export default function Wastage({ rawMaterials, manufacturingData, tradingData }) {
    const toast = useToast()
    const [orders, setOrders] = useState([])
    const [form, setForm] = useState({
        order_number: '',
        newOrder: '',
        newClient: '',
        gross_weight: '',
        net_weight: '',
    })
    const [submitting, setSubmitting] = useState(false)
    const [showNewOrder, setShowNewOrder] = useState(false)
    const [wasteEntries, setWasteEntries] = useState([])

    useEffect(() => {
        fetchOrdersSummary().then(setOrders).catch(() => { })
    }, [])

    const totalRawNet = rawMaterials.reduce((s, i) => s + i.netWeight, 0)
    const totalMfgNet = manufacturingData.reduce((s, i) => s + i.netWeight, 0)
    const totalTradingNet = tradingData.reduce((s, i) => s + i.netWeight, 0)
    const totalWasteLogged = wasteEntries.reduce((s, i) => s + (i.gross_weight - i.net_weight), 0)
    const autoWastage = Math.max(0, totalRawNet - (totalMfgNet + totalTradingNet))

    const chartData = useMemo(() => [
        { name: 'Raw Material', value: totalRawNet },
        { name: 'Manufacturing', value: totalMfgNet },
        { name: 'Trading', value: totalTradingNet },
        { name: 'Wastage', value: autoWastage },
    ], [totalRawNet, totalMfgNet, totalTradingNet, autoWastage])

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

        setSubmitting(true)
        try {
            const result = await logRoll({ order_number: orderNum, material: 'waste', gross_weight: gross, net_weight: net })
            setWasteEntries(prev => [...prev, { id: result?.id, gross_weight: gross, net_weight: net }])
            toast.success('Waste entry logged to backend')
            setForm(p => ({ ...p, gross_weight: '', net_weight: '', newOrder: '', newClient: '' }))
            setShowNewOrder(false)
        } catch (err) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Wastage</h2>
                <p className="text-sm text-text-secondary mt-1">Auto-calculated wastage & log waste rolls to backend</p>
            </div>

            {/* Auto-calculated wastage card */}
            <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-8 overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Auto-Calculated Wastage</h3>
                </div>
                <p className="text-5xl font-bold text-text-primary mb-4">{autoWastage.toFixed(2)}</p>
                <div className="text-sm text-text-secondary space-y-1">
                    <p>Raw Material Net: <span className="text-text-primary font-medium">{totalRawNet.toFixed(2)}</span></p>
                    <p>Manufacturing Net: <span className="text-text-primary font-medium">{totalMfgNet.toFixed(2)}</span></p>
                    <p>Trading Net: <span className="text-text-primary font-medium">{totalTradingNet.toFixed(2)}</span></p>
                    <p className="text-accent-gold pt-2 font-medium">Wastage = Raw - (Manufacturing + Trading)</p>
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
        </div>
    )
}
