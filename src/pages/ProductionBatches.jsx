import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Factory, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import useStockMeta from '../hooks/useStockMeta'
import api from '../utils/api'
import { apiError, formatBusinessDate, machinesForFloor, shiftDate } from '../utils/ipms'
import { formatBags, formatWeight } from '../utils/units'
import { EmptyState, PageHeader, Panel, PrimaryButton, SecondaryButton, ShiftBadge, ShiftDatePicker, StatusBadge, Weight } from '../components/ipms/Kit'
import { inputClass, inputInline, labelClass } from '../components/ipms/styles'

const blankLine = () => ({ key: crypto.randomUUID(), machine: '', typeId: '', mode: 'gross', gross: '', tare: '', net: '', size: '', worker: '' })

const lineNet = (l) => {
  if (l.mode === 'net') return Number(l.net) || 0
  const g = Number(l.gross) || 0
  const t = Number(l.tare) || 0
  return g > t ? g - t : 0
}

export default function ProductionBatches({ user }) {
  const toast = useToast()
  const meta = useStockMeta()
  const gfMachines = useMemo(() => machinesForFloor(meta?.machines || [], 'GROUND_FLOOR'), [meta])
  const [overview, setOverview] = useState(null)
  const [batches, setBatches] = useState([])
  const [range, setRange] = useState({ from: '', to: '' })
  const [form, setForm] = useState({ date: '', shift: '', note: '' })
  const [lines, setLines] = useState([blankLine()])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState({})

  useEffect(() => {
    if (!meta) return
    if (!form.date) setForm((f) => ({ ...f, date: meta.live_business_date, shift: meta.live_shift }))
    if (!range.to) setRange({ from: shiftDate(meta.live_business_date, -6), to: meta.live_business_date })
  }, [meta, form.date, range.to])

  const load = useCallback(async () => {
    if (!range.to) return
    try {
      const [{ data: ov }, { data: list }] = await Promise.all([
        api.get('/stock/overview'),
        api.get('/production/batches', { params: { date_from: range.from, date_to: range.to } }),
      ])
      setOverview(ov)
      setBatches(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(apiError(error, 'Could not load batches'))
    }
  }, [range, toast])
  useEffect(() => { load() }, [load])
  useSSE(['production', 'stock', 'floor_stock'], load)

  // Materials a Ground Floor batch can draw: Ground Floor pool + stock on GF machines.
  const allocations = useMemo(() => overview?.machine_allocations || [], [overview])
  const materials = useMemo(() => (overview?.materials || [])
    .map((m) => ({
      ...m,
      onGfMachines: allocations.filter((a) => a.material_type_id === m.material_type_id && a.floor === 'GROUND_FLOOR')
        .reduce((s, a) => s + Number(a.quantity_kg), 0),
    }))
    .filter((m) => m.material_type_id && (Number(m.ground_floor_kg) > 0 || m.onGfMachines > 0)), [overview, allocations])

  const machineStock = (machineId, typeId) => Number(allocations.find((a) => String(a.machine_id) === String(machineId) && String(a.material_type_id) === String(typeId))?.quantity_kg || 0)

  const totals = useMemo(() => {
    const byMaterial = new Map()
    for (const l of lines) {
      if (!l.typeId) continue
      byMaterial.set(l.typeId, (byMaterial.get(l.typeId) || 0) + lineNet(l))
    }
    return { net: lines.reduce((s, l) => s + lineNet(l), 0), byMaterial }
  }, [lines])

  const shortages = [...totals.byMaterial.entries()].map(([typeId, need]) => {
    const m = materials.find((x) => String(x.material_type_id) === String(typeId))
    const usedMachines = new Set(lines.filter((l) => String(l.typeId) === String(typeId)).map((l) => l.machine))
    const fromMachines = [...usedMachines].reduce((s, id) => s + machineStock(id, typeId), 0)
    const available = Number(m?.ground_floor_kg || 0) + fromMachines
    return need > available + 1e-9 ? `${m?.material_name}: needs ${formatWeight(need)}, only ${formatWeight(available)} on the Ground Floor and its machines` : null
  }).filter(Boolean)

  const lineProblems = lines.map((l) => {
    if (!l.machine) return 'Choose a machine'
    if (!l.typeId) return 'Choose a material'
    if (l.mode === 'gross' && Number(l.gross) < Number(l.tare)) return 'Gross must be ≥ tare'
    if (lineNet(l) <= 0) return 'Enter the weight'
    return null
  })
  const valid = lineProblems.every((p) => !p) && shortages.length === 0

  const patchLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const submit = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/production/batches', {
        business_date: form.date, shift: form.shift, note: form.note || undefined,
        lines: lines.map((l) => ({
          machine_id: Number(l.machine), material_type_id: Number(l.typeId), size: l.size || undefined,
          worker_name: l.worker || user?.name || undefined,
          ...(l.mode === 'net' ? { net_weight: Number(l.net) } : { gross_weight: Number(l.gross), tare_weight: Number(l.tare || 0) }),
        })),
      })
      const b = data.batch
      toast.success(`${b.batch_no}: ${formatWeight(b.total_net_kg)} produced — ${formatWeight(b.from_machine_kg)} from machine stock, ${formatWeight(b.from_ground_floor_kg)} from the Ground Floor`)
      setLines([blankLine()])
      setForm((f) => ({ ...f, note: '' }))
      setOpen((o) => ({ ...o, [b.id]: true }))
      load()
    } catch (error) {
      toast.error(apiError(error, 'Could not save the batch'))
    } finally {
      setBusy(false)
    }
  }

  const reverse = async (b) => {
    if (!window.confirm(`Reverse ${b.batch_no}? ${formatWeight(b.total_net_kg)} goes back to where it came from (${formatWeight(b.from_machine_kg)} to machines, ${formatWeight(b.from_ground_floor_kg)} to the Ground Floor).`)) return
    try {
      await api.delete(`/production/batches/${b.id}`)
      toast.success(`${b.batch_no} reversed`)
      load()
    } catch (error) {
      toast.error(apiError(error, 'Could not reverse the batch'))
    }
  }
  const canReverse = (b) => b.status === 'ACTIVE' && (String(user?.role).toLowerCase() !== 'worker' || String(b.created_by) === String(user?.id))

  const dayTotals = useMemo(() => {
    const by = new Map()
    for (const b of batches) {
      if (b.status !== 'ACTIVE') continue
      const key = String(b.business_date).slice(0, 10)
      const entry = by.get(key) || { AM: 0, PM: 0 }
      entry[b.shift] += Number(b.total_net_kg)
      by.set(key, entry)
    }
    return by
  }, [batches])

  return (
    <div className="space-y-5">
      <PageHeader icon={Factory} title="Production Batches"
        subtitle="A batch is one shift's production on the Ground Floor. Batches draw only Ground Floor stock: each machine uses its own assigned stock first, then the Ground Floor pool." />

      <Panel title="New batch" subtitle="Ground Floor machines only">
        <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
          <ShiftDatePicker date={form.date} shift={form.shift} liveDate={meta?.live_business_date} liveShift={meta?.live_shift}
            onChange={({ date, shift }) => setForm((f) => ({ ...f, date, shift }))} />
          <div>
            <label className={labelClass} htmlFor="pb-note">Batch note</label>
            <input id="pb-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} placeholder="Order, product, remarks (optional)" />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
                <th className="py-2 pr-2">Machine</th><th className="py-2 pr-2">Material</th><th className="py-2 pr-2">Weighing</th>
                <th className="py-2 pr-2">Weights (kg)</th><th className="py-2 pr-2 text-right">Net</th><th className="py-2 pr-2">Size</th><th className="py-2 pr-2">Operator</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const m = materials.find((x) => String(x.material_type_id) === String(l.typeId))
                const own = l.machine && l.typeId ? machineStock(l.machine, l.typeId) : 0
                return (
                  <tr key={l.key} className="border-b border-border-subtle align-top">
                    <td className="py-2 pr-2">
                      <select value={l.machine} onChange={(e) => patchLine(l.key, { machine: e.target.value })} className={inputClass} aria-label={`Line ${i + 1} machine`}>
                        <option value="">Machine…</option>
                        {gfMachines.map((mc) => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select value={l.typeId} onChange={(e) => patchLine(l.key, { typeId: e.target.value })} className={inputClass} aria-label={`Line ${i + 1} material`}>
                        <option value="">Material…</option>
                        {materials.map((x) => <option key={x.key} value={x.material_type_id}>{x.material_name}</option>)}
                      </select>
                      {m && <p className="mt-1 text-[11px] text-text-secondary">GF {formatWeight(m.ground_floor_kg)}{own ? ` · this machine ${formatWeight(own)}` : ''}</p>}
                    </td>
                    <td className="py-2 pr-2">
                      <select value={l.mode} onChange={(e) => patchLine(l.key, { mode: e.target.value })} className={inputClass} aria-label={`Line ${i + 1} weighing`}>
                        <option value="gross">Gross − Tare</option><option value="net">Net only</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      {l.mode === 'net' ? (
                        <input type="number" min="0" step="any" value={l.net} onChange={(e) => patchLine(l.key, { net: e.target.value })} className={inputClass} placeholder="Net kg" aria-label={`Line ${i + 1} net`} />
                      ) : (
                        <div className="flex gap-1">
                          <input type="number" min="0" step="any" value={l.gross} onChange={(e) => patchLine(l.key, { gross: e.target.value })} className={inputClass} placeholder="Gross" aria-label={`Line ${i + 1} gross`} />
                          <input type="number" min="0" step="any" value={l.tare} onChange={(e) => patchLine(l.key, { tare: e.target.value })} className={inputClass} placeholder="Tare" aria-label={`Line ${i + 1} tare`} />
                        </div>
                      )}
                      {lineProblems[i] && (l.gross || l.net || l.machine) && <p className="mt-1 text-[11px] text-rose-500">{lineProblems[i]}</p>}
                    </td>
                    <td className="py-2 pr-2 text-right font-semibold"><Weight kg={lineNet(l)} /><div className="text-[11px] font-normal text-text-secondary">{formatBags(lineNet(l))}</div></td>
                    <td className="py-2 pr-2"><input value={l.size} onChange={(e) => patchLine(l.key, { size: e.target.value })} className={inputClass} placeholder="e.g. 24×36 75mic" aria-label={`Line ${i + 1} size`} /></td>
                    <td className="py-2 pr-2"><input value={l.worker} onChange={(e) => patchLine(l.key, { worker: e.target.value })} className={inputClass} placeholder={user?.name || 'Name'} aria-label={`Line ${i + 1} operator`} /></td>
                    <td className="py-2">
                      <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        className="rounded-md p-2 text-text-secondary hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <SecondaryButton onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus className="h-4 w-4" />Add machine line</SecondaryButton>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-text-secondary">Batch total <strong className="text-text-primary">{formatWeight(totals.net)}</strong> · {formatBags(totals.net)}</span>
            <PrimaryButton disabled={!valid || busy || !form.date} onClick={submit}>{busy ? 'Saving…' : 'Record batch'}</PrimaryButton>
          </div>
        </div>
        {shortages.map((s) => <p key={s} className="mt-2 text-xs text-rose-500">{s}</p>)}
      </Panel>

      <Panel title="Batch register" bodyClassName="p-0"
        actions={(
          <div className="flex items-center gap-2 text-xs">
            <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={`${inputInline} w-auto`} aria-label="From" />
            <span className="text-text-secondary">to</span>
            <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={`${inputInline} w-auto`} aria-label="To" />
          </div>
        )}>
        {batches.length === 0 ? <div className="p-4"><EmptyState>No batches in this range.</EmptyState></div> : (
          <ul className="divide-y divide-border-subtle">
            {batches.map((b, idx) => {
              const day = String(b.business_date).slice(0, 10)
              const showDay = idx === 0 || String(batches[idx - 1].business_date).slice(0, 10) !== day
              const dt = dayTotals.get(day) || { AM: 0, PM: 0 }
              return (
                <li key={b.id}>
                  {showDay && (
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-bg-row-alt px-4 py-1.5 text-xs font-semibold text-text-secondary">
                      <span>{formatBusinessDate(day)}</span>
                      <span>AM {formatWeight(dt.AM)} · PM {formatWeight(dt.PM)} · day {formatWeight(dt.AM + dt.PM)}</span>
                    </div>
                  )}
                  <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${b.status !== 'ACTIVE' ? 'opacity-60' : ''}`}>
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [b.id]: !o[b.id] }))} className="flex items-center gap-2 text-left" aria-expanded={!!open[b.id]}>
                      {open[b.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="font-mono text-sm font-semibold text-text-primary">{b.batch_no}</span>
                    </button>
                    <ShiftBadge shift={b.shift} />
                    <StatusBadge status={b.status} />
                    <span className="text-sm text-text-secondary">{b.machine_count} machine{b.machine_count === 1 ? '' : 's'} · {b.lines.length} line{b.lines.length === 1 ? '' : 's'}</span>
                    <span className="ml-auto text-right text-sm">
                      <strong className="text-text-primary"><Weight kg={b.total_net_kg} /></strong>
                      <span className="block text-[11px] text-text-secondary">machine {formatWeight(b.from_machine_kg)} · GF {formatWeight(b.from_ground_floor_kg)}</span>
                    </span>
                    {canReverse(b) && <SecondaryButton className="px-2 py-1 text-xs" onClick={() => reverse(b)}><RotateCcw className="h-3.5 w-3.5" />Reverse</SecondaryButton>}
                  </div>
                  {open[b.id] && (
                    <div className="px-4 pb-3">
                      {b.note && <p className="mb-2 text-xs text-text-secondary">{b.note}</p>}
                      {b.lines.length === 0 ? <p className="text-xs text-text-secondary">All lines reversed.</p> : (
                        <table className="w-full text-xs">
                          <thead><tr className="text-left text-text-secondary"><th className="py-1">Machine</th><th>Material</th><th>Size</th><th>Operator</th><th className="text-right">Gross</th><th className="text-right">Tare</th><th className="text-right">Net</th><th className="text-right">From machine</th></tr></thead>
                          <tbody>
                            {b.lines.map((ln) => (
                              <tr key={ln.id} className="border-t border-border-subtle">
                                <td className="py-1">{ln.machine_name}</td><td>{ln.material_name}</td><td>{ln.size || '—'}</td><td>{ln.worker_name || '—'}</td>
                                <td className="text-right">{formatWeight(ln.gross_weight)}</td><td className="text-right">{formatWeight(ln.tare_weight)}</td>
                                <td className="text-right font-semibold">{formatWeight(ln.net_weight)}</td><td className="text-right">{formatWeight(ln.machine_consumed_kg)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <p className="mt-2 text-[11px] text-text-secondary">Recorded by {b.created_by_name || '—'}{b.reversed_by_name ? ` · reversed by ${b.reversed_by_name}` : ''}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
