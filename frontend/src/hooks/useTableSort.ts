import { useMemo, useState } from "react"

export type SortDirection = "asc" | "desc"

export function useTableSort<T, K extends string>(
  data: T[] | undefined,
  getValue: (item: T, key: K) => string | number | null,
  initialKey: K,
  initialDirection: SortDirection = "asc"
) {
  const [sortKey, setSortKey] = useState<K>(initialKey)
  const [direction, setDirection] = useState<SortDirection>(initialDirection)

  function toggleSort(key: K) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setDirection("asc")
    }
  }

  const sorted = useMemo(() => {
    if (!data) return []
    const copy = [...data]
    copy.sort((a, b) => {
      const av = getValue(a, sortKey)
      const bv = getValue(b, sortKey)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      let cmp: number
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv))
      }
      return direction === "asc" ? cmp : -cmp
    })
    return copy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sortKey, direction])

  return { sorted, sortKey, direction, toggleSort }
}
