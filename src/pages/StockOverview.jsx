import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight, Boxes, Building2, CalendarCheck2, CalendarClock, Cog, Factory, Layers, Search, Undo2, Warehouse,
} from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import api from '../utils/api'
import { apiError, formatBusinessDate } from '../utils/ipms'
import { formatBags } from '../utils/units'
import { EmptyState, LocationBadge, PageHeader, Panel, PrimaryButton, SecondaryButton, ShiftBadge, StatTile, Weight } from '../components/ipms/Kit'
import { inputInline } from '../components/ipms/styles'

const COLUMNS = [
  { key: 'warehouse_kg', loc: 'WAREHOUSE' },
  { key: 'ground_floor_kg', loc: 'GROUND_FLOOR' },
  { key: 'first_floor_kg', loc: 'FIRST_FLOOR' },
  { key: 'machines_kg', loc: 'MACHINES' },
]

export default function StockOverview({ user }) {
  const navigate = useNavigate()
  const toast = useToast()
  const isOwner = String(user?.role || '').toLowerCase() !== 'worker'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState('')

  const load = useCallback(async () => {
    try {
      const { data: overview } = await api.get('/stock/overview')
      setData(overview)
    } catch (error) {
      toast.error(apiError(error, 'Could not load stock'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])
  useSSE(['stock', 'floor_stock', 'raw_material', 'production', 'material_movement'], load)

  const materials = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (data?.materials || [])
      .filter((m) => !term || String(m.material_name || '').toLowerCase().includes(term))
      .filter((m) => !focus || Number(m[COLUMNS.find((c) => c.loc === focus)?.key] || 0) > 0)
  }, [data, query, focus])

  const totals = data?.totals || {}
  const machinesById = useMemo(() => {
    const map = new Map()
    for (const a of data?.machine_allocations || []) {
      const entry = map.get(a.machine_id) || { machine_id: a.machine_id, machine_name: a.machine_name, floor: a.floor, items: [], total: 0 }
      entry.items.push(a)
      entry.total += Number(a.quantity_kg || 0)
      map.set(a.machine_id, entry)
    }
    return [...map.values()]
  }, [data])

  const liveDate = data?.live_business_date
  const goLedger = (view) => navigate(`/stock/ledger?view=${view}${liveDate ? `&date=${liveDate}` : ''}`)

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Boxes}
        title="Stock Overview"
        subtitle="Live stock in every location. Transfers move stock between locations; production and returns are the only things that reduce the plant total."
        actions={(
          <>
            <SecondaryButton onClick={() => goLedger('opening')}><CalendarClock className="h-4 w-4" />Opening Stock</SecondaryButton>
            <SecondaryButton onClick={() => goLedger('closing')}><CalendarCheck2 className="h-4 w-4" />Closing Stock</SecondaryButton>
            <PrimaryButton onClick={() => navigate('/stock/transfers')}><ArrowLeftRight className="h-4 w-4" />Move Stock</PrimaryButton>
          </>
        )}
      />

      {liveDate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-bg-card px-4 py-2 text-sm text-text-secondary">
          Live business day <strong className="text-text-primary">{formatBusinessDate(liveDate)}</strong>
          <ShiftBadge shift={data.live_shift} />
          <span className="hidden sm:inline">· today’s closing becomes tomorrow’s opening automatically</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Warehouse" tone="sky" icon={Warehouse} kg={totals.warehouse_kg}
          onClick={() => setFocus(focus === 'WAREHOUSE' ? '' : 'WAREHOUSE')} active={focus === 'WAREHOUSE'} />
        <StatTile label="Ground Floor" tone="emerald" icon={Factory} kg={totals.ground_floor_kg}
          onClick={() => setFocus(focus === 'GROUND_FLOOR' ? '' : 'GROUND_FLOOR')} active={focus === 'GROUND_FLOOR'} />
        <StatTile label="First Floor" tone="violet" icon={Building2} kg={totals.first_floor_kg}
          onClick={() => setFocus(focus === 'FIRST_FLOOR' ? '' : 'FIRST_FLOOR')} active={focus === 'FIRST_FLOOR'} />
        <StatTile label="On Machines" tone="amber" icon={Cog} kg={totals.machines_kg}
          onClick={() => setFocus(focus === 'MACHINES' ? '' : 'MACHINES')} active={focus === 'MACHINES'} />
        <StatTile label="Plant Total" tone="slate" icon={Layers} kg={totals.plant_kg}
          hint={`${formatBags(totals.plant_kg)} across ${(data?.materials || []).length} materials`} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Stock by material and location"
          subtitle={focus ? `Showing materials held on ${focus.replace('_', ' ').toLowerCase()}` : 'Every material with stock anywhere in the plant'}
          bodyClassName="p-0"
          actions={(
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-secondary" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter materials"
                className={`${inputInline} w-56 pl-8`} aria-label="Filter materials" />
            </div>
          )}
        >
          {loading ? <div className="p-6 text-sm text-text-secondary">Loading stock…</div>
            : materials.length === 0 ? <div className="p-4"><EmptyState>No stock matches.</EmptyState></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
                      <th className="px-4 py-2.5 font-semibold">Material</th>
                      {COLUMNS.map((c) => <th key={c.key} className="px-4 py-2.5 text-right font-semibold"><LocationBadge location={c.loc} /></th>)}
                      <th className="px-4 py-2.5 text-right font-semibold">Plant total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m) => (
                      <tr key={m.key} className="border-b border-border-subtle hover:bg-bg-row-hover">
                        <td className="px-4 py-2.5 font-medium text-text-primary">{m.material_name}</td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="px-4 py-2.5 text-right">
                            {Number(m[c.key]) ? <Weight kg={m[c.key]} /> : <span className="text-text-secondary/50">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right font-semibold text-text-primary">
                          <Weight kg={m.plant_kg} />
                          <div className="text-[11px] font-normal text-text-secondary">{formatBags(m.plant_kg)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-bg-row-alt font-semibold text-text-primary">
                      <td className="px-4 py-2.5">Total</td>
                      {COLUMNS.map((c) => <td key={c.key} className="px-4 py-2.5 text-right"><Weight kg={totals[c.key]} /></td>)}
                      <td className="px-4 py-2.5 text-right"><Weight kg={totals.plant_kg} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Machine-assigned stock" subtitle="Stock handed to a machine; production uses it first"
            actions={<SecondaryButton onClick={() => navigate('/stock/machines')}>Manage</SecondaryButton>}>
            {machinesById.length === 0 ? <EmptyState>No stock is assigned to a machine.</EmptyState> : (
              <ul className="space-y-3">
                {machinesById.map((m) => (
                  <li key={m.machine_id} className="rounded-lg border border-border-default p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text-primary">{m.machine_name}</span>
                      <LocationBadge location={m.floor} />
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {m.items.map((a) => (
                        <li key={a.material_type_id} className="flex justify-between gap-2 text-text-secondary">
                          <span className="truncate">{a.material_name}</span><Weight kg={a.quantity_kg} className="text-text-primary" />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Quick actions">
            <div className="grid gap-2">
              <SecondaryButton onClick={() => navigate('/production-batches')}><Factory className="h-4 w-4" />New production batch</SecondaryButton>
              <SecondaryButton onClick={() => navigate('/stock/usage')}><CalendarClock className="h-4 w-4" />Day-wise usage</SecondaryButton>
              {isOwner && <SecondaryButton onClick={() => navigate('/stock/returns')}><Undo2 className="h-4 w-4" />Return stock</SecondaryButton>}
              <SecondaryButton onClick={() => navigate('/stock/search')}><Search className="h-4 w-4" />Search stock records</SecondaryButton>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
