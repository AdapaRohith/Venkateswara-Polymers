import { useState, useEffect } from 'react'
import { useToast } from '../components/Toast'
import InputWithCamera from '../components/InputWithCamera'
import { createOrder, logRoll, fetchOrdersSummary } from '../utils/api'

export default function DataEntry() {
    const toast = useToast()

    // ── Create Order state ──
    const [orderForm, setOrderForm] = useState({ order_number: '', client_name: '' })
    const [orderLoading, setOrderLoading] = useState(false)

    // ── Log Roll state ──
    const [rollForm, setRollForm] = useState({
        order_number: '',
        material: 'trading',
        gross_weight: '',
        net_weight: '',
    })
    const [rollLoading, setRollLoading] = useState(false)
    const [orders, setOrders] = useState([])

    // Fetch existing orders for dropdown
    useEffect(() => {
        fetchOrdersSummary()
            .then((data) => setOrders(data))
            .catch(() => { })
    }, [])

    const refreshOrders = () => {
        fetchOrdersSummary()
            .then((data) => setOrders(data))
            .catch(() => { })
    }

    // ── Create Order handler ──
    const handleCreateOrder = async (e) => {
        e.preventDefault()
        if (!orderForm.order_number.trim() || !orderForm.client_name.trim()) return
        setOrderLoading(true)
        try {
            await createOrder(orderForm)
            toast.success(`Order "${orderForm.order_number}" created successfully`)
            setOrderForm({ order_number: '', client_name: '' })
            refreshOrders()
        } catch (err) {
            toast.error(err.message)
        } finally {
            setOrderLoading(false)
        }
    }

    // ── Log Roll handler ──
    const handleLogRoll = async (e) => {
        e.preventDefault()
        const gross = parseFloat(rollForm.gross_weight)
        const net = parseFloat(rollForm.net_weight)

        if (!rollForm.order_number) {
            toast.error('Please select an order')
            return
        }
        if (isNaN(gross) || isNaN(net)) {
            toast.error('Please enter valid weights')
            return
        }
        if (gross < net) {
            toast.error('Gross weight must be ≥ Net weight')
            return
        }

        setRollLoading(true)
        try {
            await logRoll({
                order_number: rollForm.order_number,
                material: rollForm.material,
                gross_weight: gross,
                net_weight: net,
            })
            toast.success('Roll logged successfully')
            setRollForm((prev) => ({ ...prev, gross_weight: '', net_weight: '' }))
        } catch (err) {
            toast.error(err.message)
        } finally {
            setRollLoading(false)
        }
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Data Entry</h2>
                <p className="text-sm text-text-secondary mt-1">Create orders and log production rolls</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* ── Create Order Form ── */}
                <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                        Create New Order
                    </h3>
                    <form onSubmit={handleCreateOrder} className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order Number</label>
                            <InputWithCamera
                                type="text"
                                value={orderForm.order_number}
                                onChange={(e) => setOrderForm((p) => ({ ...p, order_number: e.target.value }))}
                                placeholder="e.g. ORD001"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Client Name</label>
                            <InputWithCamera
                                type="text"
                                value={orderForm.client_name}
                                onChange={(e) => setOrderForm((p) => ({ ...p, client_name: e.target.value }))}
                                placeholder="e.g. ABC Plastics"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={orderLoading}
                            className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
                        >
                            {orderLoading ? 'Creating...' : 'Create Order'}
                        </button>
                    </form>
                </div>

                {/* ── Log Roll Form ── */}
                <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                        Log Production Roll
                    </h3>
                    <form onSubmit={handleLogRoll} className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order Number</label>
                            <select
                                value={rollForm.order_number}
                                onChange={(e) => setRollForm((p) => ({ ...p, order_number: e.target.value }))}
                                className={`${inputClass} appearance-none cursor-pointer`}
                                required
                            >
                                <option value="">Select an order...</option>
                                {orders.map((o) => (
                                    <option key={o.order_number} value={o.order_number}>
                                        {o.order_number}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Material</label>
                            <select
                                value={rollForm.material}
                                onChange={(e) => setRollForm((p) => ({ ...p, material: e.target.value }))}
                                className={`${inputClass} appearance-none cursor-pointer`}
                            >
                                <option value="trading">Trading</option>
                                <option value="manufactured">Manufactured</option>
                                <option value="waste">Waste</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross Weight</label>
                                <InputWithCamera
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={rollForm.gross_weight}
                                    onChange={(e) => setRollForm((p) => ({ ...p, gross_weight: e.target.value }))}
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net Weight</label>
                                <InputWithCamera
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={rollForm.net_weight}
                                    onChange={(e) => setRollForm((p) => ({ ...p, net_weight: e.target.value }))}
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                        </div>

                        {/* Auto preview */}
                        {rollForm.gross_weight && rollForm.net_weight && (
                            <div className="bg-bg-input border border-border-default rounded-lg px-4 py-2.5 text-sm">
                                <span className="text-text-secondary">Actual Weight: </span>
                                <span className="text-accent-gold font-semibold">
                                    {Math.max(0, parseFloat(rollForm.gross_weight) - parseFloat(rollForm.net_weight)).toFixed(2)}
                                </span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={rollLoading}
                            className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
                        >
                            {rollLoading ? 'Logging...' : 'Log Roll'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    )
}
