import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import { downloadFile } from '../utils/download'
import { formatBusinessDate, nowIST, shiftDate } from '../utils/ipms'
import { inputBase } from '../components/ipms/styles'
import { EmptyState, PageHeader, Panel, SecondaryButton, StockStatusBadge, td, th } from '../components/ipms/Kit'

const n = (v, d = 2) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const bagsFmt = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

function DownloadButton({ path, label = 'Download Excel' }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <SecondaryButton disabled={busy} onClick={async () => {
      setBusy(true)
      try { await downloadFile(path) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
    }}><Download className="h-4 w-4" />{busy ? 'Preparing…' : label}</SecondaryButton>
  )
}

function DateInput({ value, onChange, label }) {
  return <input type="date" aria-label={label} value={value} max={nowIST().date} onChange={(e) => e.target.value && onChange(e.target.value)} className={`${inputBase} w-auto`} />
}

function RegisterTable({ rows, subtotal, subtotalLabel, raw = true, totalRow }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border-default">
        <thead className="bg-[#1F3864] text-white">
          <tr>
            {raw && <th className={`${th} !text-white`}>Batch no.</th>}
            <th className={`${th} !text-white`}>{raw ? 'Material description' : 'Size'}</th>
            {raw && <th className={`${th} !text-white`}>Brand</th>}
            {raw ? ['Opening (bags)', 'Received (bags)', 'Issued (bags)', 'Closing (bags)'].map((h) => <th key={h} className={`${th} !text-white text-right`}>{h}</th>)
              : ['Opening (kg)', 'Produced (kg)', 'Issued (kg)'].map((h) => <th key={h} className={`${th} !text-white text-right`}>{h}</th>)}
            <th className={`${th} !text-white text-right`}>Closing (kg)</th>
            <th className={`${th} !text-white text-right`}>Tons</th>
            {raw && <th className={`${th} !text-white`}>Stock alert</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {rows.map((r) => (
            <tr key={`${r.item_kind}-${r.item_id}-${r.location || ''}`}>
              {raw && <td className={`${td} text-xs`}>{r.batch_no || (r.location === 'FIRST_FLOOR' ? 'RUNNING STOCK' : '—')}</td>}
              <td className={`${td} font-medium`}>{r.item_name}</td>
              {raw && <td className={td}>{r.brand || '—'}</td>}
              {raw ? ['opening_bags', 'received_bags', 'issued_bags', 'closing_bags'].map((k) => <td key={k} className={`${td} text-right tabular-nums`}>{bagsFmt(r[k])}</td>)
                : ['opening_kg', 'received_kg', 'issued_kg'].map((k) => <td key={k} className={`${td} text-right tabular-nums`}>{n(r[k])}</td>)}
              <td className={`${td} text-right tabular-nums`}>{n(r.closing_kg, 0)}</td>
              <td className={`${td} text-right tabular-nums font-semibold`}>{n(r.closing_kg / 1000)}</td>
              {raw && <td className={td}><StockStatusBadge status={r.status} /></td>}
            </tr>
          ))}
          {subtotal && (
            <tr className="bg-bg-input/60 font-bold">
              <td className={`${td} text-rose-600`} colSpan={raw ? 3 : 1}>{subtotalLabel}</td>
              {raw ? ['opening_bags', 'received_bags', 'issued_bags', 'closing_bags'].map((k) => <td key={k} className={`${td} text-right tabular-nums`}>{bagsFmt(subtotal[k])}</td>)
                : ['opening_kg', 'received_kg', 'issued_kg'].map((k) => <td key={k} className={`${td} text-right tabular-nums`}>{n(subtotal[k])}</td>)}
              <td className={`${td} text-right tabular-nums`}>{n(subtotal.closing_kg, 0)}</td>
              <td className={`${td} text-right tabular-nums`}>{n(subtotal.closing_kg / 1000)}</td>
              {raw && <td className={td}><StockStatusBadge status={subtotal.status} /></td>}
            </tr>
          )}
          {totalRow}
        </tbody>
      </table>
    </div>
  )
}

