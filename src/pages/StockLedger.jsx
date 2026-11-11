import { useState } from 'react'
import { CalendarCheck2, Lock } from 'lucide-react'

import api from '../utils/api'
import { useToast } from '../components/Toast'
import useLiveData from '../hooks/useLiveData'
import { apiError, formatBusinessDate, nowIST } from '../utils/ipms'
import { inputBase } from '../components/ipms/styles'
import { EmptyState, PageHeader, Panel, PrimaryButton, Weight, td, th } from '../components/ipms/Kit'
import { InventoryRegisterView } from './Reports'

/** Day ledger: the inventory register for one business day, and the owner's day close. */
export default function StockLedger({ user }) {
  const toast = useToast()
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'
  const [date, setDate] = useState(nowIST().date)
  const [note, setNote] = useState('')
  const closings = useLiveData(() => api.get('/stock/day-closings').then((r) => r.data), [])
  const closed = (closings.data || []).find((c) => c.business_date === date)

  const close = async () => {
    try {
      await api.post('/stock/day-close', { business_date: date, note })
      toast.success(`${formatBusinessDate(date)} closed`)
      setNote('')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={CalendarCheck2} title="Day Ledger & Close"
        subtitle="Opening, received, issued and closing stock for every store on one business day. Closing the day signs it off: workers can no longer post into it." />

      <Panel title={closed ? `Closed · ${formatBusinessDate(date)}` : `Close ${formatBusinessDate(date)}`}
        subtitle={closed ? `Closed by ${closed.closed_by_name || '—'} at ${String(closed.closed_at).replace('T', ' ').slice(0, 16)}${closed.note ? ` · ${closed.note}` : ''}` : 'Check the register below, then close the day.'}
        actions={<input type="date" aria-label="Business date" value={date} max={nowIST().date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputBase} w-auto`} />}>
        {isOwner ? (
          <div className="flex flex-wrap items-center gap-3">
            <input aria-label="Closing note" className={`${inputBase} min-w-64 flex-1`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <PrimaryButton onClick={close}><Lock className="h-4 w-4" />{closed ? 'Close again (refresh snapshot)' : 'Close day'}</PrimaryButton>
          </div>
        ) : <p className="text-sm text-text-secondary">Only an owner can close a day.</p>}
      </Panel>

      <InventoryRegisterView date={date} onDateChange={setDate} />

      <Panel title="Closed days">
        {!closings.data?.length ? <EmptyState>No day has been closed yet.</EmptyState> : (
          <table className="min-w-full divide-y divide-border-default">
            <thead><tr><th className={th}>Day</th><th className={`${th} text-right`}>Raw material closing</th><th className={th}>Closed by</th><th className={th}>Note</th></tr></thead>
            <tbody className="divide-y divide-border-default">
              {closings.data.map((c) => (
                <tr key={c.business_date} className="cursor-pointer hover:bg-bg-input/40" onClick={() => setDate(c.business_date)}>
                  <td className={`${td} font-semibold`}>{formatBusinessDate(c.business_date)}</td>
                  <td className={`${td} text-right`}><Weight kg={c.raw_closing_kg} /></td>
                  <td className={td}>{c.closed_by_name}</td>
                  <td className={`${td} text-text-secondary`}>{c.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}
