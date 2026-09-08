import { useEffect, useState } from 'react'
import useSSE from '../hooks/useSSE'
import useFlashRows from '../hooks/useFlashRows'
import DataTable from '../components/DataTable'
import Pictogram from '../components/Pictogram'
import StockOverflowDialog, { parseAvailableKg } from '../components/StockOverflowDialog'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import { formatDate, formatTime, todayIST } from '../utils/datetime'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

// Every movement this screen can create is an OUT floor transfer, so the
// Direction and Type columns only ever repeated the same two words down the
// whole table. They are gone; the heading says what these rows are.
const historyColumns = [
  { key: 'created_at', label: 'Date', icon: 'date', render: (val) => formatDate(val) },
  {
    key: 'created_at_time',
    label: 'Time',
    icon: 'clock',
    render: (_val, row) => <span className="text-text-secondary">{formatTime(row.created_at)}</span>,
  },
  {
    key: 'material_name',
    label: 'Material',
    icon: 'material',
    render: (val, row) => val || `[ID: ${row.material_id}]`,
  },
  {
    key: 'quantity_kg',
    label: 'To Floor',
    icon: 'down',
    render: (val) => (
      <span className="font-mono font-semibold tabular-nums text-accent-gold">
        {toNumber(val).toFixed(2)} kg
      </span>
    ),
  },
  { key: 'created_by_name', label: 'By', icon: 'person', render: (val) => val || '—' },
  { key: 'note', label: 'Note', icon: 'note', render: (val) => val || '—' },
]

export default function MaterialMovement() {
  const toast = useToast()
  const [materials, setMaterials] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  useFlashRows(movements.length)
  const [submitting, setSubmitting] = useState(false)
  const [stockOverflow, setStockOverflow] = useState(null)
  const [topUpLoading, setTopUpLoading] = useState(false)

  const [form, setForm] = useState({
    material_name: '',
    quantity_kg: '',
    date: '',
    movement_type: 'FLOOR_TRANSFER',
    direction: 'OUT',
    note: '',
  })

  // Empty means today, which is the common case; a transfer written up the next
  // morning still lands on the day it happened.
  const entryDate = form.date || todayIST()

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [matRes, movRes] = await Promise.allSettled([
        api.get('/raw-material/options'),
        api.get('/floor/transactions'),
      ])
      if (matRes.status === 'fulfilled') {
        setMaterials(Array.isArray(matRes.value.data) ? matRes.value.data : [])
      }
      if (movRes.status === 'fulfilled') {
        setMovements(Array.isArray(movRes.value.data) ? movRes.value.data : [])
      }
    } catch {/* ignore */} finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useSSE(['material_movement', 'floor_stock'], () => loadData(true))

  const handleChange = e => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async e => {
    e?.preventDefault()
    const qty = parseFloat(form.quantity_kg)
    if (!form.material_name) return toast.error('Select a material')
    if (!qty || qty <= 0) return toast.error('Quantity must be greater than 0')

    setSubmitting(true)
    try {
      const { data } = await api.post('/materials/move', {
        material_name: form.material_name,
        quantity_kg: qty,
        date: entryDate,
        direction: form.direction,
        movement_type: form.movement_type,
        note: form.note || undefined,
      })
      toast.success(`${qty} kg of ${form.material_name} sent to the floor`)
      setForm(prev => ({ ...prev, quantity_kg: '', note: '' }))
      if (data?.movement) {
        setMovements(prev => [{ ...data.movement, material_name: form.material_name }, ...prev])
      }
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || err?.response?.data?.error || 'Failed to record movement'
      if (errorMsg.includes('Insufficient stock')
        || errorMsg.includes('Insufficient raw stock')
        || errorMsg.includes('Not enough')) {
        const available = parseAvailableKg(errorMsg) ?? 0
        setStockOverflow({ materialName: form.material_name, attempted: qty, available })
      } else {
        toast.error(errorMsg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const fieldClass = 'w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent-gold'
  const labelClass = 'mb-1 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-text-primary">
          <Pictogram name="truck" size={20} className="text-accent-gold" />
          Material To Floor
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <div className="rounded-lg border border-border-default bg-bg-card p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <Pictogram name="add" size={14} />
              Send To Floor
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className={labelClass}>
                  <Pictogram name="material" size={13} className="text-text-secondary/70" />
                  Material
                </label>
                <select
                  name="material_name"
                  value={form.material_name}
                  onChange={handleChange}
                  required
                  className={fieldClass}
                >
                  <option value="">Select material...</option>
                  {materials.map(m => (
                    <option key={m.material_name} value={m.material_name}>{m.material_name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>
                    <Pictogram name="weight" size={13} className="text-text-secondary/70" />
                    Quantity (kg)
                  </label>
                  <input
                    type="number"
                    name="quantity_kg"
                    value={form.quantity_kg}
                    onChange={handleChange}
                    step="0.001"
                    min="0.001"
                    required
                    placeholder="0.000"
                    className={`${fieldClass} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    <Pictogram name="date" size={13} className="text-text-secondary/70" />
                    Date
                  </label>
                  <input
                    type="date"
                    name="date"
                    value={entryDate}
                    max={todayIST()}
                    onChange={handleChange}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  <Pictogram name="note" size={13} className="text-text-secondary/70" />
                  Note (optional)
                </label>
                <input
                  type="text"
                  name="note"
                  value={form.note}
                  onChange={handleChange}
                  placeholder="Add a note..."
                  className={fieldClass}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-gold py-2 text-sm font-semibold text-black transition-all hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-40"
              >
                <Pictogram name="truck" size={15} />
                {submitting ? 'Recording...' : 'Send To Floor'}
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <StockSummary />
          <DataTable
            title="Sent To Floor By Date"
            titleIcon="date"
            columns={historyColumns}
            data={movements}
            groupByDate="created_at"
            emptyMessage={loading ? 'Loading...' : 'Nothing sent to the floor yet.'}
          />
        </div>
      </div>

      {stockOverflow && (
        <StockOverflowDialog
          materialName={stockOverflow.materialName}
          attempted={stockOverflow.attempted}
          available={stockOverflow.available}
          loading={topUpLoading}
          onCancel={() => setStockOverflow(null)}
          onTopUp={async (amount) => {
            setTopUpLoading(true)
            try {
              await api.post('/raw-material/add', {
                material_name: stockOverflow.materialName,
                quantity_kg: amount,
              })
              setStockOverflow(null)
              handleSubmit({ preventDefault: () => {} })
            } catch (err) {
              toast.error(err?.response?.data?.detail || err?.response?.data?.error || 'Failed to add raw material')
            } finally {
              setTopUpLoading(false)
            }
          }}
        />
      )}
    </div>
  )
}

function StockSummary() {
  const [totals, setTotals] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    api.get('/raw-material/totals')
      .then(({ data }) => setTotals(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [])
  useSSE(['raw_material', 'material_movement', 'production'], load)

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-bg-card">
      <div className="flex items-center gap-1.5 border-b border-border-default bg-bg-primary/60 px-3 py-2">
        <Pictogram name="stock" size={14} className="text-text-secondary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Stock On Hand</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary/60">Material</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary/60">In Stock</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary/60">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="py-6 text-center text-text-secondary/50">Loading...</td></tr>
            ) : totals.length === 0 ? (
              <tr><td colSpan={3} className="py-6 text-center text-text-secondary/50">No materials found</td></tr>
            ) : (
              totals.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle transition-colors hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5 font-medium text-text-primary">{row.material_name}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-accent-gold">
                    {toNumber(row.total_quantity_kg).toFixed(2)} kg
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-text-secondary/60">
                    {formatDate(row.updated_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
