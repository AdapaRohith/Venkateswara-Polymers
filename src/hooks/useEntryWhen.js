import { useState } from 'react'
import useStockMeta from './useStockMeta'
import { liveShiftContext, shiftWindows } from '../utils/ipms'

/** Date / shift / time for a new entry: the live shift until the operator picks another. */
export default function useEntryWhen() {
  const meta = useStockMeta()
  const [chosen, setChosen] = useState(null)
  const when = chosen || { ...liveShiftContext(shiftWindows(meta)), time: '' }
  return [when, setChosen]
}
