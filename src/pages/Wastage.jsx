import { useEffect, useState, useCallback } from 'react'
import { useToast } from '../components/Toast'
import api from '../utils/api'

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Wastage({ user }) {
  const isOwner = user?.role === 'owner'
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [wastageRows, setWastageRows] = useState([])

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    weight: '',
  })
  const [deletingId, setDeletingId] = useState(null)

  const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this wastage entry?')) return
    setDeletingId(id)
    try {
      await api.delete(`/wastage/${id}`)
      toast.success('Entry deleted')
      loadWastage()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete entry')
    } finally {
      setDeletingId(null)
    }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.weight || Number(form.weight) <= 0) {
      toast.error('Please enter a valid wastage amount')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/wastage', {
        date: form.date,
        weight: Number(form.weight),
      })
      toast.success('Wastage logged successfully')
      setForm(prev => ({ ...prev, weight: '' }))
      loadWastage()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to log wastage')
    } finally {
      setSubmitting(false)
    }
  }

  const handleExport = async () => {
    try {
      setExporting(true)
      await fetch('https://n8n.avlokai.com/webhook-test/77d8abd5-246a-4797-8370-1ebfdb10ffec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wastage', logs: wastageRows }),
      })
      toast.success('Logs exported successfully!')
    } catch {
      toast.error('Failed to export logs.')
    } finally {
      setExporting(false)
    }
  }

  const loadWastage = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/wastage')
      setWastageRows(Array.isArray(data) ? data : [])
    } catch {
      setWastageRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWastage()
    const pollInterval = setInterval(loadWastage, 50000)
    return () => clearInterval(pollInterval)
  }, [loadWastage])

  const totalWastage = wastageRows.reduce((s, r) => s + toNumber(r.weight), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Wastage Entry</h1>
          <p className="text-sm text-text-secondary mt-1">Log wastage generated during production</p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || wastageRows.length === 0}
            className="rounded-xl bg-accent-gold/10 border border-accent-gold/30 px-4 py-2 text-sm font-semibold text-accent-gold hover:bg-accent-gold/20 transition-all disabled:opacity-40"
          >
            {exporting ? 'Exporting...' : 'Export Logs'}
          </button>
        )}
      </div>

      {/* Entry Form */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60 mb-6">Log Wastage</h2>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Date</label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              required
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>

          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Wastage (kg)</label>
            <input
              type="number"
              name="weight"
              value={form.weight}
              onChange={handleChange}
              required
              step="0.01"
              min="0.01"
              placeholder="0.00"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={submitting}
              className="px-8 py-2.5 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
            >
              {submitting ? 'Logging...' : 'Log Wastage'}
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Wastage Logs</h2>
          {totalWastage > 0 && (
            <span className="text-xs font-semibold font-mono text-accent-gold bg-accent-gold/10 border border-accent-gold/20 rounded-lg px-3 py-1">
              Total: {totalWastage.toFixed(2)} kg
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-primary/30">
                <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">S.No</th>
                <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Date</th>
                <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Wastage (kg)</th>
                <th className="px-6 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {loading ? (
                <tr><td colSpan={3} className="py-10 text-center text-text-secondary/50">Loading...</td></tr>
              ) : wastageRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-sm text-text-secondary/40">
                    No wastage entries logged yet. Submit above to see records.
                  </td>
                </tr>
              ) : (
                wastageRows.map((row, i) => (
                  <tr key={row.id || i} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3.5 text-text-secondary/60">{row.sno || i + 1}</td>
                    <td className="px-6 py-3.5 text-text-primary/90">{formatDate(row.date)}</td>
                    <td className="px-6 py-3.5 text-right font-mono font-bold text-accent-gold">{toNumber(row.weight).toFixed(2)}</td>
                    <td className="px-6 py-3.5 text-center">
                      <button
                        onClick={() => handleDelete(row.id)}
                        disabled={deletingId === row.id}
                        className="text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors text-xs font-semibold px-3 py-1 rounded-lg border border-red-500/20 hover:border-red-400/40 hover:bg-red-500/10"
                      >
                        {deletingId === row.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
