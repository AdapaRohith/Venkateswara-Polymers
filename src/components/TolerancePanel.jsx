function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatKg(value) {
  return `${toNumber(value).toFixed(2)} kg`
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(2)}%`
}

export default function TolerancePanel({ tolerance, title = 'Tolerance Check', context = '', expected, actual }) {
  if (!tolerance) return null

  const status = tolerance.tolerance_status || 'OK'
  const isBreach = status === 'BREACH'
  const expectedValue = expected ?? tolerance.expected
  const actualValue = actual ?? tolerance.actual

  return (
    <div className={`rounded-xl border p-4 ${
      isBreach ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/25 bg-emerald-500/10'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-text-secondary/70">{title}</p>
          {context && <p className="mt-1 text-sm text-text-primary">{context}</p>}
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${
          isBreach
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        }`}>
          {status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Expected</p>
          <p className="mt-1 font-mono text-sm text-text-primary">{formatKg(expectedValue)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Actual</p>
          <p className="mt-1 font-mono text-sm text-text-primary">{formatKg(actualValue)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Allowed</p>
          <p className="mt-1 font-mono text-sm text-text-primary">
            {formatKg(tolerance.lower_bound)} - {formatKg(tolerance.upper_bound)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Tolerance</p>
          <p className="mt-1 font-mono text-sm text-text-primary">{formatPercent(tolerance.tolerance_percent)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Deviation</p>
          <p className={`mt-1 font-mono text-sm font-semibold ${isBreach ? 'text-amber-300' : 'text-emerald-300'}`}>
            {formatPercent(tolerance.deviation_percent)}
          </p>
        </div>
      </div>
    </div>
  )
}
