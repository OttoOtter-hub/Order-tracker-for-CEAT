import { memo, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Search, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { SortableHead } from "@/components/SortableHead"
import { useTableSort } from "@/hooks/useTableSort"
import { formatNumber, formatPiTitle } from "@/lib/format"
import { isPlaceable } from "@/lib/readyToShip"
import type { UnallocatedLine } from "@/api/readyToShip"

type SortKey = "piNumber" | "material" | "remaining"

function sortValue(line: UnallocatedLine, key: SortKey): string | number | null {
  switch (key) {
    case "piNumber":
      return line.piNumber
    case "material":
      return line.materialNum
    case "remaining":
      return line.remainingQty
  }
}

interface LineRowProps {
  line: UnallocatedLine
  canMove: boolean
  onMove: (line: UnallocatedLine) => void
}

// Memoised: with ~250 rows, typing in the search box or opening a dialog
// re-renders the page, and only the rows whose line object actually changed
// (a fresh view replaces all of them, but identical rows bail out here on
// the local-state re-renders in between) need to be diffed again.
const LineRow = memo(function LineRow({ line, canMove, onMove }: LineRowProps) {
  const { t } = useTranslation()
  const placeable = isPlaceable(line)
  return (
    <TableRow data-line-id={line.piLineItemId}>
      <TableCell className="text-xs">
        <div className="break-words">
          {formatPiTitle(line.piNumber, line.piLabel)}
        </div>
        <div className="text-muted-foreground">
          {t("readyToShip.list.so", { so: line.soNumber ?? "—" })}
        </div>
      </TableCell>
      <TableCell className="max-w-44 whitespace-normal">
        <div className="font-medium">{line.materialNum ?? "—"}</div>
        <div className="text-xs text-muted-foreground">
          {line.materialDesc ?? "—"}
        </div>
        {!placeable && (
          <div
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs text-warning-text dark:bg-warning/20"
            title={t("readyToShip.list.notPlaceableHint")}
          >
            <TriangleAlert className="size-3" />
            {t("readyToShip.list.notPlaceable")}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div className="font-medium">{formatNumber(String(line.remainingQty))}</div>
        {placeable && (
          <div className="text-xs text-muted-foreground">
            {t("readyToShip.list.approxContainers", {
              n: (line.remainingQty / (line.loadability as number)).toFixed(2),
            })}
          </div>
        )}
      </TableCell>
      {canMove && (
        <TableCell className="text-right">
          <Button
            type="button"
            size="xs"
            variant="outline"
            title={placeable ? undefined : t("readyToShip.list.notPlaceableHint")}
            onClick={() => onMove(line)}
          >
            {t("readyToShip.list.move")}
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
})

interface ReadyLinesTableProps {
  lines: UnallocatedLine[]
  // Client only; ops sees the same list read-only, without the button column.
  canMove: boolean
  onMove: (line: UnallocatedLine) => void
  // Extra controls next to the search box (the client's "Move remainder to
  // OK to mix").
  toolbar?: ReactNode
}

export function ReadyLinesTable({
  lines,
  canMove,
  onMove,
  toolbar,
}: ReadyLinesTableProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const { sorted, sortKey, direction, toggleSort } = useTableSort<
    UnallocatedLine,
    SortKey
  >(lines, sortValue, "piNumber")

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((line) =>
      [
        line.piNumber,
        line.piLabel,
        line.materialNum,
        line.materialDesc,
        line.soNumber,
      ].some((field) => field?.toLowerCase().includes(needle))
    )
  }, [sorted, query])

  const headProps = (key: SortKey) => ({
    active: sortKey === key,
    direction,
    onClick: () => toggleSort(key),
  })

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("readyToShip.list.searchPlaceholder")}
            aria-label={t("readyToShip.list.searchAria")}
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {query.trim()
            ? t("readyToShip.list.found", { n: visible.length, total: lines.length })
            : t("readyToShip.list.count", { n: lines.length })}
        </span>
        {toolbar && <div className="ml-auto">{toolbar}</div>}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("readyToShip.list.allDistributed")}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("readyToShip.list.noResults", { query })}
        </p>
      ) : (
        // A plain <table> inside our own scroll box, not the shadcn <Table>
        // wrapper: that wrapper is itself an overflow container, which stops
        // `position: sticky` on the header from sticking to *this* box.
        <div className="max-h-[32rem] min-h-0 overflow-auto rounded-md border min-[1400px]:max-h-[calc(100svh-15rem)]">
          <table className="w-full text-sm" data-testid="ready-lines-table">
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--color-border)]">
              <TableRow className="hover:bg-transparent">
                <SortableHead {...headProps("piNumber")}>
                  {t("readyToShip.list.colPiSo")}
                </SortableHead>
                <SortableHead {...headProps("material")}>
                  {t("readyToShip.list.colMaterial")}
                </SortableHead>
                <SortableHead
                  {...headProps("remaining")}
                  className="[&>button]:ml-auto"
                >
                  {t("readyToShip.list.colBalance")}
                </SortableHead>
                {canMove && (
                  <th className="w-px" aria-label={t("readyToShip.list.actionsAria")} />
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((line) => (
                <LineRow
                  key={line.piLineItemId}
                  line={line}
                  canMove={canMove}
                  onMove={onMove}
                />
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </div>
  )
}
