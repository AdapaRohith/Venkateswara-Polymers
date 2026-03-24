import { useEffect, useState } from 'react'

export default function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => {
    const fallbackValue = typeof initialValue === 'function' ? initialValue() : initialValue

    try {
      const savedValue = localStorage.getItem(key)
      return savedValue ? JSON.parse(savedValue) : fallbackValue
    } catch (error) {
      console.error(`Failed to restore persisted state for ${key}`, error)
      return fallbackValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch (error) {
      console.error(`Failed to persist state for ${key}`, error)
    }
  }, [key, state])

  return [state, setState]
}
