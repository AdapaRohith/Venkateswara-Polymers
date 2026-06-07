import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Reads `location.state.flashDate` set by a dashboard chart click, then scrolls
 * to and flash-highlights every table row whose `data-flash-date` attribute
 * starts with that value. A `YYYY-MM` value matches a whole month; a full
 * `YYYY-MM-DD` value matches a single day. State is cleared after firing so a
 * refresh or re-render does not re-trigger the flash.
 *
 * @param {boolean|number} ready - truthy once target rows are rendered (e.g. rows.length)
 */
export default function useFlashRows(ready) {
  const location = useLocation()
  const navigate = useNavigate()
  const firedRef = useRef(false)
  const flashDate = location.state?.flashDate

  useEffect(() => {
    if (!flashDate || !ready || firedRef.current) return

    const els = Array.from(document.querySelectorAll(`[data-flash-date^="${flashDate}"]`))
    if (els.length === 0) return

    firedRef.current = true
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    els.forEach((el) => {
      el.classList.add('flash-row')
      setTimeout(() => el.classList.remove('flash-row'), 2000)
    })

    // Clear the navigation state so refresh/re-render won't replay the flash.
    navigate(location.pathname, { replace: true, state: {} })
  }, [flashDate, ready, navigate, location.pathname])
}
