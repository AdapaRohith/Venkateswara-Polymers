import { useMemo, useState } from 'react'
import { PackagePlus, Pencil } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import useEntryWhen from '../hooks/useEntryWhen'
import { apiError, entryWhenPayload, formatBusinessDate, locationLabel, MATERIAL_LOCATIONS } from '../utils/ipms'
import { toKg } from '../utils/units'
import { inputClass, labelClass } from '../components/ipms/styles'
import {
  EmptyState, LocationBadge, PageHeader, Panel, PrimaryButton, QuantityInput, ReverseButton, SecondaryButton,
  ShiftBadge, ShiftDatePicker, StatusBadge, StockStatusBadge, Weight, td, th,
} from '../components/ipms/Kit'

const NEW = '__new__'

export default function RawMaterial({ user }) {
  const toast = useToast()
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'
  const [when, setWhen] = useEntryWhen()
  const [form, setForm] = useState({ material: '', newName: '', newBrand: '', location: 'GROUND_FLOOR', batch: '', supplier: '', note: '' })
  const [qty, setQty] = useState({ value: '', unit: 'bags' })
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)

  const materials = useLiveData(() => api.get('/materials').then((r) => r.data), [])
  const receipts = useLiveData(() => api.get('/receipts').then((r) => r.data), [])
  const list = useMemo(() => materials.data || [], [materials.data])
  const kg = toKg(qty.value, qty.unit)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const submit = async () => {
    if (!form.material || (form.material === NEW && !form.newName.trim()) || !kg) {
      toast.error('Choose the material and enter the quantity')
      return
    }
    setSaving(true)
    try {
      const body = {
        ...(form.material === NEW
          ? { material_name: form.newName.trim(), brand: form.newBrand.trim() }
          : { material_id: Number(form.material) }),
        location: form.location, quantity_kg: kg, batch_no: form.batch, supplier: form.supplier, note: form.note,
        ...entryWhenPayload(when),
      }
      const { data } = await api.post('/receipts', body)
      const line = data.stock_receipt?.[0]
      toast.success(`${data.receipt.doc_no}: ${data.receipt.material_name} received — ${locationLabel(form.location)} now ${line ? line.closing_kg.toLocaleString('en-IN') : ''} kg`)
      setQty({ value: '', unit: qty.unit })
      set({ batch: '', note: '', ...(form.material === NEW ? { material: '', newName: '', newBrand: '' } : {}) })
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  const reverse = async (r) => {
    try {
      await api.delete(`/receipts/${r.id}`)
      toast.success(`${r.doc_no} reversed`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={PackagePlus} title="Raw Material In"
        subtitle="Material arriving at the plant. It lands on the Ground Floor raw material bay (or straight on the 1st Floor). 1 bag = 25 kg." />

      <Panel title="Receive material">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className={labelClass} htmlFor="rm-material">Material</label>
            <select id="rm-material" className={inputClass} value={form.material} onChange={(e) => set({ material: e.target.value })}>
              <option value="">Choose…</option>
              {list.filter((m) => m.active).map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.brand ? ` · ${m.brand}` : ''} — {m.total_kg.toLocaleString('en-IN')} kg in plant</option>
              ))}
              {isOwner && <option value={NEW}>+ New material…</option>}
            </select>
          </div>
          {form.material === NEW && (
            <>
              <div>
                <label className={labelClass} htmlFor="rm-new">New material name</label>
                <input id="rm-new" className={inputClass} value={form.newName} onChange={(e) => set({ newName: e.target.value })} placeholder="e.g. OPALENE LLDPE" />
              </div>
              <div>
                <label className={labelClass} htmlFor="rm-brand">Brand / type</label>
                <input id="rm-brand" className={inputClass} value={form.newBrand} onChange={(e) => set({ newBrand: e.target.value })} placeholder="LLDPE, HDPE, LINER FILLER…" />
              </div>
            </>
          )}
          <QuantityInput label="Quantity" value={qty.value} unit={qty.unit} onChange={setQty} />
          <div>
            <label className={labelClass} htmlFor="rm-loc">Received into</label>
            <select id="rm-loc" className={inputClass} value={form.location} onChange={(e) => set({ location: e.target.value })}>
              {MATERIAL_LOCATIONS.map((l) => <option key={l} value={l}>{locationLabel(l)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="rm-batch">Batch no.</label>
            <input id="rm-batch" className={inputClass} value={form.batch} onChange={(e) => set({ batch: e.target.value })} placeholder="VIPRM-01" />
          </div>
          <div>
            <label className={labelClass} htmlFor="rm-sup">Supplier</label>
            <input id="rm-sup" className={inputClass} value={form.supplier} onChange={(e) => set({ supplier: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="rm-note">Note</label>
            <input id="rm-note" className={inputClass} value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          <div className="md:col-span-2 xl:col-span-4"><ShiftDatePicker {...when} onChange={setWhen} /></div>
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Receive material'}</PrimaryButton>
        </div>
      </Panel>

      <Panel title="Received entries" subtitle="Reverse an entry made by mistake; the reversal stays in the stock ledger.">
        {!receipts.data?.length ? <EmptyState>No material received yet.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr>
                <th className={th}>No.</th><th className={th}>Date</th><th className={th}>Material</th><th className={th}>Batch</th>
                <th className={th}>Into</th><th className={`${th} text-right`}>Quantity</th><th className={th}>By</th><th className={th}>Status</th><th className={th} />
              </tr></thead>
              <tbody className="divide-y divide-border-default">
                {receipts.data.map((r) => (
                  <tr key={r.id} className={r.status === 'REVERSED' ? 'opacity-50' : ''}>
                    <td className={`${td} font-mono text-xs`}>{r.doc_no}</td>
                    <td className={td}><div className="flex items-center gap-2">{formatBusinessDate(r.business_date, { weekday: false })}<ShiftBadge shift={r.shift} /></div></td>
                    <td className={td}>{r.material_name}<div className="text-xs text-text-secondary">{r.brand}{r.supplier ? ` · ${r.supplier}` : ''}</div></td>
                    <td className={td}>{r.batch_no || '—'}</td>
                    <td className={td}><LocationBadge location={r.location} /></td>
                    <td className={`${td} text-right`}><Weight kg={r.quantity_kg} bags /></td>
                    <td className={`${td} text-xs text-text-secondary`}>{r.created_by_name}</td>
                    <td className={td}><StatusBadge status={r.status} /></td>
                    <td className={td}>{r.status === 'ACTIVE' && <ReverseButton onConfirm={() => reverse(r)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {isOwner && (
        <Panel title="Material master" subtitle="Names, brand and stock alert levels. Blank levels use the plant-wide 10 t / 20 t bands.">
          {!list.length ? <EmptyState>No materials yet — add one when receiving.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border-default">
                <thead><tr>
                  <th className={th}>Material</th><th className={th}>Brand</th><th className={`${th} text-right`}>Ground</th>
                  <th className={`${th} text-right`}>1st Floor</th><th className={`${th} text-right`}>Total</th><th className={th}>Status</th>
                  <th className={`${th} text-right`}>Reorder below</th><th className={`${th} text-right`}>Optimal above</th><th className={th} />
                </tr></thead>
                <tbody className="divide-y divide-border-default">
                  {list.map((m) => editing?.id === m.id ? (
                    <MaterialEditRow key={m.id} value={editing} onChange={setEditing} onCancel={() => setEditing(null)}
                      onSave={async () => {
                        try {
                          await api.put(`/materials/${m.id}`, {
                            name: editing.name, brand: editing.brand, active: editing.active,
                            reorder_below_kg: editing.reorder_below_kg === '' ? null : Number(editing.reorder_below_kg) * 1000,
                            optimal_above_kg: editing.optimal_above_kg === '' ? null : Number(editing.optimal_above_kg) * 1000,
                          })
                          setEditing(null)
                          toast.success('Material updated')
                        } catch (err) { toast.error(apiError(err)) }
                      }} />
                  ) : (
                    <tr key={m.id} className={m.active ? '' : 'opacity-50'}>
                      <td className={`${td} font-medium`}>{m.name}</td>
                      <td className={td}>{m.brand || '—'}</td>
                      <td className={`${td} text-right`}><Weight kg={m.ground_floor_kg} /></td>
                      <td className={`${td} text-right`}><Weight kg={m.first_floor_kg} /></td>
                      <td className={`${td} text-right font-semibold`}><Weight kg={m.total_kg} /></td>
                      <td className={td}><StockStatusBadge status={m.status} /></td>
                      <td className={`${td} text-right text-xs`}>{m.reorder_below_kg != null ? `${m.reorder_below_kg / 1000} t` : 'default'}</td>
                      <td className={`${td} text-right text-xs`}>{m.optimal_above_kg != null ? `${m.optimal_above_kg / 1000} t` : 'default'}</td>
                      <td className={td}>
                        <SecondaryButton className="px-2 py-1 text-xs" onClick={() => setEditing({
                          id: m.id, name: m.name, brand: m.brand, active: m.active,
                          reorder_below_kg: m.reorder_below_kg != null ? m.reorder_below_kg / 1000 : '',
                          optimal_above_kg: m.optimal_above_kg != null ? m.optimal_above_kg / 1000 : '',
                        })}><Pencil className="h-3 w-3" />Edit</SecondaryButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function MaterialEditRow({ value, onChange, onSave, onCancel }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const small = `${inputClass} py-1`
  return (
    <tr className="bg-bg-input/40">
      <td className={td}><input className={small} value={value.name} onChange={(e) => set({ name: e.target.value })} aria-label="Material name" /></td>
      <td className={td}><input className={small} value={value.brand} onChange={(e) => set({ brand: e.target.value })} aria-label="Brand" /></td>
      <td className={td} colSpan={3}>
        <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={value.active} onChange={(e) => set({ active: e.target.checked })} /> In use
        </label>
      </td>
      <td className={td} />
      <td className={td}><input className={small} type="number" min="0" step="any" placeholder="t" value={value.reorder_below_kg} onChange={(e) => set({ reorder_below_kg: e.target.value })} aria-label="Reorder below (tons)" /></td>
      <td className={td}><input className={small} type="number" min="0" step="any" placeholder="t" value={value.optimal_above_kg} onChange={(e) => set({ optimal_above_kg: e.target.value })} aria-label="Optimal above (tons)" /></td>
      <td className={td}>
        <div className="flex gap-1">
          <PrimaryButton className="px-2 py-1 text-xs" onClick={onSave}>Save</PrimaryButton>
          <SecondaryButton className="px-2 py-1 text-xs" onClick={onCancel}>Cancel</SecondaryButton>
        </div>
      </td>
    </tr>
  )
}
