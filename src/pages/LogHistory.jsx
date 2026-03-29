import { useEffect, useMemo, useState } from 'react'
import { SectionBarChart } from '../components/Charts'
import api from '../utils/api'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatDateTime(value) {
  if (!value) return '—'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function LogHistory() {
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    try {
      setExporting(true)
      await fetch('https://n8n.avlokai.com/webhook-test/77d8abd5-246a-4797-8370-1ebfdb10ffec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, logs: filtered }),
      })
      alert('Logs exported successfully!')
    } catch (err) {
      console.error('Export failed', err)
      alert('Failed to export logs.')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const fetchRows = async () => {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get('/floor/transactions')
        const items = Array.isArray(data) ? data : data?.data || []
        if (!cancelled) setRows(items)
      } catch (err) {
        console.error('Failed to load floor transactions', err)
        if (!cancelled) setError(err?.response?.data?.error || err?.message || 'Failed to load floor transactions')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchRows()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!date) return rows
    return (rows || []).filter((row) => String(row.created_at || row.createdAt || '').slice(0, 10) === date)
  }, [date, rows])

  const dailyMovementChart = useMemo(() => {
    const daily = {}
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const d = String(row.created_at || row.createdAt || '').slice(0, 10)
      if (!d) return
      daily[d] = (daily[d] || 0) + toNumber(row.quantity_kg)
    })

    return Object.entries(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ name: d, value: toNumber(v) / 1000 }))
  }, [rows])

  const inputClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Log History</h2>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Filter by Date</label>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </div>

          {date && (
            <button
              type="button"
              onClick={() => setDate('')}
              className="rounded-lg border border-border-default px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              Clear
            </button>
          )}
          
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || filtered.length === 0}
            className="rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accent-gold/90 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export Logs'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {dailyMovementChart.length > 0 && (
        <SectionBarChart data={dailyMovementChart} title="Daily Floor Movement (tons)" color="#a78bfa" />
      )}

      <div className="rounded-[28px] border border-border-default bg-bg-card shadow-lg shadow-black/30">
        <div className="flex items-center gap-3 border-b border-border-default px-6 py-4">
          <span className="rounded px-2.5 py-1 text-xs font-medium bg-accent-gold/15 text-accent-gold">
            Floor Transactions
          </span>
          <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary/70">
            - {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Material
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Type
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Qty (kg)
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Direction
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-text-secondary/50 text-sm">
                    Loading floor transactions…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-text-secondary/50 text-sm">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                filtered.map((row, index) => (
                  <tr
                    key={row.id ?? index}
                    className={`border-b border-border-subtle transition-colors hover:bg-white/[0.02] ${
                      index % 2 === 0 ? '' : 'bg-white/[0.01]'
                    }`}
                  >
                    <td className="px-6 py-3 text-text-primary/90">{row.material_name || `Material ${row.material_type_id}`}</td>
                    <td className="px-6 py-3 text-text-primary/90">{row.transaction_type || '—'}</td>
                    <td className="px-6 py-3 text-right font-medium text-accent-gold">{toNumber(row.quantity_kg).toFixed(2)}</td>
                    <td className="px-6 py-3 text-text-primary/90">{row.direction || '—'}</td>
                    <td className="px-6 py-3 text-text-secondary">{formatDateTime(row.created_at || row.createdAt)}</td>
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
