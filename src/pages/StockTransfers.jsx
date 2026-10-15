import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, ArrowRight, RotateCcw } from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import useStockMeta from '../hooks/useStockMeta'
import api from '../utils/api'
import {
  LOCATIONS, allowedDestinations, apiError, formatBusinessDate, locationLabel, machinesForFloor,
} from '../utils/ipms'
import { formatWeight, toKg } from '../utils/units'
import { EmptyState, LocationBadge, PageHeader, Panel, PrimaryButton, QuantityInput, SecondaryButton, ShiftBadge, ShiftDatePicker, StatusBadge, Weight } from '../components/ipms/Kit'
import { inputClass, labelClass } from '../components/ipms/styles'

const SOURCES = ['WAREHOUSE', 'GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINE']
const KEY_BY_LOCATION = { WAREHOUSE: 'warehouse_kg', GROUND_FLOOR: 'ground_floor_kg', FIRST_FLOOR: 'first_floor_kg' }

function availableAt(material, location, machineId, allocations) {
  if (!material) return null
  if (location === 'MACHINE') {
    const a = allocations.find((x) => String(x.machine_id) === String(machineId) && x.material_type_id === material.material_type_id)
    return a ? Number(a.quantity_kg) : 0
  }
  return Number(material[KEY_BY_LOCATION[location]] || 0)
}