/** The plant's "Polymer Raw Material Inventory Register", plus Roll Store and Finished Goods. */
export function InventoryRegisterView({ date, onDateChange, actions }) {
  const { data, error } = useLiveData(() => api.get('/reports/inventory-register', { params: { date } }).then((r) => r.data), [date])
  if (error) return <EmptyState>{error}</EmptyState>
  if (!data) return <EmptyState>Loading…</EmptyState>
  const zone = (loc) => data.zones.find((z) => z.location === loc)
  const raw = ['GROUND_FLOOR', 'FIRST_FLOOR'].map(zone)
  const t = data.thresholds
  return (
    <div className="space-y-5">
      <Panel title="Polymer raw material inventory register"
        subtitle={`Stock thresholds: below ${t.reorder_below_kg / 1000} MT reorder warning · ${t.reorder_below_kg / 1000}–${t.optimal_above_kg / 1000} MT buffer stock · above ${t.optimal_above_kg / 1000} MT optimal stock`}
        actions={<>
          {onDateChange && <DateInput value={date} onChange={onDateChange} label="Register date" />}
          <DownloadButton path={`/reports/inventory-register.xlsx?date=${date}`} />
          {actions}
        </>}>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#1F3864] dark:text-sky-300">Executive consolidated summary · {formatBusinessDate(date)}</p>
        <RegisterTable raw
          rows={raw.map((z, i) => ({ ...z.subtotal, item_kind: 'ZONE', item_id: i, batch_no: `ZONE ${i + 1}`, item_name: z.label.toUpperCase(), brand: 'ALL BRANDS' }))}
          totalRow={(
            <tr className="bg-bg-input/60 font-bold">
              <td className={td} colSpan={3}>PLANT CONSOLIDATED TOTAL</td>
              {['opening_bags', 'received_bags', 'issued_bags', 'closing_bags'].map((k) => <td key={k} className={`${td} text-right tabular-nums`}>{bagsFmt(data.plant_raw_total[k])}</td>)}
              <td className={`${td} text-right tabular-nums`}>{n(data.plant_raw_total.closing_kg, 0)}</td>
              <td className={`${td} text-right tabular-nums`}>{n(data.plant_raw_total.closing_kg / 1000)}</td>
              <td className={td}><StockStatusBadge status={data.plant_raw_total.status} /></td>
            </tr>
          )} />
      </Panel>
      {raw.map((z, i) => (
        <Panel key={z.location} title={`${i + 1}. ${z.location === 'GROUND_FLOOR' ? 'Ground floor raw material bay' : '1st floor production'}`}>
          {z.rows.length ? <RegisterTable raw rows={z.rows} subtotal={z.subtotal}
            subtotalLabel={`${z.location === 'GROUND_FLOOR' ? 'GROUND FLOOR RAW MATERIAL BAY' : '1ST FLOOR PRODUCTION'} SUB-TOTAL`} />
            : <EmptyState>No stock on the {z.label}.</EmptyState>}
        </Panel>
      ))}
      <div className="grid gap-5 xl:grid-cols-2">
        {[['ROLL_STORE', '3. Roll store — extruder output'], ['FINISHED_STORE', '4. Finished goods — cutting output']].map(([loc, title]) => (
          <Panel key={loc} title={title}>
            {zone(loc).rows.length ? <RegisterTable raw={false} rows={zone(loc).rows} subtotal={zone(loc).subtotal} subtotalLabel="TOTAL" />
              : <EmptyState>Nothing in the {zone(loc).label}.</EmptyState>}
          </Panel>
        ))}
      </div>
    </div>
  )
}

function ShiftColumn({ title, block, cutting }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-default">
      <p className="bg-[#1F3864] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white">{title}</p>
      <table className="min-w-full text-sm">
        <thead><tr><th className={th}>MCN</th><th className={th}>Size</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Waste</th></tr></thead>
        <tbody className="divide-y divide-border-default">
          {block.entries.map((e) => (
            <tr key={e.id}>
              <td className={`${td} font-semibold`}>{e.machine_name}</td>
              <td className={td}>{cutting ? <>{e.output_code}<div className="text-[11px] text-text-secondary">from {e.input_code}</div></> : e.output_code}</td>
              <td className={`${td} text-right tabular-nums text-rose-600 dark:text-rose-400`}>{n(e.material_kg, 1)}</td>
              <td className={`${td} text-right tabular-nums`}>{n(e.wastage_kg, 1)}</td>
            </tr>
          ))}
          {!block.entries.length && <tr><td className={`${td} text-text-secondary`} colSpan={4}>No entries</td></tr>}
        </tbody>
      </table>
      <div className="space-y-0.5 border-t border-border-default px-3 py-2 text-sm">
        <p className="flex justify-between"><span className="font-semibold">GROSS</span><span className="tabular-nums">{n(block.gross_kg, 1)}</span></p>
        <p className="flex justify-between"><span className="font-semibold">WASTAGE</span><span className="tabular-nums text-rose-500">{n(block.wastage_kg, 1)}</span></p>
        <p className="flex justify-between rounded bg-yellow-300/70 px-1 font-bold text-black"><span>NET</span><span className="tabular-nums">{n(block.net_kg, 1)}</span></p>
      </div>
    </div>
  )
}

