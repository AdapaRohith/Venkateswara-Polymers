import { useState } from 'react'

import api from '../../utils/api'
import { useToast } from '../Toast'
import useLiveData from '../../hooks/useLiveData'
import { apiError, locationLabel, nowIST } from '../../utils/ipms'
import { inputBase } from './styles'
import { EmptyState, Panel, ReverseButton, ShiftBadge, StatusBadge, Weight, td, th } from './Kit'

/** A day's entries for one section (EXTRUSION or CUTTING) with Day/Night totals. */
export default function ProductionEntries({ kind }) {
  const toast = useToast()
  const [date, setDate] = useState(nowIST().date)
  const { data } = useLiveData(
    () => api.get('/production/entries', { params: { kind, date_from: date, date_to: date } }).then((r) => r.data),
    [kind, date], ['production', 'stock'])
  const entries = data || []
  const active = entries.filter((e) => e.status === 'ACTIVE')
  const total = (shift, key) => active.filter((e) => !shift || e.shift === shift).reduce((s, e) => s + Number(e[key] || 0), 0)

  return (
    <Panel title={kind === 'EXTRUSION' ? 'Plant entries' : 'Cutting entries'}
      subtitle="Gross = everything off the machine; wastage is the scrap part; net goes into the store."
      actions={<input type="date" value={date} max={nowIST().date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputBase} w-auto`} aria-label="Entries for date" />}>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[['AM', 'Day'], ['PM', 'Night'], [null, 'Day & Night']].map(([shift, label]) => (
          <div key={label} className="rounded-lg border border-border-default px-3 py-2 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
            <p className="tabular-nums">Gross <Weight kg={total(shift, 'gross_kg')} /> · Waste <span className="text-rose-500"><Weight kg={total(shift, 'wastage_kg')} /></span></p>
            <p className="font-semibold">Net <Weight kg={total(shift, 'net_kg')} /></p>
          </div>
        ))}
      </div>
      {!entries.length ? <EmptyState>No entries for this date.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead><tr>
              <th className={th}>No.</th><th className={th}>Shift</th><th className={th}>Machine</th>
              <th className={th}>{kind === 'EXTRUSION' ? 'Roll size' : 'Roll → Finished'}</th>
              {kind === 'EXTRUSION' && <th className={th}>Materials used</th>}
              <th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Wastage</th><th className={`${th} text-right`}>Net</th>
              <th className={th}>Operator</th><th className={th}>Status</th><th className={th} />
            </tr></thead>
            <tbody className="divide-y divide-border-default">
              {entries.map((e) => (
                <tr key={e.id} className={e.status === 'REVERSED' ? 'opacity-50' : ''}>
                  <td className={`${td} font-mono text-xs`}>{e.doc_no}</td>
                  <td className={td}><ShiftBadge shift={e.shift} /></td>
                  <td className={`${td} font-semibold`}>{e.machine_name}</td>
                  <td className={td}>{kind === 'EXTRUSION' ? e.output_code : `${e.input_code} → ${e.output_code}`}</td>
                  {kind === 'EXTRUSION' && (
                    <td className={`${td} text-xs text-text-secondary`}>
                      {(e.inputs || []).map((i) => `${i.material_name} ${Number(i.quantity_kg).toLocaleString('en-IN')} kg (${locationLabel(i.location)})`).join(', ')}
                    </td>
                  )}
                  <td className={`${td} text-right`}><Weight kg={e.gross_kg} /></td>
                  <td className={`${td} text-right text-rose-500`}><Weight kg={e.wastage_kg} /></td>
                  <td className={`${td} text-right font-semibold`}><Weight kg={e.net_kg} /></td>
                  <td className={`${td} text-xs text-text-secondary`}>{e.worker_name || e.created_by_name}</td>
                  <td className={td}><StatusBadge status={e.status} /></td>
                  <td className={td}>{e.status === 'ACTIVE' && (
                    <ReverseButton onConfirm={async () => {
                      try { await api.delete(`/production/entries/${e.id}`); toast.success(`${e.doc_no} reversed`) } catch (err) { toast.error(apiError(err)) }
                    }} />
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
