import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Undo2 } from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import useStockMeta from '../hooks/useStockMeta'
import api from '../utils/api'
import { LOCATIONS, apiError, formatBusinessDate } from '../utils/ipms'
import { formatWeight, toKg } from '../utils/units'
import { EmptyState, LocationBadge, PageHeader, Panel, PrimaryButton, QuantityInput, ShiftBadge, ShiftDatePicker, StatusBadge, Weight } from '../components/ipms/Kit'
import { inputClass, inputInline, labelClass } from '../components/ipms/styles'

const RETURN_LOCATIONS = ['GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINE', 'WAREHOUSE']
const KEY_BY_LOCATION = { WAREHOUSE: 'warehouse_kg', GROUND_FLOOR: 'ground_floor_kg', FIRST_FLOOR: 'first_floor_kg' }

export default function StockReturns({ user }) {
  const toast = useToast()
  const meta = useStockMeta()
  const isOwner = String(user?.role || '').toLowerCase() !== 'worker'
  const [overview, setOverview] = useState(null)
  const [returns, setReturns] = useState([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    materialKey: '', location: 'GROUND_FLOOR', machine: '', qty: '', unit: 'bags',
    returnedTo: '', reason: '', date: '', shift: '',
  })
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    if (meta && !form.date) setForm((f) => ({ ...f, date: meta.live_business_date, shift: meta.live_shift }))
  }, [meta, form.date])

  const load = useCallback(async (q = '') => {
    try {
      const [{ data: ov }, { data: list }] = await Promise.all([
        api.get('/stock/overview'), api.get('/stock/returns', { params: q ? { q } : {} }),
      ])
      setOverview(ov)
      setReturns(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(apiError(error, 'Could not load returns'))
    }
  }, [toast])
  useEffect(() => { load() }, [load])
  useSSE(['stock'], () => load(query))

  const materials = overview?.materials || []
  const material = materials.find((m) => m.key === form.materialKey)
  const machines = meta?.machines || []
  const available = useMemo(() => {
    if (!material) return undefined
    if (form.location === 'MACHINE') {
      const a = (overview?.machine_allocations || []).find((x) => String(x.machine_id) === String(form.machine) && x.material_type_id === material.material_type_id)
      return a ? Number(a.quantity_kg) : 0
    }
    return Number(material[KEY_BY_LOCATION[form.location]] || 0)
  }, [material, form.location, form.machine, overview])
  const qtyKg = toKg(form.qty, form.unit)
  const valid = material && qtyKg > 0 && qtyKg <= (available ?? 0) + 1e-9 && form.reason.trim()
    && (form.location !== 'MACHINE' || form.machine)

  const submit = async (event) => {
    event.preventDefault()
    const where = form.location === 'MACHINE' ? machines.find((m) => String(m.id) === String(form.machine))?.name : LOCATIONS[form.location].label
    if (!window.confirm(`Return ${formatWeight(qtyKg)} of ${material.material_name} from ${where}? It leaves the site and is removed from stock and usage. It stays findable under Returns and Search.`)) return
    setBusy(true)
    try {
      const { data } = await api.post('/stock/returns', {
        material_type_id: material.material_type_id, material_id: material.material_id,
        quantity_kg: qtyKg, location: form.location,
        machine_id: form.location === 'MACHINE' ? Number(form.machine) : undefined,
        returned_to: form.returnedTo || undefined, reason: form.reason,
        business_date: form.date, shift: form.shift,
      })
      toast.success(`${data.return.return_no}: ${formatWeight(qtyKg)} returned`)
      set({ qty: '', reason: '', returnedTo: '' })
      load(query)
    } catch (error) {
      toast.error(apiError(error, 'Return failed'))
    } finally {
      setBusy(false)
    }
  }

  const totalReturned = returns.reduce((s, r) => s + Number(r.quantity_kg || 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader icon={Undo2} title="Return Stock"
        subtitle="Returned stock leaves the site completely — it is taken out of every location, never counts as usage, and is hidden from the everyday activity feed. It remains on record here and shows as RETURNED whenever it is searched for." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Panel title="Record a return" subtitle={isOwner ? 'Owner action' : 'Only an owner can record returns'}>
          {!isOwner ? <EmptyState>Ask an owner to record a return.</EmptyState> : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="rt-material">Material</label>
                <select id="rt-material" value={form.materialKey} onChange={(e) => set({ materialKey: e.target.value })} className={inputClass}>
                  <option value="">Select material…</option>
                  {materials.map((m) => <option key={m.key} value={m.key}>{m.material_name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="rt-location">Returned from</label>
                <select id="rt-location" value={form.location} onChange={(e) => set({ location: e.target.value, machine: '' })} className={inputClass}>
                  {RETURN_LOCATIONS.map((l) => <option key={l} value={l}>{LOCATIONS[l].label}</option>)}
                </select>
              </div>
              {form.location === 'MACHINE' && (
                <div>
                  <label className={labelClass} htmlFor="rt-machine">Machine</label>
                  <select id="rt-machine" value={form.machine} onChange={(e) => set({ machine: e.target.value })} className={inputClass}>
                    <option value="">Select machine…</option>
                    {machines.map((m) => <option key={m.id} value={m.id}>{m.name} · {LOCATIONS[m.floor]?.label}</option>)}
                  </select>
                </div>
              )}
              <QuantityInput value={form.qty} unit={form.unit} available={available} onChange={({ value, unit }) => set({ qty: value, unit })} />
              <ShiftDatePicker date={form.date} shift={form.shift} liveDate={meta?.live_business_date} liveShift={meta?.live_shift}
                onChange={({ date, shift }) => set({ date, shift })} />
              <div>
                <label className={labelClass} htmlFor="rt-to">Returned to</label>
                <input id="rt-to" value={form.returnedTo} onChange={(e) => set({ returnedTo: e.target.value })} className={inputClass} placeholder="Supplier / party (optional)" />
              </div>
              <div>
                <label className={labelClass} htmlFor="rt-reason">Reason</label>
                <textarea id="rt-reason" rows={2} value={form.reason} onChange={(e) => set({ reason: e.target.value })} className={inputClass} placeholder="Required — e.g. quality reject, excess issue" />
              </div>
              <PrimaryButton type="submit" disabled={!valid || busy} className="w-full bg-rose-600 hover:bg-rose-700 dark:text-white">
                <Undo2 className="h-4 w-4" />{busy ? 'Recording…' : 'Return stock'}
              </PrimaryButton>
            </form>
          )}
        </Panel>

        <Panel title="Returns register" subtitle={`${returns.length} record${returns.length === 1 ? '' : 's'} · ${formatWeight(totalReturned)} returned`} bodyClassName="p-0"
          actions={(
            <form onSubmit={(e) => { e.preventDefault(); load(query) }} className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-secondary" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search return no., material, party…" className={`${inputInline} w-64 pl-8`} aria-label="Search returns" />
            </form>
          )}>
          {returns.length === 0 ? <div className="p-4"><EmptyState>No returns found.</EmptyState></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
                    <th className="px-4 py-2.5">Return no.</th><th className="px-4 py-2.5">Day</th><th className="px-4 py-2.5">Material</th>
                    <th className="px-4 py-2.5">From</th><th className="px-4 py-2.5 text-right">Quantity</th><th className="px-4 py-2.5">To / reason</th><th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle">
                      <td className="px-4 py-2 font-mono text-xs text-text-primary">{r.return_no}</td>
                      <td className="px-4 py-2 text-xs text-text-secondary"><div>{formatBusinessDate(r.business_date, { weekday: false })}</div><ShiftBadge shift={r.shift} /></td>
                      <td className="px-4 py-2 font-medium text-text-primary">{r.material_name}</td>
                      <td className="px-4 py-2"><LocationBadge location={r.location} label={r.location_label} /></td>
                      <td className="px-4 py-2 text-right font-semibold"><Weight kg={r.quantity_kg} bags /></td>
                      <td className="px-4 py-2 text-xs text-text-secondary"><div className="text-text-primary">{r.returned_to || '—'}</div>{r.reason}<div className="mt-0.5">by {r.created_by_name || '—'}</div></td>
                      <td className="px-4 py-2"><StatusBadge status="RETURNED" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
