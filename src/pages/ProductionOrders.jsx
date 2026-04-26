import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { exportSingleSheet } from '../utils/exportToExcel'
import { createOrder, getOrders } from '../utils/orders'

const ExcelIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatCurrency(value) {
  return toNumber(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function CreatePOPanel({ onCreated }) {
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ po_number: '', client_name: '' })
  const [items, setItems] = useState([{ item_name: '', required_quantity: '', unit_price: '' }])

  const addItem = () => setItems((prev) => [...prev, { item_name: '', required_quantity: '', unit_price: '' }])
  const removeItem = (index) => setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  const updateItem = (index, field, value) =>
    setItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)))

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!form.po_number.trim()) return toast.error('PO Number is required')
    if (!form.client_name.trim()) return toast.error('Client Name is required')

    const validItems = items
      .map((item) => ({
        item_name: String(item.item_name || '').trim(),
        required_quantity: toNumber(item.required_quantity),
        unit_price: toNumber(item.unit_price),
      }))
      .filter((item) => item.item_name && item.required_quantity > 0 && item.unit_price >= 0)

    if (validItems.length === 0) {
      return toast.error('Add at least one item with name and quantity > 0')
    }

    setSubmitting(true)
    try {
      await createOrder({
        order_number: form.po_number.trim(),
        client_name: form.client_name.trim(),
        status: 'Active',
        items: validItems,
      })

      toast.success(`PO ${form.po_number.trim()} created`)
      setForm({ po_number: '', client_name: '' })
      setItems([{ item_name: '', required_quantity: '', unit_price: '' }])
      onCreated?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to create PO')
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
              onChange={(e) => setForm((prev) => ({ ...prev, po_number: e.target.value }))}
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
              onChange={(e) => setForm((prev) => ({ ...prev, client_name: e.target.value }))}
              required
              placeholder="Client / Customer name"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary/70">Items</label>
            <button type="button" onClick={addItem} className="text-xs text-accent-gold hover:underline font-semibold">+ Add Item</button>
          </div>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem_auto] sm:items-center">
                <input
                  type="text"
                  value={item.item_name}
                  onChange={(e) => updateItem(index, 'item_name', e.target.value)}
                  placeholder="Item name"
                  className="min-w-0 bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2 text-sm focus:border-accent-gold transition-all"
                />
                <input
                  type="number"
                  value={item.required_quantity}
                  onChange={(e) => updateItem(index, 'required_quantity', e.target.value)}
                  placeholder="Qty (kg)"
                  min="0.001"
                  step="0.001"
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2 text-sm font-mono focus:border-accent-gold transition-all"
                />
                <input
                  type="number"
                  value={item.unit_price}
                  onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                  placeholder="Price/kg"
                  min="0"
                  step="0.01"
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2 text-sm font-mono focus:border-accent-gold transition-all"
                />
                <div className="h-10 rounded-lg border border-border-subtle bg-bg-input/50 px-3 py-2 text-right font-mono text-sm text-text-secondary/80">
                  {formatCurrency(toNumber(item.required_quantity) * toNumber(item.unit_price))}
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="justify-self-start text-red-400 hover:text-red-300 p-2 rounded-lg hover:bg-red-500/10 transition-colors sm:justify-self-center"
                  >
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

