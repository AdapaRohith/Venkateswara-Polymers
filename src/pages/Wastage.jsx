import { useCallback, useEffect, useState } from 'react'
import useSSE from '../hooks/useSSE'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import { exportSingleSheet } from '../utils/exportToExcel'

const ExcelIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function firstNumber(...values) {
  for (const value of values) {
    const numericValue = Number(value)
    if (Number.isFinite(numericValue)) return numericValue
  }
  return 0
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.rows)) return payload.rows
  if (Array.isArray(payload?.logs)) return payload.logs
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload?.wastage)) return payload.wastage
  if (Array.isArray(payload?.wastage_logs)) return payload.wastage_logs
  if (Array.isArray(payload?.wastageLogs)) return payload.wastageLogs
  return []
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function normalizeWastageRow(row = {}, index = 0) {
  return {
    ...row,
    id: row.id ?? row.transactionId ?? `wastage-${index}`,
    source: 'wastage',
    sno: row.sno ?? index + 1,
    date: row.date ?? String(row.created_at ?? row.createdAt ?? '').slice(0, 10),
    order_number: row.order_number ?? row.orderNumber ?? '',
    actualWeight: firstNumber(row.actualWeight, row.actual_weight, row.weight, row.wastage_generated, row.quantity_kg, row.quantity, row.net_weight, row.netWeight),
    grossWeight: firstNumber(row.grossWeight, row.gross_weight),
    netWeight: firstNumber(row.netWeight, row.net_weight),
  }
}

export default function Wastage({ user }) {
  const isOwner = user?.role === 'owner'
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [wastageRows, setWastageRows] = useState([])
  const [deletingId, setDeletingId] = useState(null)

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    weight: '',
  })

  const loadWastage = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await api.get('/wastage')
      const rows = extractRows(data)
      setWastageRows(
        rows
          .map(normalizeWastageRow)
          .sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))),
      )
    } catch (err) {
      console.error('Failed to load wastage logs', err)
      setWastageRows([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWastage()
  }, [loadWastage])

  useSSE(['wastage'], () => loadWastage(true))

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
  }

  const handleDelete = async (row) => {
    if (!window.confirm('Delete this wastage entry?')) return

    setDeletingId(row.id)
    try {
      await api.delete(`/wastage/${row.transactionId || row.id}`)
      toast.success('Entry deleted')
      setWastageRows((prev) => prev.filter((r) => r.id !== row.id))
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete entry')
    } finally {
      setDeletingId(null)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const weight = toNumber(form.weight)
    if (weight <= 0) {
      toast.error('Please enter a valid wastage amount')
      return
    }

    setSubmitting(true)
    try {
      const { data } = await api.post('/wastage', {
        date: form.date,
        weight,
        wastage_generated: weight,
      })
      toast.success('Wastage logged successfully')
      setForm((previous) => ({ ...previous, weight: '' }))
      if (data) {
        setWastageRows((prev) => [normalizeWastageRow(data, prev.length), ...prev])
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to log wastage')
    } finally {
      setSubmitting(false)
    }
  }

  const totalWastage = wastageRows.reduce((sum, row) => sum + toNumber(row.actualWeight), 0)

  const handleExport = () => {
    const rows = wastageRows.map((row, index) => ({
      sno: row.sno || index + 1,
      date: formatDate(row.date),
      order_number: row.order_number || '',
      gross_weight: toNumber(row.grossWeight).toFixed(2),
      net_weight: toNumber(row.netWeight).toFixed(2),
      actual_weight: toNumber(row.actualWeight).toFixed(2),
    }))

    exportSingleSheet({
      filename: `Wastage_${new Date().toISOString().slice(0, 10)}`,
      rows,
      columns: [
        { key: 'sno', label: 'S.No' },
        { key: 'date', label: 'Date' },
        { key: 'order_number', label: 'Order' },
        { key: 'gross_weight', label: 'Gross (kg)' },
        { key: 'net_weight', label: 'Net (kg)' },
        { key: 'actual_weight', label: 'Actual Wastage (kg)' },
      ],
      totalRow: {
        sno: '',
        date: 'TOTAL',
        order_number: '',
        gross_weight: '',
        net_weight: '',
        actual_weight: totalWastage.toFixed(2),
      },
    })
    toast.success('Wastage data exported to Excel')
  }

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
            disabled={wastageRows.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
          >
            <ExcelIcon /> Export Excel
          </button>
        )}
      </div>

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
                <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Order</th>
                <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Gross (kg)</th>
                <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Net (kg)</th>
                <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Actual Wastage (kg)</th>
                <th className="px-6 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {loading ? (
                <tr><td colSpan={7} className="py-10 text-center text-text-secondary/50">Loading...</td></tr>
              ) : wastageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-text-secondary/40">
                    No wastage entries logged yet. Submit above to see records.
                  </td>
                </tr>
              ) : (
                wastageRows.map((row, index) => (
                  <tr key={`${row.source}-${row.id || index}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3.5 text-text-secondary/60">{row.sno || index + 1}</td>
                    <td className="px-6 py-3.5 text-text-primary/90">{formatDate(row.date)}</td>
                    <td className="px-6 py-3.5 text-text-primary/90">{row.order_number || '-'}</td>
                    <td className="px-6 py-3.5 text-right font-mono text-text-secondary/80">{toNumber(row.grossWeight).toFixed(2)}</td>
                    <td className="px-6 py-3.5 text-right font-mono text-text-secondary/80">{toNumber(row.netWeight).toFixed(2)}</td>
                    <td className="px-6 py-3.5 text-right font-mono font-bold text-accent-gold">{toNumber(row.actualWeight).toFixed(2)}</td>
                    <td className="px-6 py-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={deletingId === row.id}
                        className="text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors text-xs font-semibold px-3 py-1 rounded-lg border border-red-500/20 hover:border-red-400/40 hover:bg-red-500/10"
                      >
                        {deletingId === row.id ? 'Deleting...' : 'Delete'}
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
