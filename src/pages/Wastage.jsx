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

export default function Wastage({ user, ordersList = [] }) {
  const isOwner = user?.role === 'owner'
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [wastageRows, setWastageRows] = useState([])

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    wastage_generated: '',
  })

  // Compute sno from existing rows
  const nextSno = wastageRows.length + 1

  const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.date || !form.wastage_generated) {
      toast.error('Please fill all required fields')
      return
    }
    if (Number(form.wastage_generated) <= 0) {
      toast.error('Wastage generated must be greater than 0')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/wastage', {
        sno: nextSno,
        date: form.date,
        wastage_generated: Number(form.wastage_generated),
      })
      toast.success('Wastage logged successfully')
      setForm(prev => ({ ...prev, wastage_generated: '' }))
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
      const { data } = await api.get('/reports/logs?limit=200')
      setWastageRows(Array.isArray(data) ? [] : [])
    } catch {
      setWastageRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWastage()
    
    // Poll every 50 seconds
    const pollInterval = setInterval(loadWastage, 50000)
    
    return () => clearInterval(pollInterval)
  }, [loadWastage])

  const totalWastage = wastageRows.reduce((s, r) => s + toNumber(r.wastage_generated || r.net_weight || r.netWeight), 0)

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
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div>
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

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Wastage Generated (kg)</label>
            <input
              type="number"
              name="wastage_generated"
              value={form.wastage_generated}
              onChange={handleChange}
              required
              step="0.01"
              min="0"
              placeholder="0.00"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-lg shadow-accent-gold/20 transition-all disabled:opacity-40"
            >
              {submitting ? 'Logging...' : 'Log Wastage'}
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Recent Wastage Logs</h2>
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
                <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Wastage Generated (kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {loading ? (
                <tr><td colSpan={3} className="py-10 text-center text-text-secondary/50">Loading...</td></tr>
              ) : wastageRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-sm text-text-secondary/40">
                    No wastage entries logged yet. Submit above to see records.
                  </td>
                </tr>
              ) : (
                wastageRows.map((row, i) => {
                  const wastage = toNumber(row.wastage_generated || row.net_weight || row.netWeight)
                  return (
                    <tr key={row.id || i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-3.5 text-text-secondary/60">{row.sno || i + 1}</td>
                      <td className="px-6 py-3.5 text-text-primary/90">{formatDate(row.date)}</td>
                      <td className="px-6 py-3.5 text-right font-mono font-bold text-accent-gold">{wastage.toFixed(2)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
