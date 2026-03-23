import { useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import { useToast } from '../components/Toast'
import api from '../utils/api'

export default function Orders({ orders = [], refreshOrders }) {
    const toast = useToast()
    const [loading, setLoading] = useState(true)
    const [form, setForm] = useState({ order_number: '', client_name: '' })
    const [submitting, setSubmitting] = useState(false)
    const [updatingId, setUpdatingId] = useState(null)

    useEffect(() => {
        const loadOrders = async () => {
            try {
                await refreshOrders?.()
            } catch {
                toast.error('Failed to load orders')
            } finally {
                setLoading(false)
            }
        }

        loadOrders()
    }, [refreshOrders, toast])

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
            await api.post('/orders', form)
            await refreshOrders?.()
            toast.success('Order created')
            setForm({ order_number: '', client_name: '' })
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to create order')
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        try {
            await api.delete(`/orders/${id}`)
            await refreshOrders?.()
            toast.success('Order deleted')
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to delete order')
        }
    }

    const handleStatusChange = async (id, status) => {
        setUpdatingId(id)
        try {
            await api.put(`/orders/${id}/status`, { status })
            await refreshOrders?.()
            toast.success(`Order status updated to ${status}`)
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
            key: 'status_actions',
            label: 'Change Status',
            render: (_, row) => (
                <div className="flex flex-wrap gap-2">
                    {['Active', 'completed', 'cancelled'].map((status) => {
                        const isCurrent = row.status === status
                        return (
                            <button
                                key={status}
                                type="button"
                                onClick={() => handleStatusChange(row.id, status)}
                                disabled={updatingId === row.id || isCurrent}
                                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 ${
                                    status === 'Active'
                                        ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                                        : status === 'completed'
                                            ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                                            : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                                }`}
                            >
                                {status}
                            </button>
                        )
                    })}
                </div>
            ),
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
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Order Number</label>
                        <input type="text" name="order_number" value={form.order_number} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Client Name</label>
                        <input type="text" name="client_name" value={form.client_name} onChange={handleChange} className={inputClass} required />
                    </div>
                    <button type="submit" disabled={submitting} className="bg-accent-gold text-black font-semibold py-2 px-4 rounded-lg h-[42px] hover:bg-accent-gold-hover transition-colors">
                        {submitting ? 'Adding...' : 'Add Order'}
                    </button>
                </form>
                <p className="mt-4 text-[11px] text-text-secondary/50">
                    Orders can be created, listed, deleted, and updated to Active, completed, or cancelled.
                </p>
            </div>

            {loading ? (
                <div className="text-center py-8 text-text-secondary">Loading orders...</div>
            ) : (
                <DataTable columns={columns} data={orders} onDelete={handleDelete} emptyMessage="No orders found." />
            )}
        </div>
    )
}
