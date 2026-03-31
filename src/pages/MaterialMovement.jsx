import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import api from '../utils/api'

const MOVEMENT_TYPES = ['INWARD', 'FLOOR_TRANSFER', 'CONSUMPTION', 'ADJUSTMENT']

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const directionColors = {
  IN: 'text-green-400 bg-green-500/10 border-green-500/20',
  OUT: 'text-red-400 bg-red-500/10 border-red-500/20',
}

const typeColors = {
  INWARD: 'text-blue-400 bg-blue-500/10',
  FLOOR_TRANSFER: 'text-purple-400 bg-purple-500/10',
  CONSUMPTION: 'text-orange-400 bg-orange-500/10',
  ADJUSTMENT: 'text-yellow-400 bg-yellow-500/10',
}

export default function MaterialMovement() {
  const toast = useToast()
  const [materials, setMaterials] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    material_name: '',
    quantity_kg: '',
    movement_type: 'INWARD',
    direction: 'IN',
    note: '',
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const [matRes, rawRes] = await Promise.allSettled([
        api.get('/raw-material/options'),
        api.get('/raw-material/totals'),
      ])
      if (matRes.status === 'fulfilled') {
        setMaterials(Array.isArray(matRes.value.data) ? matRes.value.data : [])
      }
    } catch {/* ignore */} finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleChange = e => {
    const { name, value } = e.target
    setForm(prev => {
      const next = { ...prev, [name]: value }
      // Auto-set direction
      if (name === 'movement_type') {
        if (['INWARD'].includes(value)) next.direction = 'IN'
        else if (['CONSUMPTION', 'FLOOR_TRANSFER'].includes(value)) next.direction = 'OUT'
      }
      return next
    })
  }

  const handleSubmit = async e => {
    e.preventDefault()
    const qty = parseFloat(form.quantity_kg)
    if (!form.material_name) return toast.error('Select a material')
    if (!qty || qty <= 0) return toast.error('Quantity must be greater than 0')

    setSubmitting(true)
    try {
      await api.post('/materials/move', {
        material_name: form.material_name,
        quantity_kg: qty,
        direction: form.direction,
        movement_type: form.movement_type,
        note: form.note || undefined,
      })
      toast.success(`Movement recorded — ${qty} kg ${form.direction}`)
      setForm(prev => ({ ...prev, quantity_kg: '', note: '' }))
      loadData()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to record movement')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Material Movement</h1>
        <p className="text-sm text-text-secondary mt-1">Record material in/out movements and floor transfers</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Form */}
        <div className="xl:col-span-1">
          <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-6">New Movement</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Material */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Material
                </label>
                <select
                  name="material_name"
                  value={form.material_name}
                  onChange={handleChange}
                  required
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                >
                  <option value="">Select material...</option>
                  {materials.map(m => (
                    <option key={m.material_name} value={m.material_name}>{m.material_name}</option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
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
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all"
                />
              </div>

              {/* Movement Type */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Movement Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MOVEMENT_TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(prev => {
                        const next = { ...prev, movement_type: t }
                        if (['INWARD'].includes(t)) next.direction = 'IN'
                        else if (['CONSUMPTION', 'FLOOR_TRANSFER'].includes(t)) next.direction = 'OUT'
                        return next
                      })}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                        form.movement_type === t
                          ? 'bg-accent-gold text-white border-accent-gold shadow-sm'
                          : 'border-border-default text-text-secondary hover:border-accent-gold/40'
                      }`}
                    >
                      {t.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Direction */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Direction
                </label>
                <div className="flex gap-3">
                  {['IN', 'OUT'].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, direction: d }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                        form.direction === d
                          ? d === 'IN'
                            ? 'bg-green-500/20 border-green-500/50 text-green-400'
                            : 'bg-red-500/20 border-red-500/50 text-red-400'
                          : 'border-border-default text-text-secondary hover:bg-bg-primary'
                      }`}
                    >
                      {d === 'IN' ? '↓ IN' : '↑ OUT'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Note (optional)
                </label>
                <input
                  type="text"
                  name="note"
                  value={form.note}
                  onChange={handleChange}
                  placeholder="Add a note..."
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
              >
                {submitting ? 'Recording...' : 'Record Movement'}
              </button>
            </form>
          </div>
        </div>

        {/* Stock Summary */}
        <div className="xl:col-span-2 space-y-6">
          <StockSummary />
        </div>
      </div>
    </div>
  )
}

function StockSummary() {
  const [totals, setTotals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/raw-material/totals')
      .then(({ data }) => setTotals(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle">
        <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Raw Material Stock</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Material</th>
              <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Stock (kg)</th>
              <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="py-8 text-center text-text-secondary/50">Loading...</td></tr>
            ) : totals.length === 0 ? (
              <tr><td colSpan={3} className="py-8 text-center text-text-secondary/50">No materials found</td></tr>
            ) : (
              totals.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-3.5 font-medium text-text-primary">{row.material_name}</td>
                  <td className="px-6 py-3.5 text-right font-mono font-semibold text-accent-gold">
                    {parseFloat(row.total_quantity_kg || 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-3.5 text-right text-text-secondary/60 text-xs">
                    {row.updated_at ? new Date(row.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
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
