import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"
import { useAuth } from "@/auth/AuthContext"
import { useCustomersQuery } from "@/api/customers"
import { useGlobalSearchQuery } from "@/api/search"
import { Input } from "@/components/ui/input"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { getErrorMessage } from "@/lib/errors"
import { useContainerTitle } from "@/lib/readyToShip"
import {
  groupSearchResults,
  isSearchTruncated,
  type SearchSectionKey,
  type SearchTarget,
} from "@/lib/search"
import { cn } from "@/lib/utils"

const SECTION_LABEL_KEYS: Record<SearchSectionKey, string> = {
  pi: "search.sections.pi",
  readyToShip: "search.sections.readyToShip",
  shipped: "search.sections.shipped",
}

// The header search, on every page, for both roles: a material number or a
// part of its description (the tyre size lives there) across PI cards,
// "Ready to ship" and "Shipped". The dropdown groups hits by material.
export function GlobalSearch() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const containerTitle = useContainerTitle()
  const isOps = user?.role === "ops"
  const basePath = isOps ? "/ops" : "/client"
  const { data: customers } = useCustomersQuery()

  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)

  const trimmed = text.trim()
  const debounced = useDebouncedValue(trimmed)
  const query = useGlobalSearchQuery(debounced)
  // The answer on screen is for what's typed now (not an older text).
  const isCurrent = query.data?.query === trimmed && debounced === trimmed

  const groups = useMemo(
    () => (query.data ? groupSearchResults(query.data, basePath, isOps) : []),
    [query.data, basePath, isOps]
  )
  // Every clickable row, in screen order — what ↑/↓/Enter walk through.
  const targets = useMemo(() => groups.flatMap((group) => group.targets), [groups])

  useEffect(() => setActiveIndex(-1), [query.data])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const customerName = (id: string) =>
    isOps && customers && customers.length > 1
      ? customers.find((customer) => customer.id === id)?.name
      : undefined

  function go(target: SearchTarget) {
    setOpen(false)
    navigate(target.path)
  }

  function targetName(target: SearchTarget): string {
    switch (target.section) {
      case "pi":
        return target.hit.piLabel
          ? `PI ${target.hit.piNumber} · ${target.hit.piLabel}`
          : `PI ${target.hit.piNumber}`
      case "readyToShip":
        return containerTitle({
          label: target.hit.containerLabel,
          name: target.hit.containerName,
        })
      case "shipped":
        return target.hit.containerNumber
    }
  }

  function targetNote(target: SearchTarget): string | null {
    if (target.section === "pi" && target.hit.isShippedOnly) {
      return t("search.fullyShipped")
    }
    if (target.section === "readyToShip" && target.hit.isConfirmed) {
      return t("search.confirmed")
    }
    return null
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false)
      event.currentTarget.blur()
      return
    }
    if (!open || !isCurrent || targets.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % targets.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((i) => (i <= 0 ? targets.length - 1 : i - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      go(targets[Math.max(activeIndex, 0)])
    }
  }

  // Plain render helpers, not components: a component defined in here would
  // be a new type every render and remount the row under the mouse.
  const targetRow = (
    target: SearchTarget,
    index: number,
    children: React.ReactNode,
    className?: string
  ) => (
    <button
      key={target.key}
      type="button"
      role="option"
      aria-selected={index === activeIndex}
      data-testid="search-target"
      data-section={target.section}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => go(target)}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
        index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted",
        className
      )}
    >
      {children}
    </button>
  )

  const sectionPlace = (target: SearchTarget) => {
    const note = targetNote(target)
    const customer = customerName(target.hit.customerId)
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {t(SECTION_LABEL_KEYS[target.section])}
        </span>
        <span className="truncate">{targetName(target)}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
        {customer && <span className="text-xs text-muted-foreground">{customer}</span>}
      </span>
    )
  }

  let index = -1
  const showPanel = open && trimmed.length > 0

  return (
    <div ref={rootRef} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t("search.placeholder")}
        aria-label={t("search.aria")}
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        role="combobox"
        autoComplete="off"
        className="pl-8"
        data-testid="global-search-input"
      />

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          data-testid="global-search-results"
          className="absolute top-full left-0 z-40 mt-1 max-h-[70svh] w-full min-w-[22rem] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {query.isError && debounced === trimmed ? (
            <p className="px-3 py-2 text-sm text-destructive">
              {getErrorMessage(query.error, t("search.failed"))}
            </p>
          ) : !isCurrent ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("search.searching")}
            </p>
          ) : groups.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground" data-testid="search-nothing">
              {t("search.nothingFound")}
            </p>
          ) : (
            <>
              {groups.map((group) => {
                const material = (
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium tabular-nums">
                      {group.materialNum ?? "—"}
                    </span>
                    {group.materialDesc && (
                      <span className="truncate text-xs text-muted-foreground">
                        {group.materialDesc}
                      </span>
                    )}
                  </span>
                )
                if (group.targets.length === 1) {
                  const target = group.targets[0]
                  index += 1
                  return (
                    <div key={group.key}>
                      {targetRow(
                        target,
                        index,
                        <>
                          <span className="w-40 shrink-0">{material}</span>
                          {sectionPlace(target)}
                        </>
                      )}
                    </div>
                  )
                }
                return (
                  <div key={group.key} className="py-1" data-testid="search-group">
                    <div className="px-3 pt-1 pb-0.5 text-sm">{material}</div>
                    {group.targets.map((target) => {
                      index += 1
                      return targetRow(
                        target,
                        index,
                        sectionPlace(target),
                        "py-1.5 pl-6"
                      )
                    })}
                  </div>
                )
              })}
              {query.data && isSearchTruncated(query.data) && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {t("search.truncated")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
