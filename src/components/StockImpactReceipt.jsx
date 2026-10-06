import { X } from 'lucide-react'

import { normalizeStockReceipt } from '../utils/stockLedger'


const formatKg = (value) => `${Number(value || 0).toFixed(2)} kg`

export default function StockImpactReceipt({ receipt, title = 'Stock updated', onDismiss }) {
  const values = normalizeStockReceipt(receipt)
  if (!values) return null

  const rows = [
    ['Warehouse Stock', values.warehouseOpeningKg, values.warehouseClosingKg],
    ['Floor Stock', values.floorOpeningKg, values.floorClosingKg],
    ['Total Plant Stock', values.plantOpeningKg, values.plantClosingKg],
  ]

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4" aria-live="polite">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <p className="mt-1 text-xs text-text-secondary">Nothing is missing. These balances include the change below.</p>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="rounded-md p-1 text-text-secondary hover:bg-white/10" aria-label="Dismiss stock receipt">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="grid gap-2">
        {rows.map(([label, opening, closing]) => {
          const change = closing - opening
          return (
            <div key={label} className="grid grid-cols-[1.25fr_repeat(3,minmax(0,1fr))] gap-2 rounded-xl bg-black/10 px-3 py-2 text-xs">
              <span className="font-medium text-text-primary">{label}</span>
              <span className="text-text-secondary"><span className="block text-[10px] uppercase">Opening</span>{formatKg(opening)}</span>
              <span className="text-text-secondary"><span className="block text-[10px] uppercase">Change</span>{change > 0 ? '+' : ''}{formatKg(change)}</span>
              <span className="font-semibold text-text-primary"><span className="block text-[10px] uppercase text-text-secondary">Closing</span>{formatKg(closing)}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
