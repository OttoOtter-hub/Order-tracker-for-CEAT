import { useMemo } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SortableHead } from "@/components/SortableHead"
import { useAuth } from "@/auth/AuthContext"
import {
  useActualContainerQuery,
  type ActualContainer,
  type ActualContainerLineItem,
} from "@/api/actualContainers"
import { usePiListQuery } from "@/api/proformaInvoices"
import { ContainerDatesEditor } from "@/pages/shared/actual-containers/ContainerDatesEditor"
import { ContainerFiles } from "@/pages/shared/actual-containers/ContainerFiles"
import { DateCell } from "@/pages/shared/actual-containers/DateCell"
import { useTableSort } from "@/hooks/useTableSort"
import { formatDay, formatNumber } from "@/lib/format"
import { formatStatusValue, sumQuantities } from "@/lib/actualContainers"
import { getErrorMessage } from "@/lib/errors"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

type LineSortKey =
  | "piNumber"
  | "materialNum"
  | "materialDesc"
  | "quantity"
  | "invoiceNumber"
  | "pgiDate"

const LINE_COLUMNS: { key: LineSortKey; label: string }[] = [
  { key: "piNumber", label: "PI" },
  { key: "materialNum", label: "Материал" },
  { key: "materialDesc", label: "Описание" },
  { key: "quantity", label: "Кол-во" },
  { key: "invoiceNumber", label: "Инвойс" },
  { key: "pgiDate", label: "PGI дата" },
]

function lineSortValue(
  line: ActualContainerLineItem,
  key: LineSortKey
): string | number | null {
  return key === "quantity" ? Number(line.quantity) : line[key]
}

// Whether the ETA-15 sheet said anything about this container at all.
function hasEta15Data(container: ActualContainer): boolean {
  return [
    container.blNumber,
    container.currency,
    container.invoiceValue,
    container.documentsReleaseStatus,
    container.telexReleaseDate,
    container.paymentReceiptStatus,
  ].some((value) => value !== null)
}

export function ActualContainerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isOps = user?.role === "ops"
  const basePath = isOps ? "/ops" : "/client"

  const { data: container, isLoading, isError, error } = useActualContainerQuery(id)
  // A line's PI number links to the card only if that card exists (old
  // containers can belong to PIs that never had one here). The PI list is
  // already cached by the PI screens, so this is usually free.
  const { data: piList } = usePiListQuery()
  const piIdByNumber = useMemo(
    () => new Map((piList ?? []).map((pi) => [pi.piNumber, pi.id])),
    [piList]
  )

  const { sorted: lines, sortKey, direction, toggleSort } = useTableSort<
    ActualContainerLineItem,
    LineSortKey
  >(container?.lineItems, lineSortValue, "piNumber")

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка...</p>
  }
  if (isError || !container) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`${basePath}/actual-containers`)}
        >
          <ArrowLeft /> К списку
        </Button>
        <p className="text-sm text-muted-foreground">
          {isError
            ? getErrorMessage(error, "Контейнер не найден.")
            : "Контейнер не найден."}
        </p>
      </div>
    )
  }

  const files = container.files ?? []
  const totalQuantity = sumQuantities((container.lineItems ?? []).map((l) => l.quantity))

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => navigate(`${basePath}/actual-containers`)}
      >
        <ArrowLeft /> К списку
      </Button>

      <h1 className="text-xl font-semibold">{container.containerNumber}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Отправка</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Порт">{container.port ?? "—"}</Field>
            <Field label="Судно">{container.vesselName ?? "—"}</Field>
            <Field label="Preshipment invoice">
              {container.preshipmentInvoice ?? "—"}
            </Field>
            <Field label="Commercial invoice">
              {container.commercialInvoiceNumber ?? "—"}
            </Field>
            {!isOps && (
              <>
                <Field label="ETD">
                  <DateCell
                    value={container.etd}
                    overridden={container.isEtdOverridden}
                    sourceValue={container.sourceEtd}
                  />
                </Field>
                <Field label="ETA">
                  <DateCell
                    value={container.eta}
                    overridden={container.isEtaOverridden}
                    sourceValue={container.sourceEta}
                  />
                </Field>
              </>
            )}
          </dl>
          {isOps && (
            <ContainerDatesEditor
              key={`${container.overrideEtd}|${container.overrideEta}|${container.sourceEtd}|${container.sourceEta}`}
              container={container}
            />
          )}
        </CardContent>
      </Card>

      {hasEta15Data(container) && (
        <Card data-testid="eta15-card">
          <CardHeader>
            <CardTitle>Документы и оплата (ETA-15)</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {container.blNumber && <Field label="B/L">{container.blNumber}</Field>}
              {container.invoiceValue !== null && (
                <Field label="Сумма инвойса">
                  {formatNumber(container.invoiceValue)} {container.currency ?? ""}
                </Field>
              )}
              {container.invoiceValue === null && container.currency && (
                <Field label="Валюта">{container.currency}</Field>
              )}
              {container.documentsReleaseStatus !== null && (
                <Field label="Documents release">
                  {container.documentsReleaseStatus}
                </Field>
              )}
              {container.telexReleaseDate && (
                <Field label="Telex release">
                  {formatDay(container.telexReleaseDate)}
                </Field>
              )}
              {container.paymentReceiptStatus && (
                <Field label="Получение оплаты">
                  {formatStatusValue(container.paymentReceiptStatus)}
                </Field>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Позиции</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет позиций.</p>
          ) : (
            <Table data-testid="container-lines-table">
              <TableHeader>
                <TableRow>
                  {LINE_COLUMNS.map((col) => (
                    <SortableHead
                      key={col.key}
                      active={sortKey === col.key}
                      direction={direction}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                    </SortableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                  <TableCell>Всего</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell data-testid="lines-total">
                    {formatNumber(String(totalQuantity))}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
                {lines.map((line) => {
                  const piId = line.piNumber ? piIdByNumber.get(line.piNumber) : undefined
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="tabular-nums">
                        {line.piNumber === null ? (
                          "—"
                        ) : piId ? (
                          <Link
                            to={`${basePath}/pi/${piId}`}
                            className="underline underline-offset-4"
                            data-pi-link={line.piNumber}
                          >
                            {line.piNumber}
                          </Link>
                        ) : (
                          <span title="Карточки с таким номером PI нет">
                            {line.piNumber}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{line.materialNum ?? "—"}</TableCell>
                      <TableCell className="whitespace-normal">
                        {line.materialDesc ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatNumber(line.quantity)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {line.invoiceNumber ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDay(line.pgiDate)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Файлы</CardTitle>
        </CardHeader>
        <CardContent>
          <ContainerFiles containerId={container.id} files={files} canEdit={isOps} />
        </CardContent>
      </Card>
    </div>
  )
}
