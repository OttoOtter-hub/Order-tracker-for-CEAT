import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SortableHead } from "@/components/SortableHead"
import { useAuth } from "@/auth/AuthContext"
import { useActualContainersQuery, type ActualContainer } from "@/api/actualContainers"
import { DateCell } from "@/pages/shared/actual-containers/DateCell"
import { useTableSort } from "@/hooks/useTableSort"
import { formatDay } from "@/lib/format"
import { formatStatusValue } from "@/lib/actualContainers"
import { getErrorMessage } from "@/lib/errors"

type SortKey =
  | "containerNumber"
  | "port"
  | "vesselName"
  | "etd"
  | "eta"
  | "preshipmentInvoice"
  | "commercialInvoiceNumber"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "containerNumber", label: "Контейнер" },
  { key: "port", label: "Порт" },
  { key: "vesselName", label: "Судно" },
  { key: "etd", label: "ETD" },
  { key: "eta", label: "ETA" },
  { key: "preshipmentInvoice", label: "Preshipment invoice" },
  { key: "commercialInvoiceNumber", label: "Commercial invoice" },
]

// ISO "YYYY-MM-DD" strings order correctly as text; missing dates sink to the
// bottom in both directions (useTableSort keeps nulls last).
function sortValue(container: ActualContainer, key: SortKey): string | null {
  return container[key]
}

function searchText(container: ActualContainer): string {
  return [
    container.containerNumber,
    container.port,
    container.vesselName,
    container.preshipmentInvoice,
    container.commercialInvoiceNumber,
    container.blNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

// Only what the "ETA-15 days" sheet actually filled in — a container outside
// that week's sample shows nothing here rather than a row of dashes.
function Eta15Badges({ container }: { container: ActualContainer }) {
  const badges: { label: string; title: string }[] = []
  if (container.blNumber) {
    badges.push({ label: `B/L ${container.blNumber}`, title: "Коносамент (B/L)" })
  }
  if (container.telexReleaseDate) {
    badges.push({
      label: `Telex ${formatDay(container.telexReleaseDate)}`,
      title: "Дата telex release",
    })
  }
  if (container.paymentReceiptStatus) {
    badges.push({
      label: `Оплата: ${formatStatusValue(container.paymentReceiptStatus)}`,
      title: "Статус получения оплаты",
    })
  }
  if (badges.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap gap-1" data-testid="eta15-badges">
      {badges.map((badge) => (
        <Badge key={badge.label} variant="secondary" title={badge.title}>
          {badge.label}
        </Badge>
      ))}
    </div>
  )
}

// Used by /ops/actual-containers and /client/actual-containers — the same
// read-only picture; the API scopes a client to their own customer.
export function ActualContainersPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useActualContainersQuery()
  const [query, setQuery] = useState("")
  const basePath = user?.role === "ops" ? "/ops" : "/client"

  // "Nearest first": ETA ascending, containers without an ETA last.
  const { sorted, sortKey, direction, toggleSort } = useTableSort<
    ActualContainer,
    SortKey
  >(data, sortValue, "eta")

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? sorted.filter((c) => searchText(c).includes(needle)) : sorted
  }, [sorted, query])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Готовые контейнеры</h1>
          <p className="text-sm text-muted-foreground">
            Контейнеры, которые CEAT уже отгрузил, по данным еженедельного файла.
            Дата, изменённая вручную, выделена и помечена карандашом.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: контейнер, судно, порт, инвойс, B/L"
            aria-label="Поиск по контейнерам"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {isError && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {getErrorMessage(error, "Не удалось загрузить контейнеры")}
          </p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => refetch()}
          >
            Повторить
          </button>
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Пока нет ни одного контейнера — они появятся после загрузки
          еженедельного файла бэкордера с листами отгрузок.
        </p>
      )}

      {data && data.length > 0 && (
        <Card>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              {query.trim()
                ? `Найдено ${visible.length} из ${data.length}`
                : `Контейнеров: ${data.length}`}
            </p>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                По запросу «{query}» ничего не найдено.
              </p>
            ) : (
              <Table data-testid="actual-containers-table">
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((col) => (
                      <SortableHead
                        key={col.key}
                        active={sortKey === col.key}
                        direction={direction}
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.label}
                      </SortableHead>
                    ))}
                    <TableHead>ETA-15</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((container) => (
                    <TableRow
                      key={container.id}
                      data-container-number={container.containerNumber}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate(`${basePath}/actual-containers/${container.id}`)
                      }
                    >
                      <TableCell className="font-medium">
                        <Link
                          to={`${basePath}/actual-containers/${container.id}`}
                          className="underline-offset-4 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {container.containerNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{container.port ?? "—"}</TableCell>
                      <TableCell className="whitespace-normal">
                        {container.vesselName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <DateCell
                          value={container.etd}
                          overridden={container.isEtdOverridden}
                          sourceValue={container.sourceEtd}
                        />
                      </TableCell>
                      <TableCell>
                        <DateCell
                          value={container.eta}
                          overridden={container.isEtaOverridden}
                          sourceValue={container.sourceEta}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {container.preshipmentInvoice ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {container.commercialInvoiceNumber ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Eta15Badges container={container} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
