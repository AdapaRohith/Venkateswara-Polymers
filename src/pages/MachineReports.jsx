import { useEffect, useState } from 'react'
import api from '../utils/api'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function MachineReports() {
  const [report, setReport] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({
    date_from: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    date_to: new Date().toISOString().split('T')[0],
  })
  const [applied, setApplied] = useState(null)
  const [detailLogs, setDetailLogs] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  const loadReport = async () => {
    setLoading(true)
    setDetailLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (filters.date_from) params.append('date_from', filters.date_from)
      if (filters.date_to) params.append('date_to', filters.date_to)

      const [reportRes, logsRes] = await Promise.allSettled([
        api.get(`/reports/machines?${params.toString()}`),
        api.get(`/reports/logs?${params.toString()}`),
      ])

      if (reportRes.status === 'fulfilled') {
        setReport(Array.isArray(reportRes.value.data) ? reportRes.value.data : [])
      }
      if (logsRes.status === 'fulfilled') {
        const logs = Array.isArray(logsRes.value.data) ? logsRes.value.data : []
        setDetailLogs(logs)
      }
      setApplied({ ...filters })
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load report')
    } finally {
      setLoading(false)
      setDetailLoading(false)
    }
  }

  // Load on mount with polling (only if default date range)
  useEffect(() => {
    loadReport()
    
    // Poll every 10 seconds
    const pollInterval = setInterval(loadReport, 10000)
    
    return () => clearInterval(pollInterval)
  }, []) // eslint-disable-line

  const totalEntries = report.reduce((s, r) => s + (Number(r.total_entries) || 0), 0)
  const totalNet = report.reduce((s, r) => s + (Number(r.total_net_weight_kg) || 0), 0)
  const totalGross = report.reduce((s, r) => s + (Number(r.total_gross_weight_kg) || 0), 0)
  const maxNet = Math.max(...report.map(r => Number(r.total_net_weight_kg) || 0), 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Machine Reports</h1>
        <p className="text-sm text-text-secondary mt-1">Production output by machine for a date range</p>
      </div>

      {/* Filters */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Date From</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={e => setFilters(p => ({ ...p, date_from: e.target.value }))}
              className="bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Date To</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={e => setFilters(p => ({ ...p, date_to: e.target.value }))}
              className="bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
          <button
            onClick={loadReport}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-sm transition-all disabled:opacity-40"
          >
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
          {/* Quick presets */}
          <div className="flex gap-2">
            {[
              { label: 'Today', days: 0 },
              { label: '7 Days', days: 7 },
              { label: '30 Days', days: 30 },
            ].map(preset => (
              <button
                key={preset.label}
                onClick={() => {
                  const to = new Date().toISOString().split('T')[0]
                  const from = new Date(Date.now() - preset.days * 86400000).toISOString().split('T')[0]
                  setFilters({ date_from: preset.days === 0 ? to : from, date_to: to })
                }}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-border-default text-text-secondary hover:border-accent-gold/40 hover:text-accent-gold transition-all"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        {applied && (
          <p className="text-[11px] text-text-secondary/50 mt-3">
            Showing: {formatDate(applied.date_from)} — {formatDate(applied.date_to)}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Summary cards */}
      {!loading && report.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Entries', value: totalEntries.toLocaleString(), icon: '📋' },
            { label: 'Total Net Output', value: `${totalNet.toFixed(2)} kg`, icon: '⚖️' },
            { label: 'Total Gross', value: `${totalGross.toFixed(2)} kg`, icon: '📦' },
          ].map(card => (
            <div key={card.label} className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{card.icon}</span>
                <span className="text-xs font-semibold uppercase tracking-widest text-text-secondary/60">{card.label}</span>
              </div>
              <p className="text-2xl font-bold text-text-primary font-mono">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Report table */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Machine Output Breakdown</h2>
        </div>

        {loading ? (
          <div className="divide-y divide-border-subtle">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="h-4 w-24 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 flex-1 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 w-20 bg-bg-primary rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : report.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-text-secondary text-sm">No data for this date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-primary/50">
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Machine</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Entries</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Net Output (kg)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Gross (kg)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Tare (kg)</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {report
                  .sort((a, b) => (Number(b.total_net_weight_kg) || 0) - (Number(a.total_net_weight_kg) || 0))
                  .map((row, i) => {
                    const net = Number(row.total_net_weight_kg) || 0
                    const barWidth = maxNet > 0 ? (net / maxNet) * 100 : 0
                    const hasData = Number(row.total_entries) > 0

                    return (
                      <tr key={row.machine_id} className={`hover:bg-white/[0.02] transition-colors ${!hasData ? 'opacity-40' : ''}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${hasData ? 'bg-accent-gold' : 'bg-text-secondary/20'}`} />
                            <span className="font-semibold text-text-primary">{row.machine_name || `Machine ${row.machine_id}`}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-text-secondary">
                          {row.total_entries || 0}
                        </td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-accent-gold">
                          {net.toFixed(3)}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-text-secondary/80">
                          {(Number(row.total_gross_weight_kg) || 0).toFixed(3)}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-text-secondary/60">
                          {(Number(row.total_tare_weight_kg) || 0).toFixed(3)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="w-32 h-2 bg-bg-primary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent-gold rounded-full transition-all duration-700"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr className="border-t-2 border-border-default bg-bg-primary/30">
                  <td className="px-6 py-3 text-xs font-bold uppercase tracking-wide text-text-secondary/60">Total</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-primary">{totalEntries}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-accent-gold">{totalNet.toFixed(3)}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-secondary/80">{totalGross.toFixed(3)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Production Material Log */}
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Production Material Log</h2>
          </div>
          <span className="text-[10px] text-text-secondary/40 font-mono">{detailLogs.length} entries</span>
        </div>

        {detailLoading ? (
          <div className="divide-y divide-border-subtle">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="h-4 w-20 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 flex-1 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 w-16 bg-bg-primary rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : detailLogs.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-text-secondary/50 text-sm">No production entries found for this date range.</p>
            <p className="text-text-secondary/30 text-xs mt-1">Log entries from the Production page to see them here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-primary/50">
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Time</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Machine</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Material / Note</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Size</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Gross (kg)</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Tare (kg)</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Net (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {detailLogs.map((entry, i) => {
                  const gross = Number(entry.gross_weight) || 0
                  const tare = Number(entry.tare_weight) || 0
                  const net = Number(entry.net_weight) || Math.max(gross - tare, 0)
                  const machineName = entry.machine_name || `Machine ${entry.machine_id}`
                  const note = entry.note || entry.size_note || ''

                  // Parse material and worker from note if available
                  const materialMatch = note.match(/Material:\s*([^|]+)/)
                  const workerMatch = note.match(/Worker:\s*(.+)/)
                  const materialText = materialMatch ? materialMatch[1].trim() : ''
                  const workerText = workerMatch ? workerMatch[1].trim() : ''
                  const isCutting = note.includes('[CUTTING]')
                  const displayNote = materialText || note.replace('[CUTTING]', '').replace(/Material:[^|]+/, '').replace(/\|?\s*Worker:[^|]+/, '').trim() || '—'

                  return (
                    <tr key={entry.id || i} className={`hover:bg-white/[0.02] transition-colors ${i % 2 !== 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-5 py-3 text-text-primary/80 whitespace-nowrap text-xs">{formatDateTime(entry.created_at)}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          isCutting
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-accent-gold/10 text-accent-gold border border-accent-gold/20'
                        }`}>
                          {isCutting ? '✂ ' : ''}{machineName}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-text-primary/80">
                        <div>
                          <span>{displayNote}</span>
                          {workerText && (
                            <span className="block text-[10px] text-text-secondary/50 mt-0.5">Worker: {workerText}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-text-primary/80">{entry.size || '—'}</td>
                      <td className="px-5 py-3 text-right font-mono text-text-secondary/80">{gross.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono text-text-secondary/60">{tare.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-accent-gold">{net.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
