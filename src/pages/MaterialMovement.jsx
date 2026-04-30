import { useEffect, useState } from 'react'
import TolerancePanel from '../components/TolerancePanel'
import { useToast } from '../components/Toast'
import api from '../utils/api'

const MOVEMENT_TYPES = ['FLOOR_TRANSFER']

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

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
  const [lastTolerance, setLastTolerance] = useState(null)

  const [form, setForm] = useState({
    material_name: '',
    quantity_kg: '',
    expected_quantity_kg: '',
    movement_type: 'FLOOR_TRANSFER',
    direction: 'OUT',
    note: '',
  })

  const loadData = async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }

  useEffect(() => {
    // Load immediately
    loadData()
    
    // Poll every 10 seconds
    const pollInterval = setInterval(loadData, 10000)
    
    return () => clearInterval(pollInterval)
  }, [])

  const handleChange = e => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async e => {
    e.preventDefault()
    const qty = parseFloat(form.quantity_kg)
    if (!form.material_name) return toast.error('Select a material')
    if (!qty || qty <= 0) return toast.error('Quantity must be greater than 0')

    setSubmitting(true)
    try {
      const expectedQty = toNumber(form.expected_quantity_kg)
      const { data } = await api.post('/materials/move', {
        material_name: form.material_name,
        quantity_kg: qty,
        expected_quantity_kg: expectedQty > 0 ? expectedQty : undefined,
        direction: form.direction,
        movement_type: form.movement_type,
        note: form.note || undefined,
      })
      toast.success(`Movement recorded — ${qty} kg ${form.direction}`)
      setLastTolerance(data?.tolerance ? {
        ...data.tolerance,
        expected: expectedQty > 0 ? expectedQty : qty,
        actual: qty,
      } : null)
      if (data?.tolerance?.tolerance_status === 'BREACH') {
        toast.warning('Movement recorded with tolerance breach')
      }
      setForm(prev => ({ ...prev, quantity_kg: '', expected_quantity_kg: '', note: '' }))
      loadData()
    } catch (err) {
      const strictDetails = err?.response?.data?.details
      if (strictDetails) {
        const expectedQty = toNumber(form.expected_quantity_kg)
        setLastTolerance({
          ...strictDetails,
          expected: expectedQty > 0 ? expectedQty : qty,
          actual: qty,
        })
      }
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

              {/* Movement Type — Fixed to Floor Transfer */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">
                  Expected Quantity (kg)
                </label>
                <input
                  type="number"
                  name="expected_quantity_kg"
                  value={form.expected_quantity_kg}
                  onChange={handleChange}
                  step="0.001"
                  min="0"
                  placeholder="Optional"
                  className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all"
                />
              </div>

              <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-purple-400">Floor Transfer</p>
                  <p className="text-[10px] text-text-secondary/50 mt-0.5">Material out to production floor</p>
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
            <div className="mt-5">
              <TolerancePanel
                tolerance={lastTolerance}
                title="Movement Tolerance"
                context={form.material_name || 'Last material movement'}
              />
            </div>
          </div>
        </div>

        {/* Stock Summary & Movements History */}
        <div className="xl:col-span-2 space-y-6">
          <StockSummary />
          <MovementHistory movements={movements} loading={loading} />
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

function MovementHistory({ movements, loading }) {
  return (
    <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle">
        <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Movement History</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Date/Time</th>
              <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Material</th>
              <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Quantity (kg)</th>
              <th className="px-6 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Direction</th>
              <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Type</th>
              <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">By</th>
              <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Note</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-text-secondary/50">Loading...</td></tr>
            ) : movements.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-text-secondary/50">No movements recorded yet</td></tr>
            ) : (
              movements.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-3.5 text-xs text-text-secondary/70 whitespace-nowrap">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-6 py-3.5 font-medium text-text-primary">
                    {row.material_name || `[ID: ${row.material_id}]`}
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono font-semibold text-accent-gold">
                    {parseFloat(row.quantity_kg || 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-3.5 text-center">
                    <span className={`inline-block px-3 py-1 rounded-lg text-xs font-bold border ${directionColors[row.direction] || 'text-gray-400 bg-gray-500/10'}`}>
                      {row.direction || '—'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-block px-3 py-1 rounded-lg text-xs font-bold ${typeColors[row.movement_type] || 'text-gray-400'}`}>
                      {row.movement_type || '—'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-text-secondary/70">
                    {row.created_by_name || '—'}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-text-secondary/60 max-w-xs truncate">
                    {row.note || '—'}
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