/** The plant's daily Day / Night sheet: plant (extruders) and cutting, gross − wastage = net. */
export function ShiftReportView({ date, onDateChange }) {
  const { data, error } = useLiveData(() => api.get('/reports/shift-production', { params: { date } }).then((r) => r.data), [date], ['production', 'stock'])
  if (error) return <EmptyState>{error}</EmptyState>
  if (!data) return <EmptyState>Loading…</EmptyState>
  return (
    <Panel title={`Production report · ${formatBusinessDate(date)}`}
      actions={<><DateInput value={date} onChange={onDateChange} label="Report date" /><DownloadButton path={`/reports/shift-production.xlsx?date=${date}`} /></>}>
      <div className="grid gap-4 xl:grid-cols-2">
        {[['AM', 'Day'], ['PM', 'Night']].map(([shift, label]) => (
          <div key={shift} className="space-y-2">
            <p className="rounded bg-orange-100 py-1 text-center text-sm font-bold text-rose-700 dark:bg-orange-500/20 dark:text-orange-200">{label.toUpperCase()}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ShiftColumn title="Plant report" block={data[shift].plant} />
              <ShiftColumn title="Cutting machine" block={data[shift].cutting} cutting />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[['Day & night plant', 'plant'], ['Day & night cutting', 'cutting']].map(([label, key]) => (
          <div key={key} className="flex items-center justify-between rounded-lg bg-sky-100 px-4 py-3 font-bold text-rose-700 dark:bg-sky-500/15 dark:text-sky-200">
            <span className="uppercase">{label}</span>
            <span className="tabular-nums text-text-primary">{n(data.day_and_night[key].net_kg, 1)} kg
              <span className="ml-2 text-xs font-normal text-text-secondary">yield {n(data.day_and_night[key].yield_percent, 1)}% · waste {n(data.day_and_night[key].wastage_percent, 1)}%</span></span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function SummaryView() {
  const today = nowIST().date
  const [from, setFrom] = useState(shiftDate(today, -13))
  const [to, setTo] = useState(today)
  const { data, error } = useLiveData(() => api.get('/reports/production-summary', { params: { date_from: from, date_to: to } }).then((r) => r.data), [from, to], ['production'])
  return (
    <div className="space-y-5">
      <Panel title="Production summary" actions={<>
        <DateInput value={from} onChange={setFrom} label="From" /><span className="text-text-secondary">to</span><DateInput value={to} onChange={setTo} label="To" />
        <DownloadButton path={`/reports/production-summary.xlsx?date_from=${from}&date_to=${to}`} />
      </>}>
        {error ? <EmptyState>{error}</EmptyState> : !data ? <EmptyState>Loading…</EmptyState> : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[['Plant net (rolls)', data.totals.plant.net_kg], ['Plant wastage', data.totals.plant.wastage_kg, data.totals.plant.wastage_percent],
                ['Cutting net (finished)', data.totals.cutting.net_kg], ['Cutting wastage', data.totals.cutting.wastage_kg, data.totals.cutting.wastage_percent]].map(([label, v, pct]) => (
                <div key={label} className="rounded-lg border border-border-default px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
                  <p className="text-lg font-bold tabular-nums">{n(v, 1)} kg{pct !== undefined && <span className="ml-1 text-xs font-normal text-text-secondary">({n(pct, 1)}%)</span>}</p>
                </div>
              ))}
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              {[['Plant efficiency (yield)', data.totals.plant.yield_percent, 'Net rolls per kg of material extruded'],
                ['Cutting efficiency (yield)', data.totals.cutting.yield_percent, 'Net finished goods per kg of rolls cut'],
                ['Late entries', null, `${data.totals.late_entries} of ${data.totals.entries} keyed in more than 4 h after their shift`]].map(([label, pct, hint]) => (
                <div key={label} className="rounded-lg border border-border-default px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
                  {pct !== null && <p className="text-lg font-bold tabular-nums">{n(pct, 1)}%</p>}
                  <p className="text-xs text-text-secondary">{hint}</p>
                </div>
              ))}
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.days.map((d) => ({ day: d.business_date.slice(5), plant: d.plant.net_kg, cutting: d.cutting.net_kg }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" fontSize={11} /><YAxis fontSize={11} />
                  <Tooltip formatter={(v) => `${n(v, 1)} kg`} /><Legend />
                  <Bar dataKey="plant" name="Plant net" fill="#2563eb" /><Bar dataKey="cutting" name="Cutting net" fill="#d97706" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>
      {data && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Machine-wise">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr><th className={th}>Machine</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Wastage</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Waste %</th><th className={`${th} text-right`}>Yield %</th></tr></thead>
              <tbody className="divide-y divide-border-default">
                {data.machines.map((m) => (
                  <tr key={m.machine_id}><td className={`${td} font-semibold`}>{m.machine_name}</td>
                    <td className={`${td} text-right tabular-nums`}>{n(m.gross_kg, 1)}</td><td className={`${td} text-right tabular-nums`}>{n(m.wastage_kg, 1)}</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{n(m.net_kg, 1)}</td><td className={`${td} text-right tabular-nums`}>{n(m.wastage_percent, 1)}</td><td className={`${td} text-right tabular-nums font-semibold`}>{n(m.yield_percent, 1)}</td></tr>
                ))}
                {!data.machines.length && <tr><td className={`${td} text-text-secondary`} colSpan={6}>No production in this period</td></tr>}
              </tbody>
            </table>
          </Panel>
          <Panel title="Raw material used">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr><th className={th}>Material</th><th className={th}>Brand</th><th className={`${th} text-right`}>Used (kg)</th><th className={`${th} text-right`}>Bags</th></tr></thead>
              <tbody className="divide-y divide-border-default">
                {data.material_usage.map((u) => (
                  <tr key={u.material_id}><td className={`${td} font-semibold`}>{u.material_name}</td><td className={td}>{u.brand}</td>
                    <td className={`${td} text-right tabular-nums`}>{n(u.used_kg, 1)}</td><td className={`${td} text-right tabular-nums`}>{bagsFmt(u.used_kg / 25)}</td></tr>
                ))}
                {!data.material_usage.length && <tr><td className={`${td} text-text-secondary`} colSpan={4}>No material used in this period</td></tr>}
              </tbody>
            </table>
          </Panel>
          <Panel title="Output by size" className="xl:col-span-2">
            <table className="min-w-full divide-y divide-border-default">
              <thead><tr><th className={th}>Section</th><th className={th}>Size</th><th className={`${th} text-right`}>Entries</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Wastage</th><th className={`${th} text-right`}>Net</th></tr></thead>
              <tbody className="divide-y divide-border-default">
                {data.sizes.map((s) => (
                  <tr key={`${s.kind}-${s.code}`}><td className={td}>{s.kind === 'EXTRUSION' ? 'Plant (rolls)' : 'Cutting'}</td><td className={`${td} font-semibold`}>{s.code}</td>
                    <td className={`${td} text-right`}>{s.entries}</td><td className={`${td} text-right tabular-nums`}>{n(s.gross_kg, 1)}</td>
                    <td className={`${td} text-right tabular-nums`}>{n(s.wastage_kg, 1)}</td><td className={`${td} text-right tabular-nums font-semibold`}>{n(s.net_kg, 1)}</td></tr>
                ))}
                {!data.sizes.length && <tr><td className={`${td} text-text-secondary`} colSpan={6}>No output in this period</td></tr>}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  )
}

const TABS = [['register', 'Inventory Register'], ['shift', 'Shift Production Report'], ['summary', 'Production Summary']]

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'register'
  const [date, setDate] = useState(nowIST().date)
  return (
    <div className="space-y-6">
      <PageHeader icon={FileSpreadsheet} title="Reports"
        subtitle="The plant's inventory register and day/night production sheet, generated from the stock ledger. Every report downloads as Excel." />
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id })}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${tab === id ? 'border-accent-gold bg-accent-gold text-white dark:text-black' : 'border-border-default text-text-secondary hover:text-text-primary'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'register' && <InventoryRegisterView date={date} onDateChange={setDate} />}
      {tab === 'shift' && <ShiftReportView date={date} onDateChange={setDate} />}
      {tab === 'summary' && <SummaryView />}
    </div>
  )
}
