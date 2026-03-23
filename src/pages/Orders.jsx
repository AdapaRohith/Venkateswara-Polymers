import { useState, useEffect } from 'react'
import DataTable from '../components/DataTable'
import { useToast } from '../components/Toast'
import api from '../utils/api'

export default function Orders() {
    const toast = useToast()
    const [orders, setOrders] = useState([])
    const [loading, setLoading] = useState(true)
    const [form, setForm] = useState({ order_number: '', client_name: '', status: 'Active' })
    const [submitting, setSubmitting] = useState(false)
    const [updatingId, setUpdatingId] = useState(null)

    useEffect(() => {
        fetchOrders()
    }, [])

    const fetchOrders = async () => {
        try {
            const { data } = await api.get('/orders')
            setOrders(data)
        } catch (error) {
            toast.error('Failed to load orders')
        } finally {
            setLoading(false)
        }
    }

    const handleChange = (e) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!form.order_number.trim() || !form.client_name.trim()) {
            toast.error('Order number and client name are required')
            return
        }

        setSubmitting(true)
        try {
            const { data } = await api.post('/orders', form)
            setOrders(prev => [data, ...prev])
            toast.success('Order created')
            setForm({ order_number: '', client_name: '', status: 'Active' })
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to create order')
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        try {
            await api.delete(`/orders/${id}`)
            setOrders(prev => prev.filter(o => o.id !== id))
            toast.success('Order deleted')
        } catch (error) {
            toast.error('Failed to delete order')
        }
    }

    const handleStatusChange = async (id, newStatus) => {
        setUpdatingId(id)
        try {
            const { data } = await api.put(`/orders/${id}/status`, { status: newStatus })
            setOrders(prev => prev.map(o => o.id === id ? data : o))
            toast.success(`Order status updated to ${newStatus}`)
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to update order status')
        } finally {
            setUpdatingId(null)
        }
    }

    const columns = [
        { key: 'order_number', label: 'Order Number' },
        { key: 'client_name', label: 'Client Name' },
        { 
            key: 'status', 
            label: 'Status', 
            render: (v) => {
                const statusMap = {
                    active: 'bg-amber-500/15 text-amber-400',
                    completed: 'bg-emerald-500/15 text-emerald-400',
                    cancelled: 'bg-red-500/15 text-red-400',
                }
                const cls = statusMap[(v || '').toLowerCase()] || 'bg-gray-500/15 text-gray-400'
                return <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>{v}</span>
            }
        },
        {
            key: 'actions',
            label: 'Actions',
            render: (_, row) => (
                <div className="flex items-center gap-1">
                    <div className="relative group">
                        <button
                            disabled={updatingId === row.id}
                            className="text-text-secondary/60 hover:text-accent-gold transition-colors disabled:opacity-50"
                            title="Change status"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-3H6" />
                            </svg>
                        </button>
                        <div className="absolute right-0 mt-1 w-32 bg-bg-card border border-border-default rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                            <button
                                onClick={() => handleStatusChange(row.id, 'Active')}
                                disabled={updatingId === row.id}
                                className="block w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-white/[0.05] disabled:opacity-50 transition-colors"
                            >
                                Active
                            </button>
                            <button
                                onClick={() => handleStatusChange(row.id, 'completed')}
                                disabled={updatingId === row.id}
                                className="block w-full text-left px-3 py-2 text-xs text-emerald-400 hover:bg-white/[0.05] disabled:opacity-50 transition-colors border-t border-border-default"
                            >
                                Completed
                            </button>
                            <button
                                onClick={() => handleStatusChange(row.id, 'cancelled')}
                                disabled={updatingId === row.id}
                                className="block w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-white/[0.05] disabled:opacity-50 transition-colors border-t border-border-default"
                            >
                                Cancelled
                            </button>
                        </div>
                    </div>
                </div>
            )
        }
    ]

    const inputClass = "w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2 text-sm transition-colors focus:border-accent-gold"

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary">Order Management</h2>
                <p className="text-sm text-text-secondary mt-1">Manage client orders</p>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 uppercase mb-4">Add New Order</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Order Number</label>
                        <input type="text" name="order_number" value={form.order_number} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Client Name</label>
                        <input type="text" name="client_name" value={form.client_name} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Status</label>
                        <select name="status" value={form.status} onChange={handleChange} className={inputClass}>
                            <option value="Active">Active</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </div>
                    <button type="submit" disabled={submitting} className="bg-accent-gold text-black font-semibold py-2 px-4 rounded-lg h-[42px] hover:bg-accent-gold-hover transition-colors">
                        {submitting ? 'Adding...' : 'Add Order'}
                    </button>
                </form>
            </div>

            {loading ? (
                <div className="text-center py-8 text-text-secondary">Loading orders...</div>
            ) : (
                <DataTable columns={columns} data={orders} onDelete={handleDelete} emptyMessage="No orders found." />
            )}
        </div>
    )
}