function POTable({ orders }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/20 bg-bg-input/15">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-white/20 bg-bg-primary/50">
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">PO Number</th>
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Client</th>
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Item</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Required (kg)</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Unit Price</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Total</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Fulfilled (kg)</th>
            <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Remaining (kg)</th>
            <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Done</th>
            <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-text-secondary/70 border-r border-white/10">Status</th>
            <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-text-secondary/70">Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const items = Array.isArray(order?.items) ? order.items : []
            const rowSpan = items.length || 1

            if (items.length === 0) {
              return (
                <tr key={order.id || order.order_number} className="border-b border-white/[0.08] hover:bg-white/[0.04] transition-colors">
                  <td className="px-4 py-3 font-bold text-text-primary whitespace-nowrap">{order.order_number}</td>
                  <td className="px-4 py-3 text-text-secondary/80">{order.client_name}</td>
                  <td className="px-4 py-3 text-text-secondary/50 italic" colSpan={6}>No line items</td>
                  <td className="px-4 py-3 text-center font-mono font-bold text-text-secondary/40">—</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                      order?.status === 'completed'
                        ? 'text-green-400 bg-green-500/10 border-green-500/20'
                        : 'text-accent-gold bg-accent-gold/10 border-accent-gold/20'
                    }`}>{order?.status || 'Active'}</span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary/40 text-xs whitespace-nowrap">{formatDate(order.created_at)}</td>
                </tr>
              )
            }

            return items.map((item, idx) => {
              const remain = Math.max(0, toNumber(item.required_quantity) - toNumber(item.fulfilled_quantity))
              const lineTotal = toNumber(item.total_amount, toNumber(item.required_quantity) * toNumber(item.unit_price))
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
                  <td className="px-4 py-3 text-right font-mono text-text-secondary/80">{formatCurrency(item.unit_price)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-accent-gold">{formatCurrency(lineTotal)}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-400 font-semibold">{toNumber(item.fulfilled_quantity).toFixed(2)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-semibold ${remain > 0 ? 'text-orange-400' : 'text-green-400'}`}>{remain.toFixed(2)}</td>
                  <td className="px-4 py-3 text-center font-mono font-bold text-accent-gold">{itemPct.toFixed(0)}%</td>
                  {idx === 0 && (
                    <>
                      <td className="px-4 py-3 text-center" rowSpan={rowSpan}>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                          order?.status === 'completed'
                            ? 'text-green-400 bg-green-500/10 border-green-500/20'
                            : 'text-accent-gold bg-accent-gold/10 border-accent-gold/20'
                        }`}>{order?.status || 'Active'}</span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary/40 text-xs whitespace-nowrap" rowSpan={rowSpan}>{formatDate(order.created_at)}</td>
                    </>
                  )}
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ProductionOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadOrders = useCallback(async () => {
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
    loadOrders()
  }, [loadOrders, refreshKey])

  const handleCreated = () => {
    setRefreshKey((prev) => prev + 1)
  }

  const activeOrders = orders.filter(o => o.status !== 'completed')
  const completedOrders = orders.filter(o => o.status === 'completed')

  const exportPOColumns = [
    { key: 'po_number', label: 'PO Number' },
    { key: 'client', label: 'Client' },
    { key: 'item', label: 'Item' },
    { key: 'required_kg', label: 'Required (kg)' },
    { key: 'unit_price', label: 'Unit Price' },
    { key: 'total', label: 'Total' },
    { key: 'fulfilled_kg', label: 'Fulfilled (kg)' },
    { key: 'remaining_kg', label: 'Remaining (kg)' },
    { key: 'pct_done', label: '% Done' },
    { key: 'status', label: 'Status' },
    { key: 'created', label: 'Created' },
  ]

  const flattenPOs = (list) => {
    const rows = []
    for (const order of list) {
      const items = Array.isArray(order?.items) ? order.items : []
      if (items.length === 0) {
        rows.push({ po_number: order.order_number, client: order.client_name, item: '(No items)', required_kg: '', unit_price: '', total: '', fulfilled_kg: '', remaining_kg: '', pct_done: '', status: order?.status || 'Active', created: formatDate(order.created_at) })
      } else {
        for (const item of items) {
          const req = toNumber(item.required_quantity)
          const ful = toNumber(item.fulfilled_quantity)
          const rem = Math.max(0, req - ful)
          const lineTotal = toNumber(item.total_amount, req * toNumber(item.unit_price))
          const pct = req > 0 ? Math.min(100, (ful / req) * 100) : 0
          rows.push({ po_number: order.order_number, client: order.client_name, item: item.item_name, required_kg: req.toFixed(2), unit_price: formatCurrency(item.unit_price), total: formatCurrency(lineTotal), fulfilled_kg: ful.toFixed(2), remaining_kg: rem.toFixed(2), pct_done: `${pct.toFixed(0)}%`, status: order?.status || 'Active', created: formatDate(order.created_at) })
        }
      }
    }
    return rows
  }

  const handleExportPOs = (list, label) => {
    const rows = flattenPOs(list)
    if (rows.length === 0) return
    exportSingleSheet({ filename: `PO_${label}_${new Date().toISOString().slice(0, 10)}`, rows, columns: exportPOColumns, sheetName: label })
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Production Orders</h1>
        <p className="text-sm text-text-secondary mt-1">Create and track customer POs with item-level fulfillment</p>
      </div>

      <CreatePOPanel onCreated={handleCreated} />

      {/* Active Orders */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Active Orders</h2>
          {!loading && activeOrders.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-gold/10 text-accent-gold border border-accent-gold/20">
              {activeOrders.length}
            </span>
          )}
          {activeOrders.length > 0 && (
            <button type="button" onClick={() => handleExportPOs(activeOrders, 'Active_Orders')} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all">
              <ExcelIcon /> Export
            </button>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-12 bg-bg-card rounded-2xl border border-border-default animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-bg-card p-10 text-center">
            <p className="text-text-secondary text-sm">No orders yet. Create your first PO above.</p>
          </div>
        ) : activeOrders.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-bg-card px-6 py-5 text-sm text-text-secondary/50 italic">
            All orders are completed.
          </div>
        ) : (
          <POTable orders={activeOrders} />
        )}
      </div>

      {/* Completed Orders — only shown when at least one exists */}
      {!loading && completedOrders.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-green-500/60">Completed Orders</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
              {completedOrders.length}
            </span>
            <button type="button" onClick={() => handleExportPOs(completedOrders, 'Completed_Orders')} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all">
              <ExcelIcon /> Export
            </button>
          </div>
          <POTable orders={completedOrders} />
        </div>
      )}
    </div>
  )
}
