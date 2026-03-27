import { formatKg } from '../utils/stock'

export default function MaterialStatus({ material }) {
  const usedPercentage =
    material.initialQuantity > 0
      ? Math.min((material.usedQuantity / material.initialQuantity) * 100, 100)
      : 0

  return (
    <div className="rounded-2xl border border-border-default bg-bg-input/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Material</p>
          <h4 className="mt-2 text-base font-semibold text-text-primary">{material.label}</h4>
        </div>
        <div className="rounded-full border border-accent-gold/20 bg-accent-gold/10 px-3 py-1 text-xs font-semibold text-accent-gold">
          {usedPercentage.toFixed(0)}% used
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-border-default">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-gold to-emerald-400 transition-all duration-300"
          style={{ width: `${usedPercentage}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-border-default/70 bg-bg-card/80 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary/60">Initial</p>
          <p className="mt-1 font-semibold text-text-primary">{formatKg(material.initialQuantity)}</p>
        </div>
        <div className="rounded-xl border border-border-default/70 bg-bg-card/80 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary/60">Remaining</p>
          <p className="mt-1 font-semibold text-emerald-400">{formatKg(material.remainingQuantity)}</p>
        </div>
      </div>
    </div>
  )
}
