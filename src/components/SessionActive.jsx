import MaterialStatus from './MaterialStatus'
import LogTable from './LogTable'
import { formatKg } from '../utils/stock'

function formatDateTime(value) {
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

function MetricCard({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent-gold'
      : tone === 'success'
        ? 'text-emerald-400'
        : 'text-text-primary'

  return (
    <div className="rounded-2xl border border-border-default bg-bg-card/80 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}

function formatWorker(session) {
  if (session.workerName && session.workerId) {
    return `${session.workerName} (${session.workerId})`
  }

  return session.workerName || session.workerId || 'Unassigned'
}

export default function SessionActive({
  session,
  materials,
  logs,
  totalOutput,
  grossWeight,
  tareWeight,
  netWeight,
  loading,
  error,
  onGrossWeightChange,
  onTareWeightChange,
  onAddEntry,
  onComplete,
}) {
  const remainingStock = materials.reduce((sum, material) => sum + material.remainingQuantity, 0)

  const inputClass =
    'w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary transition-colors focus:border-accent-gold disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-border-default bg-bg-card shadow-lg shadow-black/20">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(25,178,179,0.22),_transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] px-6 py-7 md:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Production Session</p>
              <h1 className="mt-3 text-3xl font-semibold text-text-primary">{session.machineName}</h1>
              <p className="mt-3 text-sm leading-6 text-text-secondary">
                Started {formatDateTime(session.startedAt)}. Keep logging entries until the batch is complete, then reconcile waste once.
              </p>
            </div>
            <button
              type="button"
              onClick={onComplete}
              disabled={loading}
              className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Complete Batch'}
            </button>
          </div>
        </div>

        <div className="grid gap-4 border-t border-border-default bg-bg-input/15 px-6 py-5 md:grid-cols-3 md:px-8">
          <MetricCard label="Total Produced" value={formatKg(totalOutput)} tone="accent" />
          <MetricCard label="Entries Logged" value={String(logs.length)} />
          <MetricCard label="Estimated Remaining Stock" value={formatKg(remainingStock)} tone="success" />
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Live Material Status</p>
                <h2 className="mt-2 text-xl font-semibold text-text-primary">Allocated stock in this session</h2>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              {materials.map((material) => (
                <MaterialStatus key={material.id} material={material} />
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Session Log</p>
              <h2 className="mt-2 text-xl font-semibold text-text-primary">Production entries</h2>
            </div>
            <div className="mt-6">
              <LogTable logs={logs} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Add Entry</p>
              <h2 className="mt-2 text-xl font-semibold text-text-primary">Continuous weight logging</h2>
              <p className="mt-3 text-sm leading-6 text-text-secondary">
                Gross and tare are captured here. Net weight is previewed on the client and finalized by the backend.
              </p>
            </div>

            <form onSubmit={onAddEntry} className="mt-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Gross Weight</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={grossWeight}
                    onChange={(event) => onGrossWeightChange(event.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Tare Weight</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={tareWeight}
                    onChange={(event) => onTareWeightChange(event.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-accent-gold/20 bg-accent-gold/10 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent-gold/80">Net Weight Preview</p>
                <p className="mt-2 text-3xl font-semibold text-accent-gold">{netWeight > 0 ? formatKg(netWeight) : '0.00 kg'}</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-accent-gold px-5 py-4 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Saving Entry...' : 'Add Entry'}
              </button>
            </form>
          </div>

          <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Console Summary</p>
            <div className="mt-5 grid gap-4">
              <MetricCard label="Machine" value={session.machineName} />
              <MetricCard label="Worker" value={formatWorker(session)} />
              <MetricCard label="Started At" value={formatDateTime(session.startedAt)} />
              <MetricCard label="Material Lines" value={String(materials.length)} />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
