import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, BookOpenCheck, CalendarCheck2, CalendarClock, ChevronLeft, ChevronRight, Download, Lock, Moon, Sun,
} from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import api from '../utils/api'
import { exportMultiSheet } from '../utils/exportToExcel'
import { LEDGER_LOCATIONS, LOCATIONS, apiError, formatBusinessDate } from '../utils/ipms'
import { formatBags, formatWeight } from '../utils/units'
import { EmptyState, FlowCell, LocationBadge, PageHeader, Panel, PrimaryButton, SecondaryButton, StatTile, Weight } from '../components/ipms/Kit'
import { inputClass, inputInline } from '../components/ipms/styles'

const VIEWS = [
  { id: 'opening', label: 'Opening Stock', icon: CalendarClock },
  { id: 'shifts', label: 'AM / PM Shifts', icon: Sun },
  { id: 'closing', label: 'Closing Stock', icon: CalendarCheck2 },
]
const LOCATION_TABS = ['PLANT', ...LEDGER_LOCATIONS]
const TILE_TONES = { WAREHOUSE: 'sky', GROUND_FLOOR: 'emerald', FIRST_FLOOR: 'violet', MACHINES: 'amber', PLANT: 'slate' }

function MatrixTable({ materials, field, totals }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
            <th className="px-4 py-2.5 font-semibold">Material</th>
            {LEDGER_LOCATIONS.map((loc) => <th key={loc} className="px-4 py-2.5 text-right"><LocationBadge location={loc} /></th>)}
            <th className="px-4 py-2.5 text-right font-semibold">Plant total</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            <tr key={m.key} className="border-b border-border-subtle hover:bg-bg-row-hover">
              <td className="px-4 py-2.5 font-medium text-text-primary">{m.material_name}</td>
              {LEDGER_LOCATIONS.map((loc) => (
                <td key={loc} className="px-4 py-2.5 text-right">
                  {Number(m.locations[loc][field]) ? <Weight kg={m.locations[loc][field]} /> : <span className="text-text-secondary/50">—</span>}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-semibold">
                <Weight kg={m.locations.PLANT[field]} />
                <div className="text-[11px] font-normal text-text-secondary">{formatBags(m.locations.PLANT[field])}</div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-bg-row-alt font-semibold">
            <td className="px-4 py-2.5">Total</td>
            {LEDGER_LOCATIONS.map((loc) => <td key={loc} className="px-4 py-2.5 text-right"><Weight kg={totals[loc]?.[field]} /></td>)}
            <td className="px-4 py-2.5 text-right"><Weight kg={totals.PLANT?.[field]} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function ShiftTable({ materials, location, totals }) {
  const t = totals[location] || {}
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-text-secondary">
            <th className="px-3 pt-2.5 text-left font-semibold" rowSpan={2}>Material</th>
            <th className="px-3 pt-2.5 text-right font-semibold" rowSpan={2}>Opening</th>
            <th className="border-l border-border-default px-3 pt-2.5 text-center font-semibold text-amber-600 dark:text-amber-400" colSpan={2}><Sun className="mr-1 inline h-3.5 w-3.5" />AM · Morning</th>
            <th className="border-l border-border-default px-3 pt-2.5 text-center font-semibold text-violet-600 dark:text-violet-400" colSpan={2}><Moon className="mr-1 inline h-3.5 w-3.5" />PM · Night</th>
            <th className="border-l border-border-default px-3 pt-2.5 text-right font-semibold" rowSpan={2}>Closing</th>
            <th className="border-l border-border-default px-3 pt-2.5 text-center font-semibold" colSpan={4}>Where it went (day)</th>
          </tr>
          <tr className="border-b border-border-default text-[10px] uppercase tracking-wider text-text-secondary">
            <th className="border-l border-border-default px-3 pb-2 text-right">In / Out</th>
            <th className="px-3 pb-2 text-right">AM closing</th>
            <th className="border-l border-border-default px-3 pb-2 text-right">In / Out</th>
            <th className="px-3 pb-2 text-right">PM closing</th>
            <th className="border-l border-border-default px-3 pb-2 text-right">Received / Adj.</th>
            <th className="px-3 pb-2 text-right">Moved in / out</th>
            <th className="px-3 pb-2 text-right">Used</th>
            <th className="px-3 pb-2 text-right">Returned</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            const l = m.locations[location]
            const received = Number(l.received_kg || 0) + Number(l.adjusted_kg || 0)
            return (
              <tr key={m.key} className="border-b border-border-subtle hover:bg-bg-row-hover">
                <td className="px-3 py-2 font-medium text-text-primary">{m.material_name}</td>
                <td className="px-3 py-2 text-right"><Weight kg={l.opening_kg} /></td>
                <td className="border-l border-border-subtle px-3 py-2 text-right"><FlowCell inKg={l.am.in_kg} outKg={l.am.out_kg} /></td>
                <td className="px-3 py-2 text-right"><Weight kg={l.am.closing_kg} /></td>
                <td className="border-l border-border-subtle px-3 py-2 text-right"><FlowCell inKg={l.pm.in_kg} outKg={l.pm.out_kg} /></td>
                <td className="px-3 py-2 text-right"><Weight kg={l.pm.closing_kg} /></td>
                <td className="border-l border-border-subtle px-3 py-2 text-right font-semibold"><Weight kg={l.closing_kg} /></td>
                <td className="border-l border-border-subtle px-3 py-2 text-right">{received ? <Weight kg={received} signed /> : '—'}</td>
                <td className="px-3 py-2 text-right"><FlowCell inKg={l.transfer_in_kg} outKg={l.transfer_out_kg} /></td>
                <td className="px-3 py-2 text-right">{Number(l.consumed_kg) ? <Weight kg={-l.consumed_kg} signed /> : '—'}</td>
                <td className="px-3 py-2 text-right">{Number(l.returned_kg) ? <Weight kg={-l.returned_kg} signed /> : '—'}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-bg-row-alt font-semibold">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right"><Weight kg={t.opening_kg} /></td>
            <td className="border-l border-border-subtle px-3 py-2 text-right"><FlowCell inKg={t.am?.in_kg} outKg={t.am?.out_kg} /></td>
            <td className="px-3 py-2 text-right"><Weight kg={t.am?.closing_kg} /></td>
            <td className="border-l border-border-subtle px-3 py-2 text-right"><FlowCell inKg={t.pm?.in_kg} outKg={t.pm?.out_kg} /></td>
            <td className="px-3 py-2 text-right"><Weight kg={t.pm?.closing_kg} /></td>
            <td className="border-l border-border-subtle px-3 py-2 text-right"><Weight kg={t.closing_kg} /></td>
            <td className="border-l border-border-subtle px-3 py-2 text-right"><Weight kg={Number(t.received_kg || 0) + Number(t.adjusted_kg || 0)} signed /></td>
            <td className="px-3 py-2 text-right"><FlowCell inKg={t.transfer_in_kg} outKg={t.transfer_out_kg} /></td>
            <td className="px-3 py-2 text-right"><Weight kg={-(t.consumed_kg || 0)} signed /></td>
            <td className="px-3 py-2 text-right"><Weight kg={-(t.returned_kg || 0)} signed /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function StockLedger({ user }) {
  const toast = useToast()
  const isOwner = String(user?.role || '').toLowerCase() !== 'worker'
  const [params, setParams] = useSearchParams()
  const view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'shifts'
  const [date, setDate] = useState(params.get('date') || '')
  const [location, setLocation] = useState('PLANT')
  const [ledger, setLedger] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [showMoved, setShowMoved] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/stock/ledger', { params: date ? { date } : {} })
      setLedger(data)
      if (!date) setDate(data.business_date)
    } catch (error) {
      toast.error(apiError(error, 'Could not load the day ledger'))
    } finally {
      setLoading(false)
    }
  }, [date, toast])

  useEffect(() => { setLoading(true); load() }, [load])
  useSSE(['stock', 'floor_stock', 'raw_material', 'production', 'material_movement'], load)

  const setView = (next) => setParams((p) => { const q = new URLSearchParams(p); q.set('view', next); if (date) q.set('date', date); return q })
  const goDate = (next) => { setDate(next); setParams((p) => { const q = new URLSearchParams(p); q.set('date', next); return q }) }

  const materials = useMemo(
    () => (ledger?.materials || []).filter((m) => !showMoved || m.moved),
    [ledger, showMoved],
  )
  const totals = ledger?.totals || {}
  const closingRecord = ledger?.day_closing

  const closeDay = async () => {
    setClosing(true)
    try {
      const { data } = await api.post('/stock/day-close', { business_date: ledger.business_date, note: closeNote || undefined })
      setLedger(data.ledger)
      setCloseNote('')
      toast.success(`${formatBusinessDate(ledger.business_date)} closed at ${formatWeight(data.ledger.totals.PLANT.closing_kg)}. This closing is the opening of ${formatBusinessDate(ledger.next_date)}.`)
    } catch (error) {
      toast.error(apiError(error, 'Could not close the day'))
    } finally {
      setClosing(false)
    }
  }

  const exportLedger = () => {
    if (!ledger) return
    const rowsFor = (field) => materials.map((m) => ({
      material: m.material_name,
      ...Object.fromEntries(LEDGER_LOCATIONS.map((loc) => [loc, m.locations[loc][field]])),
      PLANT: m.locations.PLANT[field],
      bags: m.locations.PLANT[field] / 25,
    }))
    const matrixColumns = [
      { key: 'material', label: 'Material' },
      ...LEDGER_LOCATIONS.map((loc) => ({ key: loc, label: `${LOCATIONS[loc].label} (kg)` })),
      { key: 'PLANT', label: 'Plant total (kg)' }, { key: 'bags', label: 'Plant total (bags)' },
    ]
    exportMultiSheet({
      filename: `Stock_Ledger_${ledger.business_date}`,
      sheets: [
        { sheetName: 'Opening', rows: rowsFor('opening_kg'), columns: matrixColumns },
        { sheetName: 'Closing', rows: rowsFor('closing_kg'), columns: matrixColumns },
        {
          sheetName: 'Shifts (plant)',
          rows: materials.map((m) => {
            const l = m.locations.PLANT
            return {
              material: m.material_name, opening: l.opening_kg, am_in: l.am.in_kg, am_out: l.am.out_kg,
              am_closing: l.am.closing_kg, pm_in: l.pm.in_kg, pm_out: l.pm.out_kg, closing: l.closing_kg,
              received: l.received_kg, consumed: l.consumed_kg, returned: l.returned_kg,
            }
          }),
          columns: [
            { key: 'material', label: 'Material' }, { key: 'opening', label: 'Opening (kg)' },
            { key: 'am_in', label: 'AM in' }, { key: 'am_out', label: 'AM out' }, { key: 'am_closing', label: 'AM closing' },
            { key: 'pm_in', label: 'PM in' }, { key: 'pm_out', label: 'PM out' }, { key: 'closing', label: 'Closing (kg)' },
            { key: 'received', label: 'Received' }, { key: 'consumed', label: 'Used in production' }, { key: 'returned', label: 'Returned' },
          ],
        },
        {
          sheetName: 'Machines',
          rows: ledger.machines,
          columns: [
            { key: 'machine_name', label: 'Machine' }, { key: 'material_name', label: 'Material' },
            { key: 'opening_kg', label: 'Opening (kg)' }, { key: 'in_kg', label: 'Assigned' },
            { key: 'out_kg', label: 'Used / released' }, { key: 'closing_kg', label: 'Closing (kg)' },
          ],
        },
      ],
    })
  }

  const PlantField = view === 'opening' ? 'opening_kg' : 'closing_kg'

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BookOpenCheck}
        title="Opening & Closing Stock"
        subtitle="Day ledger by location and shift. Each day's closing stock is carried forward as the next day's opening stock — entries filed for any past day flow through automatically."
        actions={<SecondaryButton onClick={exportLedger} disabled={!ledger}><Download className="h-4 w-4" />Export</SecondaryButton>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton aria-label="Previous day" onClick={() => ledger && goDate(ledger.previous_date)}><ChevronLeft className="h-4 w-4" /></SecondaryButton>
          <input type="date" value={date} max={ledger?.live_business_date} onChange={(e) => e.target.value && goDate(e.target.value)} className={`${inputInline} w-auto`} aria-label="Business date" />
          <SecondaryButton aria-label="Next day" disabled={!ledger || ledger.is_live_day || ledger.is_future} onClick={() => goDate(ledger.next_date)}><ChevronRight className="h-4 w-4" /></SecondaryButton>
          {ledger && !ledger.is_live_day && <SecondaryButton onClick={() => goDate(ledger.live_business_date)}>Today</SecondaryButton>}
        </div>
        <div role="tablist" aria-label="Ledger view" className="inline-flex overflow-hidden rounded-lg border border-border-default">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold ${view === v.id ? 'bg-accent-gold text-white dark:text-black' : 'bg-bg-input text-text-secondary hover:text-text-primary'}`}>
              <v.icon className="h-3.5 w-3.5" />{v.label}
            </button>
          ))}
        </div>
      </div>

      {ledger && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border-default bg-bg-card p-4 text-sm">
            <p className="text-text-secondary">
              <strong className="text-text-primary">{formatBusinessDate(ledger.business_date)}</strong>
              {ledger.is_live_day && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">LIVE DAY</span>}
            </p>
            <p className="mt-2 text-text-secondary">
              Opening = closing of {formatBusinessDate(ledger.previous_date)}: <strong className="text-text-primary">{formatWeight(totals.PLANT?.opening_kg)}</strong>
            </p>
            <p className="text-text-secondary">
              Closing {ledger.is_live_day ? '(live, so far)' : ''} → opening of {formatBusinessDate(ledger.next_date)}: <strong className="text-text-primary">{formatWeight(totals.PLANT?.closing_kg)}</strong>
            </p>
            <p className="text-text-secondary">
              Used in production: <strong className="text-text-primary">{formatWeight(ledger.usage.am_kg)}</strong> AM · <strong className="text-text-primary">{formatWeight(ledger.usage.pm_kg)}</strong> PM
            </p>
          </div>
          <div className={`rounded-xl border p-4 text-sm ${closingRecord ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border-default bg-bg-card'}`}>
            {closingRecord ? (
              <>
                <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400"><Lock className="h-4 w-4" />Day closed by {closingRecord.closed_by_name || 'owner'}</p>
                <p className="mt-1 text-text-secondary">Signed-off plant closing {formatWeight(closingRecord.plant_closing_kg)}{closingRecord.note ? ` · ${closingRecord.note}` : ''}</p>
                {closingRecord.variance?.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
                    <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" />Changed after closing</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {closingRecord.variance.map((v) => <li key={v.key}>{v.material_name}: {formatWeight(v.difference_kg, { signed: true })}</li>)}
                    </ul>
                  </div>
                ) : <p className="mt-1 text-xs text-text-secondary">No changes since closing.</p>}
                {isOwner && <SecondaryButton className="mt-3" disabled={closing} onClick={closeDay}>Re-close with current figures</SecondaryButton>}
              </>
            ) : (
              <>
                <p className="font-semibold text-text-primary">Day not closed yet</p>
                <p className="mt-1 text-text-secondary">Closing the day signs off these closing figures. Workers can no longer post into a closed day.</p>
                {isOwner ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Closing note (optional)" className={`${inputClass} min-w-0 flex-1`} />
                    <PrimaryButton disabled={closing || ledger.is_future} onClick={closeDay}><Lock className="h-4 w-4" />Close Day</PrimaryButton>
                  </div>
                ) : <p className="mt-2 text-xs text-text-secondary">Only an owner can close a day.</p>}
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {LOCATION_TABS.map((loc) => (
          <StatTile key={loc} label={`${LOCATIONS[loc].label} · ${view === 'opening' ? 'opening' : 'closing'}`}
            tone={TILE_TONES[loc]} kg={totals[loc]?.[PlantField]}
            hint={view === 'opening'
              ? formatBags(totals[loc]?.opening_kg)
              : `opened at ${formatWeight(totals[loc]?.opening_kg)}`}
            onClick={view === 'shifts' ? () => setLocation(loc) : undefined}
            active={view === 'shifts' && location === loc} />
        ))}
      </div>

      <Panel
        title={view === 'opening' ? `Opening stock · ${formatBusinessDate(ledger?.business_date)}`
          : view === 'closing' ? `Closing stock · ${formatBusinessDate(ledger?.business_date)}`
            : `${LOCATIONS[location].label} · AM / PM movement`}
        subtitle={view === 'shifts' ? 'AM closing is the PM opening. Pick a location above.' : 'Per material, per location'}
        bodyClassName="p-0"
        actions={(
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={showMoved} onChange={(e) => setShowMoved(e.target.checked)} />
            Only materials that moved this day
          </label>
        )}
      >
        {loading ? <div className="p-6 text-sm text-text-secondary">Loading ledger…</div>
          : materials.length === 0 ? <div className="p-4"><EmptyState>No stock on this day.</EmptyState></div>
            : view === 'shifts' ? <ShiftTable materials={materials} location={location} totals={totals} />
              : <MatrixTable materials={materials} field={PlantField} totals={totals} />}
      </Panel>

      <Panel title="Machine stock" subtitle="Opening and closing per machine for this day" bodyClassName="p-0">
        {!ledger?.machines?.length ? <div className="p-4"><EmptyState>No machine held stock on this day.</EmptyState></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
                  <th className="px-4 py-2.5">Machine</th><th className="px-4 py-2.5">Material</th>
                  <th className="px-4 py-2.5 text-right">Opening</th><th className="px-4 py-2.5 text-right">Assigned / used</th>
                  <th className="px-4 py-2.5 text-right">AM closing</th><th className="px-4 py-2.5 text-right">Closing</th>
                </tr>
              </thead>
              <tbody>
                {ledger.machines.map((m) => (
                  <tr key={`${m.machine_id}-${m.material_id}`} className="border-b border-border-subtle">
                    <td className="px-4 py-2"><span className="font-medium text-text-primary">{m.machine_name}</span> <LocationBadge location={m.floor} /></td>
                    <td className="px-4 py-2 text-text-secondary">{m.material_name}</td>
                    <td className="px-4 py-2 text-right"><Weight kg={m.opening_kg} /></td>
                    <td className="px-4 py-2 text-right"><FlowCell inKg={m.in_kg} outKg={m.out_kg} /></td>
                    <td className="px-4 py-2 text-right"><Weight kg={m.am_closing_kg} /></td>
                    <td className="px-4 py-2 text-right font-semibold"><Weight kg={m.closing_kg} /></td>
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
