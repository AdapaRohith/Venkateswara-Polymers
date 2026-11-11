import { Link } from 'react-router-dom'
import { AlertTriangle, LayoutDashboard } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import api from '../utils/api'
import useLiveData from '../hooks/useLiveData'
import { formatBusinessDate } from '../utils/ipms'
import { EmptyState, PageHeader, Panel, ShiftBadge, StatTile, StockStatusBadge, Weight, td, th } from '../components/ipms/Kit'

const n1 = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function ShiftCard({ label, block }) {
  return (
    <div className="rounded-lg border border-border-default p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-secondary">{label}</p>
      {[['Plant (rolls)', block.plant], ['Cutting (finished)', block.cutting]].map(([name, b]) => (
        <div key={name} className="flex items-baseline justify-between gap-2 py-0.5 text-sm">
          <span className="text-text-secondary">{name}</span>
          <span className="tabular-nums"><strong>{n1(b.net_kg)}</strong> kg net
            <span className="ml-1 text-xs text-rose-500">−{n1(b.wastage_kg)} waste</span></span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { data, error } = useLiveData(() => api.get('/dashboard').then((r) => r.data), [], ['stock', 'production'])
  if (error) return <EmptyState>{error}</EmptyState>
  if (!data) return <EmptyState>Loading dashboard…</EmptyState>
  const s = data.stock
  const t = data.thresholds

  return (
    <div className="space-y-6">
      <PageHeader icon={LayoutDashboard} title="Dashboard"
        subtitle={<>Live plant position · {formatBusinessDate(data.live_business_date)} <ShiftBadge shift={data.live_shift} /></>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Ground Floor" kg={s.ground_floor_kg} tone="emerald" hint={<StockStatusBadge status={s.ground_floor_status} />} />
        <StatTile label="1st Floor Production" kg={s.first_floor_kg} tone="violet" hint={<StockStatusBadge status={s.first_floor_status} />} />
        <StatTile label="Raw material total" kg={s.raw_total_kg} tone="slate" hint={<StockStatusBadge status={s.raw_total_status} />} />
        <StatTile label="Roll Store" kg={s.roll_store_kg} tone="sky" hint="Rolls waiting for cutting" />
        <StatTile label="Finished Goods" kg={s.finished_store_kg} tone="amber" hint="Ready to dispatch" />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Today's production" subtitle="Gross − wastage = net, as on the shift sheet"
          actions={<Link to="/reports?tab=shift" className="text-xs font-semibold text-accent-gold hover:underline">Shift report →</Link>}>
          <div className="space-y-3">
            <ShiftCard label="Day" block={data.today.AM} />
            <ShiftCard label="Night" block={data.today.PM} />
            <ShiftCard label="Day & night" block={data.today.day_and_night} />
          </div>
        </Panel>

        <Panel title="Reorder warnings" className="xl:col-span-2"
          subtitle={`Materials below ${t.reorder_below_kg / 1000} t across both floors (or their own reorder level)`}
          actions={<Link to="/reports?tab=register" className="text-xs font-semibold text-accent-gold hover:underline">Inventory register →</Link>}>
          {!data.reorder.length ? <EmptyState>No material is below its reorder level.</EmptyState> : (
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full divide-y divide-border-default">
                <thead><tr><th className={th}>Material</th><th className={th}>Brand</th><th className={`${th} text-right`}>Ground</th><th className={`${th} text-right`}>1st Floor</th><th className={`${th} text-right`}>Total</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-border-default">
                  {data.reorder.map((m) => (
                    <tr key={m.id}>
                      <td className={`${td} font-semibold`}><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-500" />{m.name}</td>
                      <td className={td}>{m.brand || '—'}</td>
                      <td className={`${td} text-right`}><Weight kg={m.ground_floor_kg} /></td>
                      <td className={`${td} text-right`}><Weight kg={m.first_floor_kg} /></td>
                      <td className={`${td} text-right font-semibold`}><Weight kg={m.total_kg} /></td>
                      <td className={td}><StockStatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Last 14 days" subtitle={`Plant net ${n1(data.totals_14d.plant.net_kg)} kg (waste ${n1(data.totals_14d.plant.wastage_percent)}%) · Cutting net ${n1(data.totals_14d.cutting.net_kg)} kg (waste ${n1(data.totals_14d.cutting.wastage_percent)}%)`}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.trend.map((d) => ({ day: d.business_date.slice(5), plant: d.plant.net_kg, cutting: d.cutting.net_kg, waste: d.plant.wastage_kg + d.cutting.wastage_kg }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" fontSize={11} /><YAxis fontSize={11} />
              <Tooltip formatter={(v) => `${n1(v)} kg`} /><Legend />
              <Bar dataKey="plant" name="Plant net" fill="#2563eb" />
              <Bar dataKey="cutting" name="Cutting net" fill="#d97706" />
              <Bar dataKey="waste" name="Wastage" fill="#e11d48" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  )
}
