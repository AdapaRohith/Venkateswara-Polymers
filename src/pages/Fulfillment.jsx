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
      setOrders(Array.isArray(data) ? data : [])
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

  // An order counts as "completed" if status flag is set OR every item is fully fulfilled
  const isOrderComplete = (order) => {
    const status = String(order.status || '').toLowerCase()
    if (status === 'completed' || status === 'cancelled') return true
    const items = Array.isArray(order.items) ? order.items : []
    if (items.length === 0) return false
    return items.every((item) => toNumber(item.fulfilled_quantity) >= toNumber(item.required_quantity) && toNumber(item.required_quantity) > 0)
  }

  const activeOrders = orders.filter((o) => !isOrderComplete(o))
  const completedOrders = orders.filter((o) => isOrderComplete(o))

  const selectedPO = form.order_number ? activeOrders.find((order) => order.order_number === form.order_number) : null
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

  const ordersWithItems = activeOrders.filter((order) => Array.isArray(order.items) && order.items.length > 0)
  const completedWithItems = completedOrders.filter((order) => Array.isArray(order.items) && order.items.length > 0)

  const FulfillmentTableRows = ({ list }) => (
    <>
      {list.map((order) => {
        const items = Array.isArray(order.items) ? order.items : []
        const rowSpan = items.length || 1

        if (items.length === 0) {
          return (
            <tr key={order.id || order.order_number} className="border-b border-white/[0.08] hover:bg-white/[0.04] transition-colors">
              <td className="px-4 py-3 font-bold text-text-primary whitespace-nowrap">{order.order_number}</td>
              <td className="px-4 py-3 text-text-secondary/80">{order.client_name}</td>
              <td className="px-4 py-3 text-text-secondary/50 italic" colSpan={5}>No line items</td>
            </tr>
          )
        }

        return items.map((item, idx) => {
          const itemRemaining = Math.max(0, toNumber(item.required_quantity) - toNumber(item.fulfilled_quantity))
          const itemPct = toNumber(item.required_quantity) > 0
            ? Math.min(100, (toNumber(item.fulfilled_quantity) / toNumber(item.required_quantity)) * 100)
            : 0

          return (
            <tr
              key={item.id ?? `${order.id}-${idx}`}
              className={`border-b border-white/[0.08] hover:bg-white/[0.04] transition-colors ${idx === 0 ? '' : 'bg-white/[0.015]'}`}
            >
              {idx === 0 && (
                <>
                  <td className="px-4 py-3 font-bold text-text-primary whitespace-nowrap" rowSpan={rowSpan}>{order.order_number}</td>
                  <td className="px-4 py-3 text-text-secondary/80 whitespace-nowrap" rowSpan={rowSpan}>{order.client_name}</td>
                </>
              )}
              <td className="px-4 py-3 text-text-primary/90 font-medium">{item.item_name}</td>
              <td className="px-4 py-3 text-right font-mono text-text-secondary/80">{toNumber(item.required_quantity).toFixed(2)}</td>
              <td className="px-4 py-3 text-right font-mono text-green-400 font-semibold">{toNumber(item.fulfilled_quantity).toFixed(2)}</td>
              <td className={`px-4 py-3 text-right font-mono font-semibold ${itemRemaining > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                {itemRemaining > 0 ? itemRemaining.toFixed(2) : '✓ Done'}
              </td>
              <td className="px-4 py-3 text-center font-mono font-bold text-accent-gold">{itemPct.toFixed(0)}%</td>
            </tr>
          )
        })
      })}
    </>
  )

  const FulfillmentTable = ({ list }) => (
    <div className="overflow-x-auto rounded-2xl border border-white/20 bg-bg-input/15">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-white/20 bg-bg-primary/50">
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">PO Number</th>
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Client</th>
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Item</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Required (kg)</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Fulfilled (kg)</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Remaining (kg)</th>
            <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-text-secondary/70">Done</th>
          </tr>
        </thead>
        <tbody>
          <FulfillmentTableRows list={list} />
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Order Fulfillment</h1>
        <p className="text-sm text-text-secondary mt-1">Record delivery progress against production orders</p>
      </div>

      {/* Record Supply Form */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-6">Record Supply</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
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

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
              Item
            </label>
            <select
              value={form.item_id}
              onChange={(e) => setForm((prev) => ({ ...prev, item_id: e.target.value }))}
              required
              disabled={!selectedPO}
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all disabled:opacity-50"
            >
              <option value="">{selectedPO ? 'Select item...' : 'Select order first'}</option>
              {(selectedPO?.items || []).map((item) => {
                const itemRemaining = Math.max(0, toNumber(item.required_quantity) - toNumber(item.fulfilled_quantity))
                return (
                  <option key={item.id} value={item.id} disabled={itemRemaining === 0}>
                    {item.item_name} — {itemRemaining.toFixed(2)} kg rem.
                  </option>
                )
              })}
            </select>
            {selectedItem && (
              <p className="text-[11px] mt-1.5 text-text-secondary/60 font-mono">
                <span className="text-green-400">{toNumber(selectedItem.fulfilled_quantity).toFixed(2)} done</span>
                {' · '}
                <span className="text-orange-400">{remaining?.toFixed(2)} remaining</span>
                {' · '}
                {toNumber(selectedItem.required_quantity).toFixed(2)} total
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
              Supplied Qty (kg)
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
              <p className="text-[11px] text-red-400 mt-1">Exceeds remaining</p>
            )}
          </div>

          <div className="flex flex-col">
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
            <button
              type="submit"
              disabled={submitting || !form.order_number || !form.item_id}
              className="mt-auto pt-3 w-full py-2.5 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
            >
              {submitting ? 'Recording...' : 'Record Fulfillment'}
            </button>
          </div>
        </form>
      </div>

      {/* Active Orders */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Active Orders</h2>
          {!loading && ordersWithItems.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-gold/10 text-accent-gold border border-accent-gold/20">
              {ordersWithItems.length}
            </span>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-12 bg-bg-card rounded-2xl border border-border-default animate-pulse" />
            ))}
          </div>
        ) : ordersWithItems.length === 0 && completedWithItems.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-bg-card p-10 text-center">
            <p className="text-text-secondary text-sm">No orders with items. Create a PO in the Production Orders page first.</p>
          </div>
        ) : ordersWithItems.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-bg-card px-6 py-5 text-sm text-text-secondary/50 italic">
            All orders are fully fulfilled.
          </div>
        ) : (
          <FulfillmentTable list={ordersWithItems} />
        )}
      </div>

      {/* Completed Orders — only shown when at least one exists */}
      {!loading && completedWithItems.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-green-500/60">Completed Orders</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
              {completedWithItems.length}
            </span>
          </div>
          <FulfillmentTable list={completedWithItems} />
        </div>
      )}
    </div>
  )
}
