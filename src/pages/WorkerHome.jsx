import { Link } from 'react-router-dom'
import { formatKg } from '../utils/stock'

function QuickCard({ step, title, description, to, tone = 'gold' }) {
  const toneClasses =
    tone === 'blue'
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
      : 'border-accent-gold/30 bg-accent-gold/10 text-accent-gold'

  return (
    <Link
      to={to}
      className="block rounded-2xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 transition-colors hover:border-accent-gold/40 hover:bg-white/[0.02]"
    >
      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${toneClasses}`}>
        {step}
      </div>
      <p className="mt-4 text-2xl font-semibold text-text-primary">{title}</p>
      <p className="mt-3 text-sm leading-6 text-text-secondary">{description}</p>
    </Link>
  )
}

export default function WorkerHome({ stockIssuances = [], ordersList = [] }) {
  const openIssuances = stockIssuances.filter((issuance) => issuance.remainingInKg > 0)
  const latestIssuance = openIssuances[0] || null

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-3xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-gold">Worker Home</p>
        <h1 className="mt-3 text-3xl font-semibold text-text-primary">Just two things to do.</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-text-secondary">
          First check your stock. Then open manufacturing and enter the roll details. If something looks wrong, stop and ask admin.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border-default bg-bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary/70">My Stock</p>
          <p className="mt-3 text-2xl font-semibold text-text-primary">
            {latestIssuance ? formatKg(latestIssuance.remainingInKg) : 'No stock'}
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            {latestIssuance
              ? latestIssuance.fromStockLabel
              : 'No stock has been issued to you yet.'}
          </p>
        </div>

        <div className="rounded-2xl border border-border-default bg-bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary/70">Open Orders</p>
          <p className="mt-3 text-2xl font-semibold text-text-primary">{ordersList.length}</p>
          <p className="mt-2 text-sm text-text-secondary">
            Active orders are already available inside the manufacturing page.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QuickCard
          step="Step 1"
          title="Check My Stock"
          description="Open your stock page and confirm that issued stock is showing before you begin work."
          to="/stocks"
          tone="blue"
        />
        <QuickCard
          step="Step 2"
          title="Start Manufacturing"
          description="Choose the order, enter the weights, and save the roll. Use only the stock already issued to you."
          to="/manufacturing"
        />
      </div>
    </div>
  )
}
