import { useEffect, useState, useCallback } from 'react'
import { useToast } from '../components/Toast'
import api from '../utils/api'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Create PO Panel ─────────────────────────────────────────────────────────
function CreatePOPanel({ onCreated }) {
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ po_number: '', client_name: '' })
  const [items, setItems] = useState([{ item_name: '', required_quantity: '' }])

  const addItem = () => setItems(prev => [...prev, { item_name: '', required_quantity: '' }])
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))
  const updateItem = (i, field, val) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.po_number.trim()) return toast.error('PO Number is required')
    if (!form.client_name.trim()) return toast.error('Client Name is required')

    const validItems = items.filter(it => it.item_name.trim() && Number(it.required_quantity) > 0)
    if (validItems.length === 0) return toast.error('Add at least one item with name and quantity > 0')

    setSubmitting(true)
    try {
      const res = await api.post('/orders', {
        order_number: form.po_number.trim(),
        client_name: form.client_name.trim(),
        status: 'Active',
      })
      // Store items under orders/:id — using existing orders system
      // Items stored in localStorage keyed by order_number since backend just has basic order fields
      const poData = {
        order_number: form.po_number.trim(),
        client_name: form.client_name.trim(),
        items: validItems.map(it => ({
          item_name: it.item_name.trim(),
          required_quantity: parseFloat(it.required_quantity),
          fulfilled_quantity: 0,
        })),
        created_at: new Date().toISOString(),
      }
      // Persist PO items in localStorage (since backend orders table is simple)
      const existing = JSON.parse(localStorage.getItem('vp_po_items') || '{}')
      existing[poData.order_number] = poData
      localStorage.setItem('vp_po_items', JSON.stringify(existing))

      toast.success(`PO ${form.po_number} created`)
      setForm({ po_number: '', client_name: '' })
      setItems([{ item_name: '', required_quantity: '' }])
      onCreated?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create PO')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-6">
      <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-6">Create New PO</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">PO Number</label>
            <input
              type="text"
              value={form.po_number}
              onChange={e => setForm(p => ({ ...p, po_number: e.target.value }))}
              required
              placeholder="e.g. PO-2026-001"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Client Name</label>
            <input
              type="text"
              value={form.client_name}
              onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
              required
              placeholder="Client / Customer name"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary/70">Items</label>
            <button type="button" onClick={addItem} className="text-xs text-accent-gold hover:underline font-semibold">+ Add Item</button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={it.item_name}
                  onChange={e => updateItem(i, 'item_name', e.target.value)}
                  placeholder="Item name"
                  className="flex-1 bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2 text-sm focus:border-accent-gold transition-all"
                />
                <input
                  type="number"
                  value={it.required_quantity}
                  onChange={e => updateItem(i, 'required_quantity', e.target.value)}
                  placeholder="Qty (kg)"
                  min="0.001"
                  step="0.001"
                  className="w-28 bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2 text-sm font-mono focus:border-accent-gold transition-all"
                />
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-300 p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
        >
          {submitting ? 'Creating...' : 'Create Production Order'}
        </button>
      </form>
    </div>
  )
}

// ─── PO Card ─────────────────────────────────────────────────────────────────
function POCard({ po, order }) {
  const items = po?.items || []
  const totalRequired = items.reduce((s, it) => s + (it.required_quantity || 0), 0)
  const totalFulfilled = items.reduce((s, it) => s + (it.fulfilled_quantity || 0), 0)
  const pct = totalRequired > 0 ? Math.min(100, (totalFulfilled / totalRequired) * 100) : 0

  return (
    <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-text-primary">{po.order_number}</p>
            <p className="text-xs text-text-secondary mt-0.5">{po.client_name}</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
            order?.status === 'completed'
              ? 'text-green-400 bg-green-500/10 border-green-500/20'
              : 'text-accent-gold bg-accent-gold/10 border-accent-gold/20'
          }`}>
            {order?.status || 'Active'}
          </span>
        </div>
        {/* Progress */}
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-text-secondary/60 mb-1.5">
            <span>Fulfillment</span>
            <span>{pct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-bg-primary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-gold rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-text-secondary/50 mt-1">
            <span>{totalFulfilled.toFixed(2)} kg fulfilled</span>
            <span>{totalRequired.toFixed(2)} kg total</span>
          </div>
        </div>
      </div>
      {/* Items */}
      <div className="divide-y divide-border-subtle">
        {items.map((it, i) => {
          const remain = Math.max(0, (it.required_quantity || 0) - (it.fulfilled_quantity || 0))
          return (
            <div key={i} className="px-5 py-3 flex items-center justify-between gap-4">
              <span className="text-sm text-text-primary/90 font-medium truncate">{it.item_name}</span>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                <span className="text-text-secondary">Req: <span className="font-mono font-semibold text-text-primary">{it.required_quantity?.toFixed(2)}</span></span>
                <span className="text-green-400">Done: <span className="font-mono font-semibold">{it.fulfilled_quantity?.toFixed(2)}</span></span>
                <span className={remain > 0 ? 'text-orange-400' : 'text-green-400'}>
                  Rem: <span className="font-mono font-semibold">{remain.toFixed(2)}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-5 py-2.5 text-[10px] text-text-secondary/40">
        Created {formatDate(po.created_at)}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProductionOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [poItems, setPoItems] = useState({})
  const [refreshKey, setRefreshKey] = useState(0)

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/orders')
      setOrders(Array.isArray(data) ? data : [])
    } catch {/* ignore */} finally {
      setLoading(false)
    }
  }, [])

  const loadPoItems = useCallback(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('vp_po_items') || '{}')
      setPoItems(stored)
    } catch {
      setPoItems({})
    }
  }, [])

  useEffect(() => {
    loadOrders()
    loadPoItems()
  }, [loadOrders, loadPoItems, refreshKey])

  const handleCreated = () => {
    setRefreshKey(k => k + 1)
  }

  // Merge orders with locally-stored PO items
  const enrichedPOs = orders
    .filter(o => poItems[o.order_number])
    .map(o => ({ order: o, po: poItems[o.order_number] }))

  const ordersWithoutItems = orders.filter(o => !poItems[o.order_number])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Production Orders</h1>
        <p className="text-sm text-text-secondary mt-1">Create and track customer POs with item-level fulfillment</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-1">
          <CreatePOPanel onCreated={handleCreated} />
        </div>

        <div className="xl:col-span-2 space-y-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Active Orders</h2>
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-40 bg-bg-card rounded-2xl border border-border-default animate-pulse" />
              ))}
            </div>
          ) : enrichedPOs.length === 0 && ordersWithoutItems.length === 0 ? (
            <div className="rounded-2xl border border-border-default bg-bg-card p-10 text-center">
              <p className="text-text-secondary text-sm">No orders yet. Create your first PO above.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {enrichedPOs.map(({ order, po }) => (
                <POCard key={order.order_number} po={po} order={order} />
              ))}
              {/* Orders without items (older orders) */}
              {ordersWithoutItems.map(o => (
                <div key={o.order_number} className="bg-bg-card rounded-2xl border border-border-default p-5 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-text-primary">{o.order_number}</p>
                    <p className="text-xs text-text-secondary">{o.client_name || '—'}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border text-accent-gold bg-accent-gold/10 border-accent-gold/20">
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
