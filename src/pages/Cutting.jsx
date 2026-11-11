import { useMemo, useState } from 'react'
import { Scissors } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import useEntryWhen from '../hooks/useEntryWhen'
import useStockMeta from '../hooks/useStockMeta'
import { apiError, entryWhenPayload } from '../utils/ipms'
import { formatWeight } from '../utils/units'
import { inputClass, labelClass } from '../components/ipms/styles'
import ProductionEntries from '../components/ipms/ProductionEntries'
import { PageHeader, Panel, PrimaryButton, ShiftDatePicker } from '../components/ipms/Kit'
import { MachinePicker, OutputFields } from './Production'

export default function Cutting() {
  const toast = useToast()
  const meta = useStockMeta()
  const [when, setWhen] = useEntryWhen()
  const [machineId, setMachineId] = useState('')
  const [rollId, setRollId] = useState('')
  const [size, setSize] = useState('')
  const [out, setOut] = useState({ gross: '', wastage: '', regrind: true })
  const [worker, setWorker] = useState('')
  const [saving, setSaving] = useState(false)

  const machines = useMemo(() => (meta?.machines || []).filter((m) => m.type === 'cutting'), [meta])
  const products = useLiveData(() => api.get('/products').then((r) => r.data), [])
  const rolls = (products.data || []).filter((p) => p.kind === 'ROLL' && p.quantity_kg > 0)
  const finished = (products.data || []).filter((p) => p.kind === 'FINISHED')
  const roll = rolls.find((r) => String(r.id) === String(rollId))
  const gross = Number(out.gross || 0)
  const over = roll && gross > roll.quantity_kg + 1e-9

  const submit = async () => {
    if (!machineId || !roll || !size.trim() || !gross) {
      toast.error('Choose the machine, the roll used, the output size and the weight')
      return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/production/cutting', {
        machine_id: Number(machineId), input_product_id: roll.id, output_size: size, gross_kg: gross,
        wastage_kg: Number(out.wastage || 0), wastage_to_regrind: out.regrind, worker_name: worker,
        ...entryWhenPayload(when),
      })
      toast.success(`${data.entry.doc_no}: ${data.entry.input_code} → ${data.entry.output_code} · net ${formatWeight(data.entry.net_kg)} to Finished Goods`)
      setOut({ gross: '', wastage: '', regrind: out.regrind })
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Scissors} title="Cutting (Finished Goods)"
        subtitle="Cutting machines use rolls from the Roll Store — never raw resin. Net cut weight goes into the Finished Goods Store; trim can go back as RP REGRIND." />

      <Panel title="Log a cutting run">
        <div className="space-y-4">
          <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="ct-roll">Roll used (from Roll Store)</label>
              <select id="ct-roll" className={inputClass} value={rollId} onChange={(e) => setRollId(e.target.value)}>
                <option value="">Choose roll…</option>
                {rolls.map((r) => <option key={r.id} value={r.id}>{r.code} — {formatWeight(r.quantity_kg)} in store</option>)}
              </select>
              {!rolls.length && <p className="mt-1 text-xs text-text-secondary">The Roll Store is empty — log plant production first.</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="ct-size">Finished size</label>
              <input id="ct-size" list="fg-sizes" className={inputClass} value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 8*12*110MIC" />
              <datalist id="fg-sizes">{finished.map((p) => <option key={p.id} value={p.code} />)}</datalist>
            </div>
            <div>
              <label className={labelClass} htmlFor="ct-worker">Operator</label>
              <input id="ct-worker" className={inputClass} value={worker} onChange={(e) => setWorker(e.target.value)} />
            </div>
            <OutputFields gross={out.gross} wastage={out.wastage} regrind={out.regrind} grossLabel="Rolls used / gross (kg)"
              onChange={(p) => setOut((o) => ({ ...o, ...p }))} />
          </div>
          {over && <p className="text-sm text-rose-500">Only {formatWeight(roll.quantity_kg)} of {roll.code} is in the Roll Store.</p>}
          <ShiftDatePicker {...when} onChange={setWhen} />
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={submit} disabled={saving || over}>{saving ? 'Saving…' : 'Log cutting run'}</PrimaryButton>
        </div>
      </Panel>

      <ProductionEntries kind="CUTTING" />
    </div>
  )
}
