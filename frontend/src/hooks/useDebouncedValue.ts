import { useEffect, useState } from "react"

export const SEARCH_DEBOUNCE_MS = 250

// `value`, but only once it has stopped changing for `delayMs`.
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
