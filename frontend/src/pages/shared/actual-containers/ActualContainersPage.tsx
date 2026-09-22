import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"
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
import { ArrivalMarker } from "@/pages/shared/actual-containers/ArrivalMarker"
import { DateCell } from "@/pages/shared/actual-containers/DateCell"
import { useTableSort } from "@/hooks/useTableSort"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

type SortKey =
  | "containerNumber"
  | "port"
  | "vesselName"
  | "etd"
  | "eta"
  | "commercialInvoiceNumber"

// Rendered either side of the (unsortable) "Arrival" column, which sits right
// after ETA — the two groups keep the header row a single hand-written block
// instead of one COLUMNS.map() that the Arrival header would have to interrupt.
const COLUMNS_THROUGH_ETA: { key: SortKey; labelKey: string }[] = [
  { key: "containerNumber", labelKey: "shipped.columns.container" },
  { key: "port", labelKey: "shipped.columns.port" },
  { key: "vesselName", labelKey: "shipped.columns.vessel" },
  { key: "etd", labelKey: "shipped.columns.etd" },
  { key: "eta", labelKey: "shipped.columns.eta" },
]
const COLUMNS_AFTER_ETA: { key: SortKey; labelKey: string }[] = [
  { key: "commercialInvoiceNumber", labelKey: "shipped.columns.commercialInvoice" },
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
    container.commercialInvoiceNumber,
    container.blNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

// Used by /ops/actual-containers and /client/actual-containers — the same
// read-only picture; the API scopes a client to their own customer.
export function ActualContainersPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useActualContainersQuery()
  const [query, setQuery] = useState("")
  const isClient = user?.role === "client"
  const basePath = isClient ? "/client" : "/ops"

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
          <h1 className="text-xl font-semibold">{t("shipped.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("shipped.description")}
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shipped.searchPlaceholder")}
            aria-label={t("shipped.searchAria")}
            className="pl-8"
          />
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {getErrorMessage(error, t("shipped.loadFailed"))}
          </p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => refetch()}
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("shipped.empty")}
        </p>
      )}

      {data && data.length > 0 && (
        <Card>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              {query.trim()
                ? t("shipped.found", { n: visible.length, total: data.length })
                : t("shipped.count", { n: data.length })}
            </p>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("shipped.noResults", { query })}
              </p>
            ) : (
              <Table data-testid="actual-containers-table">
                <TableHeader>
                  <TableRow>
                    {COLUMNS_THROUGH_ETA.map((col) => (
                      <SortableHead
                        key={col.key}
                        active={sortKey === col.key}
                        direction={direction}
                        onClick={() => toggleSort(col.key)}
                      >
                        {t(col.labelKey)}
                      </SortableHead>
                    ))}
                    <TableHead>{t("shipped.columns.arrival")}</TableHead>
                    {COLUMNS_AFTER_ETA.map((col) => (
                      <SortableHead
                        key={col.key}
                        active={sortKey === col.key}
                        direction={direction}
                        onClick={() => toggleSort(col.key)}
                      >
                        {t(col.labelKey)}
                      </SortableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((container) => (
                    <TableRow
                      key={container.id}
                      data-container-number={container.containerNumber}
                      data-has-files={container.filesCount > 0}
                      className={cn(
                        "cursor-pointer",
                        // A file is attached: light green, nothing more to it.
                        container.filesCount > 0 &&
                          "bg-green-50 hover:bg-green-100/70 dark:bg-green-500/10 dark:hover:bg-green-500/15"
                      )}
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
                      <TableCell className="whitespace-normal">
                        <ArrivalMarker container={container} canConfirm={isClient} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {container.commercialInvoiceNumber ?? "—"}
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
