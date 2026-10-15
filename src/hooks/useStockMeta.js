import { useEffect, useState } from 'react'
import api from '../utils/api'

let cache = null
let inflight = null

/** Machines (with floors), shift windows and the live business date/shift. */
export default function useStockMeta() {
  const [meta, setMeta] = useState(cache)

  useEffect(() => {
    let alive = true
    if (!inflight) {
      inflight = api.get('/stock/meta')
        .then(({ data }) => { cache = data; return data })
        .catch(() => null)
        .finally(() => { setTimeout(() => { inflight = null }, 60_000) })
    }
    inflight.then((data) => { if (alive && data) setMeta(data) })
    return () => { alive = false }
  }, [])

  return meta
}
