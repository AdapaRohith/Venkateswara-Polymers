import { useMemo, useState } from 'react'
import { Factory, Plus, Trash2 } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import useEntryWhen from '../hooks/useEntryWhen'
import useStockMeta from '../hooks/useStockMeta'
import { apiError, entryWhenPayload } from '../utils/ipms'
import { formatWeight } from '../utils/units'
import { inputClass, labelClass } from '../components/ipms/styles'
import ProductionEntries from '../components/ipms/ProductionEntries'
import { PageHeader, Panel, PrimaryButton, SecondaryButton, ShiftDatePicker } from '../components/ipms/Kit'

const blankLine = () => ({ material_id: '', location: 'AUTO', quantity_kg: '' })

export function MachinePicker({ machines, value, onChange }) {
  return (
    <div>
      <span className={labelClass}>Machine</span>
      <div className="flex flex-wrap gap-2">
        {machines.map((m) => (
          <button key={m.id} type="button" onClick={() => onChange(String(m.id))}
            className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
              String(value) === String(m.id) ? 'border-accent-gold bg-accent-gold text-white dark:text-black' : 'border-border-default bg-bg-input text-text-primary hover:border-accent-gold/60'
            }`}>{m.name}</button>
        ))}
        {!machines.length && <span className="text-sm text-text-secondary">Loading machines…</span>}
      </div>
    </div>
  )
}

export function OutputFields({ gross, wastage, regrind, onChange, grossLabel = 'Gross weight (kg)' }) {
  const net = Math.max(Number(gross || 0) - Number(wastage || 0), 0)
  return (
    <>
      <div>
        <label className={labelClass} htmlFor="out-gross">{grossLabel}</label>
        <input id="out-gross" type="number" min="0" step="any" className={inputClass} value={gross} onChange={(e) => onChange({ gross: e.target.value })} />
      </div>
      <div>
        <label className={labelClass} htmlFor="out-waste">Wastage (kg)</label>
        <input id="out-waste" type="number" min="0" step="any" className={inputClass} value={wastage} onChange={(e) => onChange({ wastage: e.target.value })} />
        <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-secondary">
          <input type="checkbox" checked={regrind} onChange={(e) => onChange({ regrind: e.target.checked })} />
          Send wastage to RP REGRIND (1st Floor)
        </label>
      </div>
      <div>
        <span className={labelClass}>Net into store</span>
        <p className="rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm font-bold tabular-nums">{formatWeight(net)}</p>
      </div>
    </>
  )
}

export default function Production() {
  const toast = useToast()
  const meta = useStockMeta()
  const [when, setWhen] = useEntryWhen()
  const [machineId, setMachineId] = useState('')
  const [size, setSize] = useState('')
  const [out, setOut] = useState({ gross: '', wastage: '', regrind: true })
  const [lines, setLines] = useState([blankLine()])
  const [worker, setWorker] = useState('')
  const [saving, setSaving] = useState(false)

  const machines = useMemo(() => (meta?.machines || []).filter((m) => m.type === 'production'), [meta])
  const materials = useLiveData(() => api.get('/materials').then((r) => r.data), [])
  const rolls = useLiveData(() => api.get('/products', { params: { kind: 'ROLL' } }).then((r) => r.data), [])
  const mats = (materials.data || []).filter((m) => m.active && m.total_kg > 0)

  const gross = Number(out.gross || 0)
  const single = lines.length === 1
  const used = single ? gross : lines.reduce((s, l) => s + Number(l.quantity_kg || 0), 0)
  const mismatch = !single && gross > 0 && Math.abs(used - gross) > 0.001
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const submit = async () => {
    if (!machineId || !size.trim() || !gross || lines.some((l) => !l.material_id)) {
      toast.error('Choose the machine, roll size, gross weight and the materials used')
      return
    }
    if (mismatch) { toast.error('Materials used must add up to the gross weight'); return }
    setSaving(true)
    try {
      const { data } = await api.post('/production/extrusion', {
        machine_id: Number(machineId), output_size: size, gross_kg: gross, wastage_kg: Number(out.wastage || 0),
        wastage_to_regrind: out.regrind, worker_name: worker,
        inputs: lines.map((l) => ({ material_id: Number(l.material_id), location: l.location, quantity_kg: single ? gross : Number(l.quantity_kg) })),
        ...entryWhenPayload(when),
      })
      toast.success(`${data.entry.doc_no}: ${data.entry.machine_name} · ${data.entry.output_code} · net ${formatWeight(data.entry.net_kg)} to Roll Store`)
      setOut({ gross: '', wastage: '', regrind: out.regrind })
      setLines((ls) => ls.map((l) => ({ ...l, quantity_kg: '' })))
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Factory} title="Plant Production (Rolls)"
        subtitle="Extruders MCN-1 to MCN-5 turn the resin blend into film rolls. Material is used from the 1st Floor running stock first, then the Ground Floor; net roll weight goes into the Roll Store." />

      <Panel title="Log a roll">
        <div className="space-y-4">
          <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="pp-size">Roll size</label>
              <input id="pp-size" list="roll-sizes" className={inputClass} value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 25*30*50MIC" />
              <datalist id="roll-sizes">{(rolls.data || []).map((r) => <option key={r.id} value={r.code} />)}</datalist>
            </div>
            <OutputFields gross={out.gross} wastage={out.wastage} regrind={out.regrind} onChange={(p) => setOut((o) => ({ ...o, ...p }))} />
          </div>

          <div className="rounded-lg border border-border-default p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Materials used (blend)</span>
              <SecondaryButton className="px-2 py-1 text-xs" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus className="h-3 w-3" />Add material</SecondaryButton>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const m = mats.find((x) => String(x.id) === String(l.material_id))
                return (
                  <div key={i} className="grid items-end gap-2 md:grid-cols-[2fr_1.4fr_1fr_auto]">
                    <select aria-label={`Material ${i + 1}`} className={inputClass} value={l.material_id} onChange={(e) => setLine(i, { material_id: e.target.value })}>
                      <option value="">Choose material…</option>
                      {mats.map((x) => <option key={x.id} value={x.id}>{x.name} — 1F {x.first_floor_kg.toLocaleString('en-IN')} · GF {x.ground_floor_kg.toLocaleString('en-IN')} kg</option>)}
                    </select>
                    <select aria-label={`Take from ${i + 1}`} className={inputClass} value={l.location} onChange={(e) => setLine(i, { location: e.target.value })}>
                      <option value="AUTO">Auto: 1st Floor, then Ground</option>
                      <option value="FIRST_FLOOR">1st Floor only{m ? ` (${m.first_floor_kg.toLocaleString('en-IN')} kg)` : ''}</option>
                      <option value="GROUND_FLOOR">Ground Floor only{m ? ` (${m.ground_floor_kg.toLocaleString('en-IN')} kg)` : ''}</option>
                    </select>
                    {single
                      ? <p className="px-1 py-2 text-xs text-text-secondary">Uses the full gross: <strong>{formatWeight(gross)}</strong></p>
                      : <input aria-label={`Quantity ${i + 1}`} type="number" min="0" step="any" placeholder="kg" className={inputClass} value={l.quantity_kg} onChange={(e) => setLine(i, { quantity_kg: e.target.value })} />}
                    <button type="button" aria-label="Remove material" disabled={single} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      className="rounded-md p-2 text-text-secondary hover:text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )
              })}
            </div>
            {!single && (
              <p className={`mt-2 text-xs ${mismatch ? 'text-rose-500' : 'text-text-secondary'}`}>
                Blend total {formatWeight(used)} {mismatch ? `— must equal the gross ${formatWeight(gross)}` : '= gross'}
              </p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="pp-worker">Operator</label>
              <input id="pp-worker" className={inputClass} value={worker} onChange={(e) => setWorker(e.target.value)} />
            </div>
            <div className="md:col-span-3"><ShiftDatePicker {...when} onChange={setWhen} /></div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={submit} disabled={saving || mismatch}>{saving ? 'Saving…' : 'Log roll'}</PrimaryButton>
        </div>
      </Panel>

      <ProductionEntries kind="EXTRUSION" />
    </div>
  )
}
