import { useCallback, useEffect, useRef, useState } from 'react'
import useSSE from './useSSE'
import { apiError } from '../utils/ipms'

/**
 * Load data from `loader()` and reload it whenever `deps` change or the server
 * broadcasts one of `events` (another screen changed stock).
 */
export default function useLiveData(loader, deps = [], events = ['stock']) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await loaderRef.current())
      setError('')
    } catch (err) {
      setError(apiError(err, 'Could not load data'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useSSE(events, () => { reload() })
  return { data, error, loading, reload }
}
