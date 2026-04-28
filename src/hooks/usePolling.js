import { useEffect } from 'react'

/**
 * Hook to poll data at regular intervals
 * @param {Function} fetchFn - Async function to call for fetching data
 * @param {number} interval - Interval in ms (default: 10000ms = 10s)
 * @param {boolean} enabled - Whether polling is enabled (default: true)
 * @param {Array} deps - Dependency array to trigger refetch
 */
export function usePolling(fetchFn, interval = 10000, enabled = true, deps = []) {
  useEffect(() => {
    if (!enabled || !fetchFn) return

    // Call immediately on mount
    fetchFn()

    // Set up interval
    const pollInterval = setInterval(fetchFn, interval)

    // Cleanup interval on unmount
    return () => clearInterval(pollInterval)
  }, [enabled, fetchFn, interval, ...deps])
}
