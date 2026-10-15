import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'

import { useToast } from '../components/Toast'
import api from '../utils/api'
import { apiError, formatBusinessDate } from '../utils/ipms'
import { EmptyState, PageHeader, Panel, PrimaryButton, ShiftBadge, StatusBadge, Weight } from '../components/ipms/Kit'
import { inputClass } from '../components/ipms/styles'

const KINDS = {
  RETURN: { label: 'Return', path: '/stock/returns' },
  STOCK: { label: 'Current stock', path: '/stock' },
  BATCH: { label: 'Production batch', path: '/production-batches' },
  TRANSFER: { label: 'Transfer', path: '/stock/transfers' },
  PRODUCTION: { label: 'Production entry', path: '/production-log' },
  RECEIPT: { label: 'Raw material receipt', path: '/raw-material' },
}

export default function StockSearch() {
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [response, setResponse] = useState(null)
  const [kind, setKind] = useState('')
  const q = (params.get('q') || '').trim()
  const searching = q.length >= 2

  useEffect(() => {
    if (!searching) return undefined
    let alive = true
    api.get('/stock/search', { params: { q } })
      .then(({ data }) => { if (alive) setResponse(data) })
      .catch((error) => {
        if (alive) setResponse({ query: q, results: [] })
        toast.error(apiError(error, 'Search failed'))
      })
    return () => { alive = false }
  }, [q, searching, toast])

  const result = searching && response?.query === q ? response : null
  const loading = searching && !result
  const results = (result?.results || []).filter((r) => !kind || r.kind === kind)

  return (
    <div className="space-y-5">
      <PageHeader icon={Search} title="Search Stock Records"
        subtitle="Search every stock document — returns, batches, transfers, production entries, receipts and current balances. Returned stock appears here marked RETURNED even though it no longer counts anywhere else." />

      <form onSubmit={(e) => { e.preventDefault(); setParams(query.trim() ? { q: query.trim() } : {}) }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-secondary" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-9`}
            placeholder="Material name, RT-/ST-/PB- number, party, size, note…" aria-label="Search stock records" />
        </div>
        <PrimaryButton type="submit">Search</PrimaryButton>
      </form>

      {result && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setKind('')} className={`rounded-full border px-3 py-1 text-xs font-semibold ${!kind ? 'border-accent-gold text-accent-gold' : 'border-border-default text-text-secondary'}`}>
            All {result.results.length}
          </button>
          {Object.entries(KINDS).map(([k, info]) => {
            const count = result.results.filter((r) => r.kind === k).length
            if (!count) return null
            return (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === k ? 'border-accent-gold text-accent-gold' : 'border-border-default text-text-secondary'}`}>
                {info.label} {count}
              </button>
            )
          })}
        </div>
      )}

      <Panel bodyClassName="p-0">
        {loading ? <div className="p-6 text-sm text-text-secondary">Searching…</div>
          : !result ? <div className="p-4"><EmptyState>Type at least two characters to search.</EmptyState></div>
            : results.length === 0 ? <div className="p-4"><EmptyState>Nothing matches “{result.query}”.</EmptyState></div> : (
              <ul className="divide-y divide-border-subtle">
                {results.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <button type="button" onClick={() => navigate(KINDS[r.kind]?.path || '/stock')}
                      className={`flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-bg-row-hover ${r.kind === 'RETURN' ? 'bg-rose-500/5' : ''}`}>
                      <span className="w-36 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{KINDS[r.kind]?.label || r.kind}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-sm font-semibold text-text-primary">{r.reference}</span>
                        <span className="ml-2 text-sm text-text-secondary">{r.material_name}</span>
                        {r.detail && <span className="block truncate text-xs text-text-secondary">{r.detail}</span>}
                      </span>
                      {r.business_date && <span className="text-xs text-text-secondary">{formatBusinessDate(r.business_date, { weekday: false })}</span>}
                      {r.shift && <ShiftBadge shift={r.shift} />}
                      <span className="w-24 text-right font-semibold"><Weight kg={r.quantity_kg} /></span>
                      <StatusBadge status={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
      </Panel>
    </div>
  )
}
