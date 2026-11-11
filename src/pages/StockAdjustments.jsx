import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import useEntryWhen from '../hooks/useEntryWhen'
import { apiError, entryWhenPayload, formatBusinessDate, locationLabel } from '../utils/ipms'
import { inputClass, labelClass } from '../components/ipms/styles'
import {
  EmptyState, LocationBadge, PageHeader, Panel, PrimaryButton, ReverseButton, ShiftBadge, ShiftDatePicker,
  StatusBadge, Weight, td, th,
} from '../components/ipms/Kit'

const REASONS = {
  COUNT: 'Physical stock count (set to counted quantity)',
  CORRECTION: 'Correction (add or remove)',
  RETURN: 'Return to supplier (remove)',
  DAMAGE: 'Damaged / written off (remove)',
}

export default function StockAdjustments() {
  const toast = useToast()
  const [when, setWhen] = useEntryWhen()
  const [store, setStore] = useState('GROUND_FLOOR')
  const [itemId, setItemId] = useState('')
  const [reasonType, setReasonType] = useState('COUNT')
  const [qty, setQty] = useState('')
  const [direction, setDirection] = useState('add')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const overview = useLiveData(() => api.get('/stock/overview').then((r) => r.data), [])
  const history = useLiveData(() => api.get('/adjustments').then((r) => r.data), [])
  const isMaterial = store === 'GROUND_FLOOR' || store === 'FIRST_FLOOR'
  const field = store === 'GROUND_FLOOR' ? 'ground_floor_kg' : 'first_floor_kg'
  const items = !overview.data ? [] : isMaterial
    ? overview.data.materials.map((m) => ({ id: m.id, label: m.name, kg: m[field] }))
    : (store === 'ROLL_STORE' ? overview.data.rolls : overview.data.finished).map((p) => ({ id: p.id, label: p.code, kg: p.quantity_kg }))
  const item = items.find((i) => String(i.id) === String(itemId))

  const submit = async () => {
    if (!item || qty === '' || !reason.trim()) { toast.error('Choose the item, quantity and reason'); return }
    setSaving(true)
    try {
      const { data } = await api.post('/adjustments', {
        item_kind: isMaterial ? 'MATERIAL' : 'PRODUCT',
        ...(isMaterial ? { material_id: item.id, location: store } : { product_id: item.id }),
        reason_type: reasonType, reason,
        ...(reasonType === 'COUNT' ? { counted_kg: Number(qty) } : { quantity_kg: Number(qty), direction }),
        ...entryWhenPayload(when),
      })
      const line = data.stock_receipt?.[0]
      toast.success(`${data.adjustment.doc_no}: ${item.label} ${line ? `${line.opening_kg} → ${line.closing_kg} kg` : ''}`)
      setQty(''); setReason('')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={ClipboardCheck} title="Stock Count / Adjust"
        subtitle="Owner corrections for any store: enter a physical count and the system posts the difference, or record a return / damage. Every adjustment needs a reason and stays in the ledger." />
      <Panel title="New adjustment">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="adj-store">Store</label>
            <select id="adj-store" className={inputClass} value={store} onChange={(e) => { setStore(e.target.value); setItemId('') }}>
              {['GROUND_FLOOR', 'FIRST_FLOOR', 'ROLL_STORE', 'FINISHED_STORE'].map((l) => <option key={l} value={l}>{locationLabel(l)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="adj-item">Item</label>
            <select id="adj-item" className={inputClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choose…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.label} — system {i.kg.toLocaleString('en-IN')} kg</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="adj-type">Type</label>
            <select id="adj-type" className={inputClass} value={reasonType} onChange={(e) => setReasonType(e.target.value)}>
              {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="adj-qty">{reasonType === 'COUNT' ? 'Counted quantity (kg)' : 'Quantity (kg)'}</label>
            <input id="adj-qty" type="number" min="0" step="any" className={inputClass} value={qty} onChange={(e) => setQty(e.target.value)} />
            {reasonType === 'COUNT' && item && qty !== '' && (
              <p className="mt-1 text-xs text-text-secondary">Difference: <Weight kg={Number(qty) - item.kg} signed /></p>
            )}
            {reasonType === 'CORRECTION' && (
              <div className="mt-1 flex gap-3 text-xs">
                {['add', 'remove'].map((d) => (
                  <label key={d} className="inline-flex items-center gap-1"><input type="radio" checked={direction === d} onChange={() => setDirection(d)} />{d === 'add' ? 'Add' : 'Remove'}</label>
                ))}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="adj-reason">Reason</label>
            <input id="adj-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Month-end physical count" />
          </div>
          <div className="md:col-span-3"><ShiftDatePicker {...when} onChange={setWhen} /></div>
        </div>
        <div className="mt-4 flex justify-end"><PrimaryButton onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Post adjustment'}</PrimaryButton></div>
      </Panel>

      <Panel title="Adjustments">
        {!history.data?.length ? <EmptyState>No adjustments yet.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr>
                <th className={th}>No.</th><th className={th}>Date</th><th className={th}>Item</th><th className={th}>Store</th><th className={th}>Type</th>
                <th className={`${th} text-right`}>Change</th><th className={th}>Reason</th><th className={th}>Status</th><th className={th} />
              </tr></thead>
              <tbody className="divide-y divide-border-default">
                {history.data.map((a) => (
                  <tr key={a.id} className={a.status === 'REVERSED' ? 'opacity-50' : ''}>
                    <td className={`${td} font-mono text-xs`}>{a.doc_no}</td>
                    <td className={td}><div className="flex items-center gap-2">{formatBusinessDate(a.business_date, { weekday: false })}<ShiftBadge shift={a.shift} /></div></td>
                    <td className={`${td} font-semibold`}>{a.item_name}</td>
                    <td className={td}><LocationBadge location={a.location} /></td>
                    <td className={`${td} text-xs`}>{a.reason_type}</td>
                    <td className={`${td} text-right`}><Weight kg={a.delta_kg} signed /></td>
                    <td className={`${td} text-xs text-text-secondary`}>{a.reason} · {a.created_by_name}</td>
                    <td className={td}><StatusBadge status={a.status} /></td>
                    <td className={td}>{a.status === 'ACTIVE' && (
                      <ReverseButton onConfirm={async () => {
                        try { await api.delete(`/adjustments/${a.id}`); toast.success(`${a.doc_no} reversed`) } catch (err) { toast.error(apiError(err)) }
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
