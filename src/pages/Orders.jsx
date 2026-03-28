import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'

const ORDER_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'completed', label: 'Completed' },
]

const ORDER_STATUS_PRIORITY = {
  active: 0,
  cancelled: 1,
  completed: 2,
}

export default function Orders({ user, orders = [], loading = false, refreshOrders }) {
  const toast = useToast()
  const isWorker = user?.role === 'worker'
  const [form, setForm] = usePersistentState('vp_orders_form', { order_number: '', client_name: '' })
  const [statusFilter, setStatusFilter] = usePersistentState(
    `vp_orders_status_filter_${isWorker ? 'worker' : 'owner'}`,
    isWorker ? 'active' : 'all',
  )
  const [submitting, setSubmitting] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)

  const normalizedOrders = useMemo(
    () => orders.map((order) => ({
      ...order,
      normalizedStatus: String(order.status || 'Active').toLowerCase(),
    })),
    [orders],
  )

  const filteredOrders = useMemo(() => {
    return normalizedOrders
      .filter((order) => statusFilter === 'all' || order.normalizedStatus === statusFilter)
      .sort((left, right) => {
        const leftPriority = ORDER_STATUS_PRIORITY[left.normalizedStatus] ?? 99
        const rightPriority = ORDER_STATUS_PRIORITY[right.normalizedStatus] ?? 99
        if (leftPriority !== rightPriority) return leftPriority - rightPriority

        return String(left.order_number || '').localeCompare(String(right.order_number || ''))
      })
  }, [normalizedOrders, statusFilter])

  const orderCounts = useMemo(() => {
    return normalizedOrders.reduce((counts, order) => {
      counts.all += 1
      if (Object.prototype.hasOwnProperty.call(counts, order.normalizedStatus)) {
        counts[order.normalizedStatus] += 1
      }
      return counts
    }, {
      all: 0,
      active: 0,
      cancelled: 0,
      completed: 0,
    })
  }, [normalizedOrders])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
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
      render: (value) => {
        const statusMap = {
          active: 'bg-amber-500/15 text-amber-400',
          completed: 'bg-emerald-500/15 text-emerald-400',
          cancelled: 'bg-red-500/15 text-red-400',
        }
        const normalizedValue = String(value || '').toLowerCase()
        const cls = statusMap[normalizedValue] || 'bg-gray-500/15 text-gray-400'
        return <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>{value}</span>
      },
    },
    !isWorker && {
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
    },
  ].filter(Boolean)

  const inputClass = 'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2 text-sm transition-colors focus:border-accent-gold'
  const filterButtonClass = (filterValue) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
      statusFilter === filterValue
        ? 'bg-accent-gold text-black'
        : 'bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent-gold/40 border border-border-default'
    }`

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">{isWorker ? 'Current Orders' : 'Order Management'}</h2>
      </div>

      {!isWorker && (
        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-5">
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
        </div>
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-secondary/70 uppercase">{isWorker ? 'What To Show' : 'View Orders'}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={filterButtonClass(filter.value)}
              >
                {filter.label} ({orderCounts[filter.value] ?? 0})
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-secondary">Loading orders...</div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredOrders}
          onDelete={isWorker ? undefined : handleDelete}
          emptyMessage={`No ${statusFilter === 'all' ? '' : `${statusFilter} `}orders found.`}
        />
      )}
    </div>
  )
}