export default function StockTransfers({ user }) {
  const toast = useToast()
  const meta = useStockMeta()
  const [params] = useSearchParams()
  const machines = useMemo(() => meta?.machines || [], [meta])
  const [overview, setOverview] = useState(null)
  const [transfers, setTransfers] = useState([])
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [form, setForm] = useState(() => ({
    materialKey: '',
    from: params.get('from') || 'WAREHOUSE',
    fromMachine: params.get('fromMachine') || '',
    to: params.get('to') || 'GROUND_FLOOR',
    toMachine: params.get('toMachine') || '',
    qty: '', unit: 'kg', note: '', date: '', shift: '',
  }))

  useEffect(() => {
    if (meta && !form.date) setForm((f) => ({ ...f, date: meta.live_business_date, shift: meta.live_shift }))
  }, [meta, form.date])

  const load = useCallback(async () => {
    try {
      const [{ data: ov }, { data: list }] = await Promise.all([
        api.get('/stock/overview'), api.get('/stock/transfers', { params: { limit: 300 } }),
      ])
      setOverview(ov)
      setTransfers(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(apiError(error, 'Could not load transfers'))
    }
  }, [toast])
  useEffect(() => { load() }, [load])
  useSSE(['stock', 'floor_stock', 'raw_material', 'production'], load)

  const materials = overview?.materials || []
  const allocations = overview?.machine_allocations || []
  const material = materials.find((m) => m.key === form.materialKey)
  const destinations = allowedDestinations(form.from, machines, form.fromMachine)
  const to = destinations.includes(form.to) ? form.to : destinations[0] || ''
  const fromFloorMachines = form.from === 'MACHINE' ? machines : []
  const toMachines = to === 'MACHINE' ? machinesForFloor(machines, form.from) : []
  const qtyKg = toKg(form.qty, form.unit)
  const available = availableAt(material, form.from, form.fromMachine, allocations)
  const destinationNow = to && material ? availableAt(material, to, form.toMachine, allocations) : null
  const machineName = (id) => machines.find((m) => String(m.id) === String(id))?.name

  const problems = []
  if (!material) problems.push('Choose a material')
  if (form.from === 'MACHINE' && !form.fromMachine) problems.push('Choose the machine to release from')
  if (to === 'MACHINE' && !form.toMachine) problems.push('Choose the machine to assign to')
  if (!qtyKg || qtyKg <= 0) problems.push('Enter a quantity')
  else if (available !== null && qtyKg > available + 1e-9) problems.push(`Only ${formatWeight(available)} available at ${locationLabel(form.from, machineName(form.fromMachine))}`)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const submit = async (event) => {
    event.preventDefault()
    if (problems.length) return
    setBusy(true)
    try {
      const { data } = await api.post('/stock/transfers', {
        material_type_id: material.material_type_id,
        material_id: material.material_id,
        quantity_kg: qtyKg,
        from_location: form.from,
        from_machine_id: form.from === 'MACHINE' ? Number(form.fromMachine) : undefined,
        to_location: to,
        to_machine_id: to === 'MACHINE' ? Number(form.toMachine) : undefined,
        business_date: form.date, shift: form.shift, note: form.note || undefined,
      })
      setReceipt(data)
      set({ qty: '', note: '' })
      toast.success(`${data.transfer.transfer_no}: ${formatWeight(qtyKg)} moved ${data.transfer.route}`)
      load()
    } catch (error) {
      toast.error(apiError(error, 'Transfer failed'))
    } finally {
      setBusy(false)
    }
  }

  const reverse = async (t) => {
    if (!window.confirm(`Reverse ${t.transfer_no}? ${formatWeight(t.quantity_kg)} of ${t.material_name} goes back from ${t.route.split(' → ')[1]} to ${t.route.split(' → ')[0]}. The reversal stays in Stock Activity.`)) return
    try {
      await api.delete(`/stock/transfers/${t.id}`)
      toast.success(`${t.transfer_no} reversed`)
      load()
    } catch (error) {
      toast.error(apiError(error, 'Could not reverse'))
    }
  }

  const canReverse = (t) => t.status === 'ACTIVE' && (String(user?.role).toLowerCase() !== 'worker' || String(t.created_by) === String(user?.id))

  const grouped = useMemo(() => {
    const groups = new Map()
    for (const t of transfers) {
      const key = String(t.business_date).slice(0, 10)
      groups.set(key, [...(groups.get(key) || []), t])
    }
    return [...groups.entries()]
  }, [transfers])

  return (
    <div className="space-y-5">
      <PageHeader icon={ArrowLeftRight} title="Stock Transfers"
        subtitle="Move stock between the Warehouse, Ground Floor, First Floor and machines. The source goes down and the destination goes up by exactly the same amount — the plant total never changes." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
        <Panel title="New transfer">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="tr-material">Material</label>
              <select id="tr-material" value={form.materialKey} onChange={(e) => set({ materialKey: e.target.value })} className={inputClass}>
                <option value="">Select material…</option>
                {materials.map((m) => <option key={m.key} value={m.key}>{m.material_name} — {formatWeight(m.plant_kg)} in plant</option>)}
              </select>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <label className={labelClass} htmlFor="tr-from">From</label>
                <select id="tr-from" value={form.from} onChange={(e) => set({ from: e.target.value, fromMachine: '', toMachine: '' })} className={inputClass}>
                  {SOURCES.map((s) => <option key={s} value={s}>{LOCATIONS[s].label}</option>)}
                </select>
              </div>
              <ArrowRight className="mb-2.5 h-4 w-4 text-text-secondary" />
              <div>
                <label className={labelClass} htmlFor="tr-to">To</label>
                <select id="tr-to" value={to} onChange={(e) => set({ to: e.target.value, toMachine: '' })} className={inputClass} disabled={!destinations.length}>
                  {destinations.map((s) => <option key={s} value={s}>{s === 'MACHINE' ? `Machine on ${LOCATIONS[form.from].label}` : LOCATIONS[s].label}</option>)}
                </select>
              </div>
            </div>

            {form.from === 'MACHINE' && (
              <div>
                <label className={labelClass} htmlFor="tr-from-machine">Release from machine</label>
                <select id="tr-from-machine" value={form.fromMachine} onChange={(e) => set({ fromMachine: e.target.value })} className={inputClass}>
                  <option value="">Select machine…</option>
                  {fromFloorMachines.map((m) => <option key={m.id} value={m.id}>{m.name} · {LOCATIONS[m.floor]?.label}</option>)}
                </select>
              </div>
            )}
            {to === 'MACHINE' && (
              <div>
                <label className={labelClass} htmlFor="tr-to-machine">Assign to machine</label>
                <select id="tr-to-machine" value={form.toMachine} onChange={(e) => set({ toMachine: e.target.value })} className={inputClass}>
                  <option value="">Select machine…</option>
                  {toMachines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {!toMachines.length && <p className="mt-1 text-xs text-text-secondary">No machines on this floor.</p>}
              </div>
            )}

            <QuantityInput value={form.qty} unit={form.unit} available={material ? available : undefined}
              onChange={({ value, unit }) => set({ qty: value, unit })} />

            <ShiftDatePicker date={form.date} shift={form.shift} liveDate={meta?.live_business_date} liveShift={meta?.live_shift}
              onChange={({ date, shift }) => set({ date, shift })} />

            <div>
              <label className={labelClass} htmlFor="tr-note">Note</label>
              <input id="tr-note" value={form.note} onChange={(e) => set({ note: e.target.value })} className={inputClass} placeholder="Optional" />
            </div>

            {material && qtyKg > 0 && to && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border-default bg-bg-input p-3 text-xs">
                <div>
                  <p className="font-semibold text-text-secondary">{locationLabel(form.from, machineName(form.fromMachine))}</p>
                  <p className="mt-1 text-text-primary">{formatWeight(available)} → <span className="font-bold text-rose-600 dark:text-rose-400">{formatWeight(available - qtyKg)}</span></p>
                </div>
                <div>
                  <p className="font-semibold text-text-secondary">{locationLabel(to, machineName(form.toMachine))}</p>
                  <p className="mt-1 text-text-primary">{formatWeight(destinationNow)} → <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatWeight((destinationNow || 0) + qtyKg)}</span></p>
                </div>
              </div>
            )}

            {problems.length > 0 && form.qty !== '' && <p className="text-xs text-rose-500">{problems[0]}</p>}
            <PrimaryButton type="submit" disabled={busy || problems.length > 0} className="w-full">
              {busy ? 'Moving…' : 'Move stock'}
            </PrimaryButton>
          </form>

          {receipt && (
            <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-text-secondary">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">{receipt.transfer.transfer_no} recorded</p>
              <p className="mt-1">Plant total unchanged at {formatWeight(receipt.impact_receipt.plant_closing_kg)}.</p>
            </div>
          )}
        </Panel>

        <Panel title="Transfer register" subtitle="Grouped by business day; newest first" bodyClassName="p-0">
          {grouped.length === 0 ? <div className="p-4"><EmptyState>No transfers yet.</EmptyState></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
                    <th className="px-4 py-2.5">No.</th><th className="px-4 py-2.5">Shift</th><th className="px-4 py-2.5">Material</th>
                    <th className="px-4 py-2.5">Route</th><th className="px-4 py-2.5 text-right">Quantity</th>
                    <th className="px-4 py-2.5">By</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5" />
                  </tr>
                </thead>
                {grouped.map(([day, items]) => (
                  <tbody key={day}>
                    <tr><td colSpan={8} className="bg-bg-row-alt px-4 py-1.5 text-xs font-semibold text-text-secondary">{formatBusinessDate(day)}</td></tr>
                    {items.map((t) => (
                      <tr key={t.id} className={`border-b border-border-subtle ${t.status !== 'ACTIVE' ? 'opacity-60' : ''}`}>
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-text-primary">{t.transfer_no}</td>
                        <td className="px-4 py-2"><ShiftBadge shift={t.shift} /></td>
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-text-primary">{t.material_name}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <LocationBadge location={t.from_location} label={locationLabel(t.from_location, t.from_machine_name)} />
                            <ArrowRight className="h-3 w-3 text-text-secondary" />
                            <LocationBadge location={t.to_location} label={locationLabel(t.to_location, t.to_machine_name)} />
                          </span>
                          {t.note && <div className="mt-0.5 text-xs text-text-secondary">{t.note}</div>}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold"><Weight kg={t.quantity_kg} bags /></td>
                        <td className="px-4 py-2 text-xs text-text-secondary">{t.created_by_name || '—'}</td>
                        <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                        <td className="px-4 py-2 text-right">
                          {canReverse(t) && <SecondaryButton onClick={() => reverse(t)} className="px-2 py-1 text-xs"><RotateCcw className="h-3.5 w-3.5" />Reverse</SecondaryButton>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
