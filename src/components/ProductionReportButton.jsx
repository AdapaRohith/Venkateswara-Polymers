import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'

import { useToast } from './Toast'
import api from '../utils/api'
import { formatBusinessDate, liveShiftContext, shiftDate, shiftWindows } from '../utils/ipms'

const PRESETS = [
  ['Yesterday', (today) => [shiftDate(today, -1), shiftDate(today, -1)]],
  ['Today', (today) => [today, today]],
  ['Last 7 days', (today) => [shiftDate(today, -6), today]],
  ['This month', (today) => [`${today.slice(0, 8)}01`, today]],
  ['Last 30 days', (today) => [shiftDate(today, -29), today]],
]

async function blobErrorMessage(error) {
  const data = error?.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      if (typeof parsed?.detail === 'string') return parsed.detail
    } catch { /* not JSON */ }
  }
  return error?.message || 'Could not build the report'
}

/** Download the formatted multi-sheet production report for a date range. */
export default function ProductionReportButton({ className = '' }) {
  const toast = useToast()
  const today = liveShiftContext(shiftWindows(null)).date
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState(() => ({ from: shiftDate(today, -6), to: today }))
  const [busy, setBusy] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const download = async () => {
    if (!range.from || !range.to || range.from > range.to) {
      toast.error('Pick a start date on or before the end date')
      return
    }
    setBusy(true)
    try {
      const response = await api.get('/reports/production.xlsx', {
        params: { date_from: range.from, date_to: range.to },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `Production_Report_${range.from}_to_${range.to}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success(`Production report downloaded (${formatBusinessDate(range.from, { weekday: false })} – ${formatBusinessDate(range.to, { weekday: false })})`)
      setOpen(false)
    } catch (error) {
      toast.error(await blobErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`relative ${className}`} ref={panelRef}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300">
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
        Production Report (Excel)
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-border-default bg-bg-card p-4 shadow-xl">
          <p className="text-sm font-semibold text-text-primary">Production report</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Summary, shift × machine matrix, every entry with checks, opening/closing stock, batches,
            machine issues, wastage and corrections — one workbook.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map(([label, fn]) => (
              <button key={label} type="button" onClick={() => { const [from, to] = fn(today); setRange({ from, to }) }}
                className="rounded-full border border-border-default px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-accent-gold/60 hover:text-accent-gold">
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              From
              <input type="date" value={range.from} max={today} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-input px-2 py-1.5 text-sm text-text-primary" />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              To
              <input type="date" value={range.to} max={today} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-input px-2 py-1.5 text-sm text-text-primary" />
            </label>
          </div>
          <button type="button" onClick={download} disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Building report…' : 'Download .xlsx'}
          </button>
          <p className="mt-2 text-[11px] text-text-secondary">Up to 93 days per report. Dates are business dates (night shift counts on the day it started).</p>
        </div>
      )}
    </div>
  )
}
