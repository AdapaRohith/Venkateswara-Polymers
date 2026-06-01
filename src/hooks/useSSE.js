import { useEffect, useRef } from 'react'
import { BASE_URL } from '../utils/api'

export default function useSSE(events, onEvent) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const eventsRef = useRef(events)
  eventsRef.current = events

  useEffect(() => {
    let active = true
    let controller = new AbortController()

    const connect = async () => {
      const token = localStorage.getItem('token')
      if (!token || !active) return

      try {
        const res = await fetch(`${BASE_URL}/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (!res.ok || !res.body) throw new Error('SSE connect failed')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let pendingEvent = null

        while (active) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              pendingEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && pendingEvent === 'update') {
              try {
                const data = JSON.parse(line.slice(6))
                if (eventsRef.current.includes(data.type)) {
                  onEventRef.current(data.type)
                }
              } catch { /* ignore malformed */ }
              pendingEvent = null
            } else if (line === '') {
              pendingEvent = null
            }
          }
        }
      } catch {
        if (!active) return
      }

      if (active) setTimeout(connect, 3000)
    }

    connect()

    return () => {
      active = false
      controller.abort()
    }
  }, [])
}
