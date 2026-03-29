import { Link } from 'react-router-dom'

export default function Production() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Manufacturing</h2>
      </div>

      <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Updated Flow</p>
        <h2 className="mt-3 text-3xl font-semibold text-text-primary">Use Production Session (v2).</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
          Manufacturing is now logged via pooled floor materials. Stock is issued to the floor pool, and production
          consumes from that pool using gross/tare logging.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Link
            to="/production-session"
            className="block rounded-2xl border border-border-default bg-bg-input/15 px-5 py-4 text-sm font-semibold text-text-primary transition-colors hover:bg-white/[0.02]"
          >
            Go To Production Session
          </Link>
          <Link
            to="/stocks"
            className="block rounded-2xl border border-border-default bg-bg-input/15 px-5 py-4 text-sm font-semibold text-text-primary transition-colors hover:bg-white/[0.02]"
          >
            View Floor Stock
          </Link>
        </div>
      </div>
    </div>
  )
}

