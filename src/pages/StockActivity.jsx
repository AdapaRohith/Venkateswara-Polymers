import { useState } from 'react'
import { BookOpenCheck } from 'lucide-react'

import api from '../utils/api'
import useLiveData from '../hooks/useLiveData'
import { DOC_LABELS, formatBusinessDate, LOCATIONS, nowIST, shiftDate } from '../utils/ipms'
import { exportSingleSheet } from '../utils/exportToExcel'
import { inputBase } from '../components/ipms/styles'
import { EmptyState, LocationBadge, PageHeader, Panel, SecondaryButton, ShiftBadge, Weight, td, th } from '../components/ipms/Kit'

/** Every stock movement, newest first. Read-only: corrections are reversals on the source page. */
export default function StockActivity() {
  const today = nowIST().date
  const [from, setFrom] = useState(shiftDate(today, -6))
  const [to, setTo] = useState(today)
  const [location, setLocation] = useState('')
  const [docType, setDocType] = useState('')
  const { data } = useLiveData(() => api.get('/stock/ledger', {
    params: { date_from: from, date_to: to, ...(location ? { location } : {}), ...(docType ? { doc_type: docType } : {}), limit: 2000 },
  }).then((r) => r.data), [from, to, location, docType], ['stock', 'production'])
  const rows = data || []

  return (
    <div className="space-y-6">
      <PageHeader icon={BookOpenCheck} title="Stock Ledger"
        subtitle="Every kilogram in and out of every store, with the balance after each movement. Mistakes are corrected by reversing the entry on its own page — the reversal shows here too." />
      <Panel title={`${rows.length} movements`} actions={<>
        <input type="date" aria-label="From" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputBase} w-auto`} />
        <input type="date" aria-label="To" value={to} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputBase} w-auto`} />
        <select aria-label="Store" value={location} onChange={(e) => setLocation(e.target.value)} className={`${inputBase} w-auto`}>
          <option value="">All stores</option>
          {['GROUND_FLOOR', 'FIRST_FLOOR', 'ROLL_STORE', 'FINISHED_STORE'].map((l) => <option key={l} value={l}>{LOCATIONS[l].label}</option>)}
        </select>
        <select aria-label="Type" value={docType} onChange={(e) => setDocType(e.target.value)} className={`${inputBase} w-auto`}>
          <option value="">All types</option>
          {Object.entries(DOC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <SecondaryButton disabled={!rows.length} onClick={() => exportSingleSheet({
          filename: `Stock_Ledger_${from}_to_${to}`, sheetName: 'Stock Ledger',
          rows: rows.map((r) => ({ ...r, type: `${DOC_LABELS[r.doc_type] || r.doc_type}${r.is_reversal ? ' (reversal)' : ''}`, store: LOCATIONS[r.location]?.label })),
          columns: [
            { key: 'business_date', label: 'Date' }, { key: 'shift', label: 'Shift' }, { key: 'doc_no', label: 'Document' },
            { key: 'type', label: 'Type' }, { key: 'item_name', label: 'Item' }, { key: 'store', label: 'Store' },
            { key: 'delta_kg', label: 'Change (kg)' }, { key: 'balance_after_kg', label: 'Balance after (kg)' },
            { key: 'note', label: 'Note' }, { key: 'created_by_name', label: 'By' },
          ],
        })}>Export</SecondaryButton>
      </>}>
        {!rows.length ? <EmptyState>No stock movements in this period.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr>
                <th className={th}>Date</th><th className={th}>Document</th><th className={th}>Item</th><th className={th}>Store</th>
                <th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>Balance after</th><th className={th}>Note</th><th className={th}>By</th>
              </tr></thead>
              <tbody className="divide-y divide-border-default">
                {rows.map((r) => (
                  <tr key={r.id} className={r.is_reversal ? 'bg-rose-500/5' : ''}>
                    <td className={td}><div className="flex items-center gap-2 whitespace-nowrap">{formatBusinessDate(r.business_date, { weekday: false })}<ShiftBadge shift={r.shift} /></div></td>
                    <td className={td}><span className="font-mono text-xs">{r.doc_no}</span><div className="text-[11px] text-text-secondary">{DOC_LABELS[r.doc_type]}{r.is_reversal ? ' · reversal' : ''}</div></td>
                    <td className={`${td} font-semibold`}>{r.item_name}</td>
                    <td className={td}><LocationBadge location={r.location} /></td>
                    <td className={`${td} text-right`}><Weight kg={r.delta_kg} signed /></td>
                    <td className={`${td} text-right`}><Weight kg={r.balance_after_kg} /></td>
                    <td className={`${td} text-xs text-text-secondary`}>{r.note || '—'}</td>
                    <td className={`${td} text-xs text-text-secondary`}>{r.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
