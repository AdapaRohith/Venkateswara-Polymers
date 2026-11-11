import { useState } from 'react'
import { ArrowLeftRight, ArrowRight } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import useEntryWhen from '../hooks/useEntryWhen'
import { apiError, entryWhenPayload, formatBusinessDate, locationLabel } from '../utils/ipms'
import { toKg } from '../utils/units'
import { inputClass, labelClass } from '../components/ipms/styles'
import {
  EmptyState, LocationBadge, PageHeader, Panel, PrimaryButton, QuantityInput, ReverseButton, SecondaryButton,
  ShiftBadge, ShiftDatePicker, StatusBadge, Weight, td, th,
} from '../components/ipms/Kit'

export default function StockTransfers() {
  const toast = useToast()
  const [when, setWhen] = useEntryWhen()
  const [from, setFrom] = useState('GROUND_FLOOR')
  const [materialId, setMaterialId] = useState('')
  const [qty, setQty] = useState({ value: '', unit: 'bags' })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const to = from === 'GROUND_FLOOR' ? 'FIRST_FLOOR' : 'GROUND_FLOOR'

  const materials = useLiveData(() => api.get('/materials').then((r) => r.data), [])
  const transfers = useLiveData(() => api.get('/transfers').then((r) => r.data), [])
  const field = from === 'GROUND_FLOOR' ? 'ground_floor_kg' : 'first_floor_kg'
  const options = (materials.data || []).filter((m) => m[field] > 0)
  const selected = options.find((m) => String(m.id) === String(materialId))
  const kg = toKg(qty.value, qty.unit)

  const submit = async () => {
    if (!selected || !kg) { toast.error('Choose the material and quantity'); return }
    setSaving(true)
    try {
      const { data } = await api.post('/transfers', {
        material_id: selected.id, from_location: from, to_location: to, quantity_kg: kg, note,
        ...entryWhenPayload(when),
      })
      toast.success(`${data.transfer.doc_no}: ${kg.toLocaleString('en-IN')} kg ${selected.name} moved to ${locationLabel(to)}`)
      setQty({ value: '', unit: qty.unit })
      setNote('')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={ArrowLeftRight} title="Move Material"
        subtitle="Carry raw material between the Ground Floor bay and the 1st Floor production running stock. The plant total does not change." />

      <Panel title="Move material">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <LocationBadge location={from} />
          <ArrowRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          <LocationBadge location={to} />
          <SecondaryButton className="px-2 py-1 text-xs" onClick={() => { setFrom(to); setMaterialId('') }}>
            <ArrowLeftRight className="h-3 w-3" />Swap direction
          </SecondaryButton>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="tr-mat">Material on {locationLabel(from)}</label>
            <select id="tr-mat" className={inputClass} value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((m) => <option key={m.id} value={m.id}>{m.name} — {m[field].toLocaleString('en-IN')} kg</option>)}
            </select>
            {!options.length && <p className="mt-1 text-xs text-text-secondary">Nothing in stock on the {locationLabel(from)}.</p>}
          </div>
          <QuantityInput value={qty.value} unit={qty.unit} onChange={setQty} available={selected?.[field]} />
          <div>
            <label className={labelClass} htmlFor="tr-note">Note</label>
            <input id="tr-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="md:col-span-3"><ShiftDatePicker {...when} onChange={setWhen} /></div>
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={submit} disabled={saving}>{saving ? 'Saving…' : `Move to ${locationLabel(to)}`}</PrimaryButton>
        </div>
      </Panel>

      <Panel title="Moves">
        {!transfers.data?.length ? <EmptyState>No moves yet.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr>
                <th className={th}>No.</th><th className={th}>Date</th><th className={th}>Material</th><th className={th}>Route</th>
                <th className={`${th} text-right`}>Quantity</th><th className={th}>By</th><th className={th}>Status</th><th className={th} />
              </tr></thead>
              <tbody className="divide-y divide-border-default">
                {transfers.data.map((t) => (
                  <tr key={t.id} className={t.status === 'REVERSED' ? 'opacity-50' : ''}>
                    <td className={`${td} font-mono text-xs`}>{t.doc_no}</td>
                    <td className={td}><div className="flex items-center gap-2">{formatBusinessDate(t.business_date, { weekday: false })}<ShiftBadge shift={t.shift} /></div></td>
                    <td className={td}>{t.material_name}</td>
                    <td className={td}><div className="flex items-center gap-1"><LocationBadge location={t.from_location} /><ArrowRight className="h-3 w-3" /><LocationBadge location={t.to_location} /></div></td>
                    <td className={`${td} text-right`}><Weight kg={t.quantity_kg} bags /></td>
                    <td className={`${td} text-xs text-text-secondary`}>{t.created_by_name}</td>
                    <td className={td}><StatusBadge status={t.status} /></td>
                    <td className={td}>{t.status === 'ACTIVE' && (
                      <ReverseButton onConfirm={async () => {
                        try { await api.delete(`/transfers/${t.id}`); toast.success(`${t.doc_no} reversed`) } catch (err) { toast.error(apiError(err)) }
                      }} />
                    )}</td>
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
