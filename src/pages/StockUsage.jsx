import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, ChevronDown, ChevronRight, Download } from 'lucide-react'

import { useToast } from '../components/Toast'
import useSSE from '../hooks/useSSE'
import useStockMeta from '../hooks/useStockMeta'
import api from '../utils/api'
import { exportSingleSheet } from '../utils/exportToExcel'
import { apiError, formatBusinessDate, shiftDate } from '../utils/ipms'
import { formatBags, formatWeight } from '../utils/units'
import { EmptyState, PageHeader, Panel, SecondaryButton, StatTile, Weight } from '../components/ipms/Kit'
import { inputInline } from '../components/ipms/styles'

const AM_COLOR = '#d97706'
const PM_COLOR = '#7c3aed'

export default function StockUsage() {
  const toast = useToast()
  const navigate = useNavigate()
  const meta = useStockMeta()
  const [picked, setRange] = useState({ from: '', to: '' })
  const [data, setData] = useState(null)
  const [open, setOpen] = useState({})
  // Default window: the last 14 business days up to the live day.
  const range = useMemo(() => (picked.to || !meta ? picked
    : { from: picked.from || shiftDate(meta.live_business_date, -13), to: meta.live_business_date }), [picked, meta])

  const load = useCallback(async () => {
    if (!range.to) return
    try {
      const { data: usage } = await api.get('/stock/usage', { params: { date_from: range.from, date_to: range.to } })
      setData(usage)
    } catch (error) {
      toast.error(apiError(error, 'Could not load usage'))
    }
  }, [range, toast])
  useEffect(() => { Promise.resolve().then(load) }, [load])
  useSSE(['production', 'stock'], load)

  const days = useMemo(() => data?.days || [], [data])
  const chart = useMemo(() => [...days].reverse().map((d) => ({
    day: formatBusinessDate(d.business_date, { weekday: false }).replace(/ \d{4}$/, ''),
    AM: d.shifts.AM.consumed_kg, PM: d.shifts.PM.consumed_kg,
  })), [days])
  const sum = (shift) => days.reduce((s, d) => s + Number(d.shifts[shift].consumed_kg || 0), 0)
  const activeDays = days.filter((d) => d.total_consumed_kg > 0).length

  const exportRows = () => {
    const rows = []
    for (const d of days) {
      for (const m of d.materials) {
        rows.push({ day: d.business_date, material: m.material_name, am: m.am_kg, pm: m.pm_kg, total: m.total_kg,
          bags: m.total_kg / 25, machine: m.from_machine_kg, floor: m.from_ground_floor_kg })
      }
    }
    exportSingleSheet({
      filename: `Day_Wise_Usage_${range.from}_to_${range.to}`,
      rows,
      columns: [
        { key: 'day', label: 'Business date' }, { key: 'material', label: 'Material' },
        { key: 'am', label: 'AM used (kg)' }, { key: 'pm', label: 'PM used (kg)' }, { key: 'total', label: 'Total (kg)' },
        { key: 'bags', label: 'Total (bags)' }, { key: 'machine', label: 'From machine stock (kg)' }, { key: 'floor', label: 'From Ground Floor (kg)' },
      ],
    })
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={BarChart3} title="Day-wise Stock Usage"
        subtitle="Material used in production per business day, split into the morning (AM) and night (PM) shift. Returned stock is never counted as usage."
        actions={(
          <>
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={`${inputInline} w-auto`} aria-label="From" />
            <input type="date" value={range.to} max={meta?.live_business_date} onChange={(e) => setRange({ ...range, to: e.target.value })} className={`${inputInline} w-auto`} aria-label="To" />
            <SecondaryButton onClick={exportRows} disabled={!days.length}><Download className="h-4 w-4" />Export</SecondaryButton>
          </>
        )} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Used in range" tone="emerald" kg={data?.total_consumed_kg} />
        <StatTile label="AM · Morning" tone="amber" kg={sum('AM')} />
        <StatTile label="PM · Night" tone="violet" kg={sum('PM')} />
        <StatTile label="Average per working day" tone="slate" kg={activeDays ? (data?.total_consumed_kg || 0) / activeDays : 0}
          hint={`${activeDays} day${activeDays === 1 ? '' : 's'} with production`} />
      </div>

      <Panel title="Usage by day and shift">
        {chart.every((c) => !c.AM && !c.PM) ? <EmptyState>No production usage in this range.</EmptyState> : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 288 }}>
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => formatWeight(v)} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v, name) => [`${formatWeight(v)} · ${formatBags(v)}`, name === 'AM' ? 'AM · Morning' : 'PM · Night']}
                  contentStyle={{ background: 'var(--bg-tooltip)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} />
                <Legend formatter={(v) => (v === 'AM' ? 'AM · Morning' : 'PM · Night')} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="AM" stackId="u" fill={AM_COLOR} radius={[0, 0, 0, 0]} />
                <Bar dataKey="PM" stackId="u" fill={PM_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="Daily register" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-[11px] uppercase tracking-wider text-text-secondary">
                <th className="px-4 py-2.5">Business day</th>
                <th className="px-4 py-2.5 text-right">AM used</th><th className="px-4 py-2.5 text-right">PM used</th>
                <th className="px-4 py-2.5 text-right">Day total</th><th className="px-4 py-2.5 text-right">Received</th>
                <th className="px-4 py-2.5 text-right">Moved between locations</th><th className="px-4 py-2.5 text-right">Entries · batches</th><th />
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const received = d.shifts.AM.received_kg + d.shifts.PM.received_kg
                const moved = d.shifts.AM.moved_kg + d.shifts.PM.moved_kg
                const entries = d.shifts.AM.entries + d.shifts.PM.entries
                const batches = d.shifts.AM.batches + d.shifts.PM.batches
                return [
                  <tr key={d.business_date} className="border-b border-border-subtle hover:bg-bg-row-hover">
                    <td className="px-4 py-2">
                      <button type="button" className="flex items-center gap-1.5 font-medium text-text-primary" disabled={!d.materials.length}
                        onClick={() => setOpen((o) => ({ ...o, [d.business_date]: !o[d.business_date] }))} aria-expanded={!!open[d.business_date]}>
                        {d.materials.length ? (open[d.business_date] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="w-4" />}
                        {formatBusinessDate(d.business_date)}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">{d.shifts.AM.consumed_kg ? <Weight kg={d.shifts.AM.consumed_kg} /> : '—'}</td>
                    <td className="px-4 py-2 text-right">{d.shifts.PM.consumed_kg ? <Weight kg={d.shifts.PM.consumed_kg} /> : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold">{d.total_consumed_kg ? <><Weight kg={d.total_consumed_kg} /><div className="text-[11px] font-normal text-text-secondary">{formatBags(d.total_consumed_kg)}</div></> : '—'}</td>
                    <td className="px-4 py-2 text-right">{received ? <Weight kg={received} /> : '—'}</td>
                    <td className="px-4 py-2 text-right">{moved ? <Weight kg={moved} /> : '—'}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{entries} · {batches}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => navigate(`/stock/ledger?view=shifts&date=${d.business_date}`)} className="text-xs font-semibold text-accent-gold hover:underline">Ledger</button>
                    </td>
                  </tr>,
                  open[d.business_date] && (
                    <tr key={`${d.business_date}-detail`} className="bg-bg-row-alt">
                      <td colSpan={8} className="px-4 py-2">
                        <table className="w-full text-xs">
                          <thead><tr className="text-left text-text-secondary"><th className="py-1">Material</th><th className="text-right">AM</th><th className="text-right">PM</th><th className="text-right">Total</th><th className="text-right">From machine stock</th><th className="text-right">From Ground Floor</th></tr></thead>
                          <tbody>
                            {d.materials.map((m) => (
                              <tr key={m.material_id} className="border-t border-border-subtle">
                                <td className="py-1 text-text-primary">{m.material_name}</td>
                                <td className="text-right">{formatWeight(m.am_kg)}</td><td className="text-right">{formatWeight(m.pm_kg)}</td>
                                <td className="text-right font-semibold">{formatWeight(m.total_kg)}</td>
                                <td className="text-right">{formatWeight(m.from_machine_kg)}</td><td className="text-right">{formatWeight(m.from_ground_floor_kg)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
