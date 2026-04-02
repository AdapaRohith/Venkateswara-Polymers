import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { getOrders, recordFulfillment } from '../utils/orders'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export default function Fulfillment() {
  const toast = useToast()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [form, setForm] = useState({
    order_number: '',
    item_id: '',
    supplied_quantity: '',
    note: '',
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getOrders({ includeItems: true })
      const activeOrders = data.filter(
        (order) => String(order.status || '').toLowerCase() !== 'completed' && String(order.status || '').toLowerCase() !== 'cancelled',
      )
      setOrders(activeOrders)
    } catch {
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()

    const pollInterval = setInterval(loadData, 50000)
    return () => clearInterval(pollInterval)
  }, [loadData, refreshKey])

  const selectedPO = form.order_number ? orders.find((order) => order.order_number === form.order_number) : null
  const selectedItem = selectedPO && form.item_id
    ? (selectedPO.items || []).find((item) => String(item.id) === String(form.item_id))
    : null
  const remaining = selectedItem
    ? Math.max(0, toNumber(selectedItem.required_quantity) - toNumber(selectedItem.fulfilled_quantity))
    : null

  const handleSubmit = async (event) => {
    event.preventDefault()

    const quantity = toNumber(form.supplied_quantity)
    if (!form.order_number) return toast.error('Select an order')
    if (!form.item_id) return toast.error('Select an item')
    if (quantity <= 0) return toast.error('Supplied quantity must be > 0')
    if (remaining !== null && quantity > remaining) {
      return toast.error(`Cannot supply more than remaining quantity (${remaining.toFixed(2)} kg)`)
    }

    setSubmitting(true)
    try {
      await recordFulfillment({
        order_number: form.order_number,
        item_id: Number(form.item_id),
        supplied_quantity: quantity,
        note: form.note || null,
      })

      toast.success(`Fulfilled ${quantity} kg for ${form.order_number}`)
      setForm((prev) => ({ ...prev, supplied_quantity: '', note: '' }))
      setRefreshKey((prev) => prev + 1)
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to record fulfillment')
    } finally {
      setSubmitting(false)
    }
  }

  const ordersWithItems = orders.filter((order) => Array.isArray(order.items) && order.items.length > 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Order Fulfillment</h1>
        <p className="text-sm text-text-secondary mt-1">Record delivery progress against production orders</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-1">
          <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-6">Record Supply</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Production Order
                </label>
                <select
                  value={form.order_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, order_number: e.target.value, item_id: '' }))}
                  required
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                >
                  <option value="">Select order...</option>
                  {ordersWithItems.map((order) => (
                    <option key={order.id || order.order_number} value={order.order_number}>
                      {order.order_number} - {order.client_name || 'Unknown'}
                    </option>
                  ))}
                </select>
              </div>

              {selectedPO && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                    Item
                  </label>
                  <select
                    value={form.item_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, item_id: e.target.value }))}
                    required
                    className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                  >
                    <option value="">Select item...</option>
                    {(selectedPO.items || []).map((item) => {
                      const itemRemaining = Math.max(0, toNumber(item.required_quantity) - toNumber(item.fulfilled_quantity))
                      return (
                        <option key={item.id} value={item.id} disabled={itemRemaining === 0}>
                          {item.item_name} - {itemRemaining.toFixed(2)} kg remaining
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}

              {selectedItem && (
                <div className="rounded-xl bg-bg-primary border border-border-default p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">Required</span>
                    <span className="font-mono font-semibold">{toNumber(selectedItem.required_quantity).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-green-400">Fulfilled</span>
                    <span className="font-mono font-semibold text-green-400">{toNumber(selectedItem.fulfilled_quantity).toFixed(2)} kg</span>
                  </div>
                  <div className="border-t border-border-subtle pt-2 flex justify-between text-xs">
                    <span className="text-orange-400 font-semibold">Remaining</span>
                    <span className="font-mono font-bold text-orange-400">{remaining?.toFixed(2)} kg</span>
                  </div>
                  {remaining !== null && (
                    <div className="h-1.5 bg-border-default rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full bg-accent-gold rounded-full"
                        style={{ width: `${toNumber(selectedItem.required_quantity) ? 100 - (remaining / toNumber(selectedItem.required_quantity)) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Supplied Quantity (kg)
                </label>
                <input
                  type="number"
                  value={form.supplied_quantity}
                  onChange={(e) => setForm((prev) => ({ ...prev, supplied_quantity: e.target.value }))}
                  step="0.001"
                  min="0.001"
                  max={remaining || undefined}
                  required
                  placeholder="0.000"
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all"
                />
                {remaining !== null && toNumber(form.supplied_quantity) > remaining && (
                  <p className="text-[11px] text-red-400 mt-1">Exceeds remaining quantity</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="Dispatch note..."
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !form.order_number || !form.item_id}
                className="w-full py-3 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
              >
                {submitting ? 'Recording...' : 'Record Fulfillment'}
              </button>
            </form>
          </div>
        </div>

        <div className="xl:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-5">Live Status</h2>
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="h-24 bg-bg-card rounded-2xl border border-border-default animate-pulse" />
              ))}
            </div>
          ) : ordersWithItems.length === 0 ? (
            <div className="rounded-2xl border border-border-default bg-bg-card p-10 text-center">
              <p className="text-text-secondary text-sm">No orders with items. Create a PO in the Production Orders page first.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {ordersWithItems.map((order) => {
                const items = Array.isArray(order.items) ? order.items : []
                const totalRequired = items.reduce((sum, item) => sum + toNumber(item.required_quantity), 0)
                const totalFulfilled = items.reduce((sum, item) => sum + toNumber(item.fulfilled_quantity), 0)
                const pct = totalRequired > 0 ? Math.min(100, (totalFulfilled / totalRequired) * 100) : 0

                return (
                  <div key={order.id || order.order_number} className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
                      <div>
                        <p className="font-bold text-text-primary">{order.order_number}</p>
                        <p className="text-xs text-text-secondary">{order.client_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-accent-gold font-mono">{pct.toFixed(0)}%</p>
                        <p className="text-[10px] text-text-secondary/60">fulfilled</p>
                      </div>
                    </div>
                    <div className="px-5 py-3">
                      <div className="h-2 bg-bg-primary rounded-full overflow-hidden mb-3">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${pct >= 100 ? 'bg-green-400' : 'bg-accent-gold'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="divide-y divide-border-subtle">
                        {items.map((item) => {
                          const itemRemaining = Math.max(0, toNumber(item.required_quantity) - toNumber(item.fulfilled_quantity))
                          return (
                            <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                              <span className="text-text-primary/80 font-medium">{item.item_name}</span>
                              <div className="flex gap-4 items-center">
                                <span className="text-text-secondary font-mono">{toNumber(item.required_quantity).toFixed(2)} kg</span>
                                <span className="text-green-400 font-mono">{toNumber(item.fulfilled_quantity).toFixed(2)} done</span>
                                <span className={`font-mono font-bold ${itemRemaining > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                                  {itemRemaining > 0 ? `${itemRemaining.toFixed(2)} rem` : 'Complete'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
