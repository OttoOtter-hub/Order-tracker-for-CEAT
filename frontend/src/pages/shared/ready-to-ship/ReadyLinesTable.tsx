import { memo, useMemo, useState } from "react"
import { Search, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { SortableHead } from "@/components/SortableHead"
import { useTableSort } from "@/hooks/useTableSort"
import { formatNumber } from "@/lib/format"
import { isPlaceable, NOT_PLACEABLE_HINT } from "@/lib/readyToShip"
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
  const placeable = isPlaceable(line)
  return (
    <TableRow data-line-id={line.piLineItemId}>
      <TableCell className="text-xs">
        <div>{line.piNumber}</div>
        <div className="text-muted-foreground">SO {line.soNumber ?? "—"}</div>
      </TableCell>
      <TableCell className="max-w-44 whitespace-normal">
        <div className="font-medium">{line.materialNum ?? "—"}</div>
        <div className="text-xs text-muted-foreground">
          {line.materialDesc ?? "—"}
        </div>
        {!placeable && (
          <div
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
            title={NOT_PLACEABLE_HINT}
          >
            <TriangleAlert className="size-3" />
            нельзя разместить
          </div>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div className="font-medium">{formatNumber(String(line.remainingQty))}</div>
        {placeable && (
          <div className="text-xs text-muted-foreground">
            ≈ {(line.remainingQty / (line.loadability as number)).toFixed(2)} конт.
          </div>
        )}
      </TableCell>
      {canMove && (
        <TableCell className="text-right">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!placeable}
            title={placeable ? undefined : NOT_PLACEABLE_HINT}
            onClick={() => onMove(line)}
          >
            Переместить
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
}

export function ReadyLinesTable({ lines, canMove, onMove }: ReadyLinesTableProps) {
  const [query, setQuery] = useState("")
  const { sorted, sortKey, direction, toggleSort } = useTableSort<
    UnallocatedLine,
    SortKey
  >(lines, sortValue, "piNumber")

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((line) =>
      [line.piNumber, line.materialNum, line.materialDesc, line.soNumber].some(
        (field) => field?.toLowerCase().includes(needle)
      )
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
            placeholder="Поиск: материал, описание, PI, SO"
            aria-label="Поиск по списку готового"
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {query.trim()
            ? `Найдено ${visible.length} из ${lines.length}`
            : `Строк: ${lines.length}`}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Всё распределено — в списке готового ничего не осталось.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          По запросу «{query}» ничего не найдено.
        </p>
      ) : (
        // A plain <table> inside our own scroll box, not the shadcn <Table>
        // wrapper: that wrapper is itself an overflow container, which stops
        // `position: sticky` on the header from sticking to *this* box.
        <div className="max-h-[32rem] min-h-0 overflow-auto rounded-md border min-[1400px]:max-h-[calc(100svh-15rem)]">
          <table className="w-full text-sm" data-testid="ready-lines-table">
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--color-border)]">
              <TableRow className="hover:bg-transparent">
                <SortableHead {...headProps("piNumber")}>PI / SO</SortableHead>
                <SortableHead {...headProps("material")}>Материал</SortableHead>
                <SortableHead
                  {...headProps("remaining")}
                  className="[&>button]:ml-auto"
                >
                  Остаток
                </SortableHead>
                {canMove && <th className="w-px" aria-label="Действия" />}
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
