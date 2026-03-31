import { useEffect, useState, useCallback } from 'react'
import { useToast } from '../components/Toast'
import api from '../utils/api'

export default function Fulfillment() {
  const toast = useToast()
  const [orders, setOrders] = useState([])
  const [poItems, setPoItems] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [form, setForm] = useState({
    order_number: '',
    item_index: '',
    supplied_quantity: '',
    note: '',
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/orders')
      const activeOrders = Array.isArray(data)
        ? data.filter(o => String(o.status || '').toLowerCase() !== 'completed' && String(o.status || '').toLowerCase() !== 'cancelled')
        : []
      setOrders(activeOrders)

      const stored = JSON.parse(localStorage.getItem('vp_po_items') || '{}')
      setPoItems(stored)
    } catch {/* ignore */} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData, refreshKey])

  const selectedPO = form.order_number ? poItems[form.order_number] : null
  const selectedItem = selectedPO && form.item_index !== '' ? selectedPO.items[parseInt(form.item_index)] : null
  const remaining = selectedItem
    ? Math.max(0, (selectedItem.required_quantity || 0) - (selectedItem.fulfilled_quantity || 0))
    : null

  const handleSubmit = async e => {
    e.preventDefault()
    const qty = parseFloat(form.supplied_quantity)
    if (!form.order_number) return toast.error('Select an order')
    if (form.item_index === '') return toast.error('Select an item')
    if (!qty || qty <= 0) return toast.error('Supplied quantity must be > 0')
    if (remaining !== null && qty > remaining) {
      return toast.error(`Cannot supply more than remaining quantity (${remaining.toFixed(2)} kg)`)
    }

    setSubmitting(true)
    try {
      // Update poItems in localStorage
      const stored = JSON.parse(localStorage.getItem('vp_po_items') || '{}')
      const idx = parseInt(form.item_index)
      if (stored[form.order_number]?.items?.[idx]) {
        stored[form.order_number].items[idx].fulfilled_quantity =
          (stored[form.order_number].items[idx].fulfilled_quantity || 0) + qty
        localStorage.setItem('vp_po_items', JSON.stringify(stored))
      }

      // Also update order status to 'Active' with fulfillment note (optional call)
      toast.success(`Fulfilled ${qty} kg for ${form.order_number}`)
      setForm(prev => ({ ...prev, supplied_quantity: '', note: '' }))
      setRefreshKey(k => k + 1)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to record fulfillment')
    } finally {
      setSubmitting(false)
    }
  }

  const ordersWithItems = orders.filter(o => poItems[o.order_number])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Order Fulfillment</h1>
        <p className="text-sm text-text-secondary mt-1">Record delivery progress against production orders</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Form */}
        <div className="xl:col-span-1">
          <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-6">Record Supply</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Order */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Production Order
                </label>
                <select
                  value={form.order_number}
                  onChange={e => setForm(prev => ({ ...prev, order_number: e.target.value, item_index: '' }))}
                  required
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                >
                  <option value="">Select order...</option>
                  {ordersWithItems.map(o => (
                    <option key={o.order_number} value={o.order_number}>
                      {o.order_number} — {o.client_name || 'Unknown'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Item */}
              {selectedPO && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                    Item
                  </label>
                  <select
                    value={form.item_index}
                    onChange={e => setForm(prev => ({ ...prev, item_index: e.target.value }))}
                    required
                    className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                  >
                    <option value="">Select item...</option>
                    {selectedPO.items.map((it, i) => {
                      const rem = Math.max(0, (it.required_quantity || 0) - (it.fulfilled_quantity || 0))
                      return (
                        <option key={i} value={i} disabled={rem === 0}>
                          {it.item_name} — {rem.toFixed(2)} kg remaining
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}

              {/* Remaining display */}
              {selectedItem && (
                <div className="rounded-xl bg-bg-primary border border-border-default p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">Required</span>
                    <span className="font-mono font-semibold">{selectedItem.required_quantity?.toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-green-400">Fulfilled</span>
                    <span className="font-mono font-semibold text-green-400">{selectedItem.fulfilled_quantity?.toFixed(2)} kg</span>
                  </div>
                  <div className="border-t border-border-subtle pt-2 flex justify-between text-xs">
                    <span className="text-orange-400 font-semibold">Remaining</span>
                    <span className="font-mono font-bold text-orange-400">{remaining?.toFixed(2)} kg</span>
                  </div>
                  {remaining !== null && (
                    <div className="h-1.5 bg-border-default rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full bg-accent-gold rounded-full"
                        style={{ width: `${selectedItem.required_quantity ? 100 - (remaining / selectedItem.required_quantity) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Supplied Quantity (kg)
                </label>
                <input
                  type="number"
                  value={form.supplied_quantity}
                  onChange={e => setForm(prev => ({ ...prev, supplied_quantity: e.target.value }))}
                  step="0.001"
                  min="0.001"
                  max={remaining || undefined}
                  required
                  placeholder="0.000"
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all"
                />
                {remaining !== null && parseFloat(form.supplied_quantity) > remaining && (
                  <p className="text-[11px] text-red-400 mt-1">Exceeds remaining quantity</p>
                )}
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={form.note}
                  onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Dispatch note..."
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !form.order_number || form.item_index === ''}
                className="w-full py-3 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
              >
                {submitting ? 'Recording...' : 'Record Fulfillment'}
              </button>
            </form>
          </div>
        </div>

        {/* Live PO summary */}
        <div className="xl:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-5">Live Status</h2>
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-bg-card rounded-2xl border border-border-default animate-pulse" />
              ))}
            </div>
          ) : ordersWithItems.length === 0 ? (
            <div className="rounded-2xl border border-border-default bg-bg-card p-10 text-center">
              <p className="text-text-secondary text-sm">No orders with items. Create a PO in the Production Orders page first.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {ordersWithItems.map(o => {
                const po = poItems[o.order_number]
                if (!po) return null
                const items = po.items || []
                const totalRequired = items.reduce((s, it) => s + (it.required_quantity || 0), 0)
                const totalFulfilled = items.reduce((s, it) => s + (it.fulfilled_quantity || 0), 0)
                const pct = totalRequired > 0 ? Math.min(100, (totalFulfilled / totalRequired) * 100) : 0

                return (
                  <div key={o.order_number} className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
                      <div>
                        <p className="font-bold text-text-primary">{o.order_number}</p>
                        <p className="text-xs text-text-secondary">{o.client_name}</p>
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
                        {items.map((it, i) => {
                          const rem = Math.max(0, (it.required_quantity || 0) - (it.fulfilled_quantity || 0))
                          return (
                            <div key={i} className="py-2.5 flex items-center justify-between text-xs">
                              <span className="text-text-primary/80 font-medium">{it.item_name}</span>
                              <div className="flex gap-4 items-center">
                                <span className="text-text-secondary font-mono">{it.required_quantity?.toFixed(2)} kg</span>
                                <span className="text-green-400 font-mono">{it.fulfilled_quantity?.toFixed(2)} done</span>
                                <span className={`font-mono font-bold ${rem > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                                  {rem > 0 ? `${rem.toFixed(2)} rem` : '✓ Complete'}
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
