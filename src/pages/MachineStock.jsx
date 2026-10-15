import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cog, Moon, PackageMinus, PackagePlus, Sun } from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import api from '../utils/api'
import { LOCATIONS, apiError } from '../utils/ipms'
import { formatBags } from '../utils/units'
import { EmptyState, LocationBadge, PageHeader, Panel, SecondaryButton, Weight } from '../components/ipms/Kit'

export default function MachineStock() {
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get('/stock/machines')
      setData(result)
    } catch (error) {
      toast.error(apiError(error, 'Could not load machine stock'))
    }
  }, [toast])
  useEffect(() => { Promise.resolve().then(load) }, [load])
  useSSE(['stock', 'production', 'floor_stock'], load)

  const floors = useMemo(() => {
    const by = { GROUND_FLOOR: [], FIRST_FLOOR: [] }
    for (const m of data?.machines || []) (by[m.floor] || (by[m.floor] = [])).push(m)
    return Object.entries(by).filter(([, list]) => list.length)
  }, [data])

  return (
    <div className="space-y-5">
      <PageHeader icon={Cog} title="Machine Stock"
        subtitle="Stock assigned to each machine. Assigning moves stock off the machine's floor onto the machine; production on that machine uses its own stock first, then the Ground Floor pool. Releasing puts unused stock back on the floor." />

      {!data ? <EmptyState>Loading machines…</EmptyState> : floors.map(([floor, machines]) => (
        <Panel key={floor} title={LOCATIONS[floor].label}
          subtitle={floor === 'GROUND_FLOOR' ? 'Production machines — production batches run here' : 'Cutting / converting machines'}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {machines.map((m) => (
              <article key={m.id} className="flex flex-col rounded-xl border border-border-default bg-bg-primary/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-text-primary">{m.name}</h3>
                    <p className="text-xs capitalize text-text-secondary">{m.type} machine</p>
                  </div>
                  <LocationBadge location={m.floor} />
                </div>
                <p className="mt-3 text-2xl font-bold text-text-primary"><Weight kg={m.allocated_kg} /></p>
                <p className="text-xs text-text-secondary">{formatBags(m.allocated_kg)} assigned</p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {m.allocations.length === 0
                    ? <li className="text-xs text-text-secondary">Nothing assigned — production draws from the Ground Floor pool.</li>
                    : m.allocations.map((a) => (
                      <li key={a.material_type_id} className="flex justify-between gap-2">
                        <span className="truncate text-text-secondary">{a.material_name}</span><Weight kg={a.quantity_kg} />
                      </li>
                    ))}
                </ul>
                <div className="mt-3 flex gap-2 border-t border-border-subtle pt-3 text-xs text-text-secondary">
                  <span className="inline-flex items-center gap-1"><Sun className="h-3.5 w-3.5 text-amber-500" />AM <Weight kg={m.today?.AM?.net_kg || 0} /></span>
                  <span className="inline-flex items-center gap-1"><Moon className="h-3.5 w-3.5 text-violet-500" />PM <Weight kg={m.today?.PM?.net_kg || 0} /></span>
                  <span className="ml-auto">produced today</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <SecondaryButton className="px-2 text-xs" onClick={() => navigate(`/stock/transfers?from=${m.floor}&to=MACHINE&toMachine=${m.id}`)}>
                    <PackagePlus className="h-3.5 w-3.5" />Assign
                  </SecondaryButton>
                  <SecondaryButton className="px-2 text-xs" disabled={!m.allocations.length}
                    onClick={() => navigate(`/stock/transfers?from=MACHINE&fromMachine=${m.id}&to=${m.floor}`)}>
                    <PackageMinus className="h-3.5 w-3.5" />Release
                  </SecondaryButton>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  )
}
