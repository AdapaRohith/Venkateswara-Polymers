function formatTimestamp(value) {
  if (!value) return '-'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Cell({ label, value, accent = false }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-secondary/55">{label}</p>
      <p className={`mt-1 text-sm ${accent ? 'font-semibold text-accent-gold' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}

export default function LogTable({ logs }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-default bg-bg-input/20 px-5 py-8 text-center text-sm text-text-secondary">
        No production logs yet. Add the first weight entry to start the session.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-card">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-bg-input/30">
              <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">#</th>
              <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Gross</th>
              <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Tare</th>
              <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Net</th>
              <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, index) => (
              <tr key={log.id} className="border-b border-border-subtle last:border-b-0">
                <td className="px-5 py-3 text-text-secondary">{index + 1}</td>
                <td className="px-5 py-3 text-text-primary">{log.grossWeight.toFixed(2)}</td>
                <td className="px-5 py-3 text-text-primary">{log.tareWeight.toFixed(2)}</td>
                <td className="px-5 py-3 font-semibold text-accent-gold">{log.netWeight.toFixed(2)}</td>
                <td className="px-5 py-3 text-text-secondary">{formatTimestamp(log.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border-subtle md:hidden">
        {logs.map((log, index) => (
          <div key={log.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/60">Entry {index + 1}</p>
              <p className="text-xs text-text-secondary">{formatTimestamp(log.timestamp)}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Cell label="Gross" value={log.grossWeight.toFixed(2)} />
              <Cell label="Tare" value={log.tareWeight.toFixed(2)} />
              <Cell label="Net" value={log.netWeight.toFixed(2)} accent />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
