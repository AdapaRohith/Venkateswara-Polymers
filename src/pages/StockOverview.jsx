import { useState } from 'react'
import { Boxes } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import { apiError, formatBusinessDate } from '../utils/ipms'
import { inputBase, labelClass } from '../components/ipms/styles'
import {
  EmptyState, PageHeader, Panel, PrimaryButton, ShiftBadge, StatTile, StockStatusBadge, Weight, td, th,
} from '../components/ipms/Kit'

const TABS = [['raw', 'Raw material'], ['rolls', 'Roll Store'], ['finished', 'Finished Goods']]

function Thresholds({ value }) {
  const toast = useToast()
  const [low, setLow] = useState(value.reorder_below_kg / 1000)
  const [high, setHigh] = useState(value.optimal_above_kg / 1000)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className={labelClass} htmlFor="thr-low">Reorder below (t)</label>
        <input id="thr-low" type="number" min="0" step="any" value={low} onChange={(e) => setLow(e.target.value)} className={`${inputBase} w-28`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="thr-high">Optimal above (t)</label>
        <input id="thr-high" type="number" min="0" step="any" value={high} onChange={(e) => setHigh(e.target.value)} className={`${inputBase} w-28`} />
      </div>
      <PrimaryButton onClick={async () => {
        try {
          await api.put('/stock/thresholds', { reorder_below_kg: Number(low) * 1000, optimal_above_kg: Number(high) * 1000 })
          toast.success('Stock alert levels saved')
        } catch (err) { toast.error(apiError(err)) }
      }}>Save levels</PrimaryButton>
      <p className="text-xs text-text-secondary">In between is buffer stock. Individual materials can override these under Raw Material.</p>
    </div>
  )
}

export default function StockOverview({ user }) {
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'
  const [tab, setTab] = useState('raw')
  const { data, error } = useLiveData(() => api.get('/stock/overview').then((r) => r.data), [])
  if (error) return <EmptyState>{error}</EmptyState>
  if (!data) return <EmptyState>Loading stock…</EmptyState>
  const t = data.totals
  const materials = data.materials.filter((m) => m.total_kg > 0 || m.active)

  return (
    <div className="space-y-6">
      <PageHeader icon={Boxes} title="Stock Overview"
        subtitle={<>Live stock in every store · {formatBusinessDate(data.live_business_date)} <ShiftBadge shift={data.live_shift} /></>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Ground Floor" kg={t.ground_floor_kg} tone="emerald" hint={<StockStatusBadge status={t.ground_floor_status} />} onClick={() => setTab('raw')} />
        <StatTile label="1st Floor Production" kg={t.first_floor_kg} tone="violet" hint={<StockStatusBadge status={t.first_floor_status} />} onClick={() => setTab('raw')} />
        <StatTile label="Raw material total" kg={t.raw_total_kg} tone="slate" hint={<StockStatusBadge status={t.raw_total_status} />} onClick={() => setTab('raw')} />
        <StatTile label="Roll Store" kg={t.roll_store_kg} tone="sky" hint="Extruder output" onClick={() => setTab('rolls')} active={tab === 'rolls'} />
        <StatTile label="Finished Goods" kg={t.finished_store_kg} tone="amber" hint="Cutting output" onClick={() => setTab('finished')} active={tab === 'finished'} />
      </div>

      <Panel title="Stock by item"
        actions={<div role="tablist" className="flex flex-wrap gap-2">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === id ? 'bg-accent-gold text-white dark:text-black' : 'text-text-secondary hover:text-text-primary'}`}>{label}</button>
          ))}
        </div>}>
        {tab === 'raw' && (
          !materials.length ? <EmptyState>No raw material yet.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border-default">
                <thead><tr>
                  <th className={th}>Material</th><th className={th}>Brand</th>
                  <th className={`${th} text-right`}>Ground Floor</th><th className={`${th} text-right`}>1st Floor</th>
                  <th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Bags</th><th className={th}>Stock alert</th>
                </tr></thead>
                <tbody className="divide-y divide-border-default">
                  {materials.map((m) => (
                    <tr key={m.id}>
                      <td className={`${td} font-semibold`}>{m.name}</td>
                      <td className={td}>{m.brand || '—'}</td>
                      <td className={`${td} text-right`}><Weight kg={m.ground_floor_kg} /></td>
                      <td className={`${td} text-right`}><Weight kg={m.first_floor_kg} /></td>
                      <td className={`${td} text-right font-semibold`}><Weight kg={m.total_kg} /></td>
                      <td className={`${td} text-right tabular-nums`}>{(m.total_kg / 25).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</td>
                      <td className={td}><StockStatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {tab !== 'raw' && (() => {
          const list = (tab === 'rolls' ? data.rolls : data.finished).filter((p) => p.quantity_kg > 0)
          return !list.length ? <EmptyState>{tab === 'rolls' ? 'The Roll Store is empty.' : 'No finished goods in store.'}</EmptyState> : (
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr><th className={th}>Size</th><th className={`${th} text-right`}>In store</th><th className={`${th} text-right`}>Tons</th></tr></thead>
              <tbody className="divide-y divide-border-default">
                {list.map((p) => (
                  <tr key={p.id}><td className={`${td} font-semibold`}>{p.code}</td><td className={`${td} text-right`}><Weight kg={p.quantity_kg} /></td>
                    <td className={`${td} text-right tabular-nums`}>{(p.quantity_kg / 1000).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          )
        })()}
      </Panel>

      {isOwner && (
        <Panel title="Stock alert levels" subtitle="Below the reorder level shows a Reorder Warning; above the optimal level shows Optimal Stock.">
          <Thresholds value={data.thresholds} key={`${data.thresholds.reorder_below_kg}-${data.thresholds.optimal_above_kg}`} />
        </Panel>
      )}
    </div>
  )
}
