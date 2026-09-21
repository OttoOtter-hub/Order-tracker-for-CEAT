import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/StatusBadge"
import { SortableHead } from "@/components/SortableHead"
import { FileUploadForm } from "@/components/FileUploadForm"
import { AddAdditionalFileForm } from "@/pages/shared/AddAdditionalFileForm"
import { PriorityInput } from "@/pages/shared/PriorityInput"
import { useAuth } from "@/auth/AuthContext"
import {
  usePiDetailQuery,
  useUploadPiMutation,
  useUploadSignedMutation,
  useAddAdditionalFileMutation,
  useProposeReplacementMutation,
  useReplacementDecisionMutation,
  useResetPriorityMutation,
  exportPiXlsx,
  type PiLineItem,
} from "@/api/proformaInvoices"
import { useUpdatePriorityMutation } from "@/api/piLineItems"
import { PI_STATUS } from "@/lib/statusStyles"
import { formatDateTime, formatNumber } from "@/lib/format"
import { openFile } from "@/lib/download"
import { getErrorMessage } from "@/lib/errors"
import { useTableSort } from "@/hooks/useTableSort"
import { sumByLoadabilityGroups } from "@/lib/sumByLoadability"

const PRIORITY_SAVE_DEBOUNCE_MS = 500

function DownloadButton({ url, label = "Скачать" }: { url: string; label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        openFile(url).catch(() => toast.error("Не удалось скачать файл"))
      }
    >
      {label}
    </Button>
  )
}

const LINE_ITEM_COLUMNS = [
  { key: "materialNum", label: "Материал" },
  { key: "materialDesc", label: "Описание" },
  { key: "balanceToBeDelivered", label: "Остаток" },
  { key: "quantity", label: "Кол-во" },
  { key: "mt", label: "MT" },
  { key: "loadFactor", label: "Load Factor" },
  { key: "loadability", label: "Loadability" },
  { key: "plan", label: "План недели" },
  { key: "priorityQty", label: "Приоритет" },
] as const

type LineItemSortKey = (typeof LINE_ITEM_COLUMNS)[number]["key"]

function lineItemSortValue(
  item: PiLineItem,
  key: LineItemSortKey
): string | number | null {
  if (key === "plan") {
    return item.currentWeekDispatchQty !== null
      ? Number(item.currentWeekDispatchQty)
      : null
  }
  if (key === "materialNum" || key === "materialDesc") {
    return item[key]
  }
  const value = item[key]
  return value !== null ? Number(value) : null
}

// Sum of a numeric PiLineItem field across *all* of the PI's line items —
// deliberately takes the full pi.lineItems array, not the sorted/displayed
// one, so the totals row never shifts with sort order (sorting only
// reorders rows, it never drops any, but summing the source array instead
// of the derived one keeps that invariant explicit rather than incidental).
function sumField(
  items: PiLineItem[],
  key: "mt" | "loadFactor" | "currentWeekDispatchLoadFactor"
): number {
  return items.reduce((total, item) => {
    const value = item[key]
    return total + (value !== null ? Number(value) : 0)
  }, 0)
}

export function PiDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: pi, isLoading } = usePiDetailQuery(id)

  const [proposeOpen, setProposeOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isPriorityMode, setIsPriorityMode] = useState(false)
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, number>>({})
  const priorityDebounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const uploadPi = useUploadPiMutation()
  const uploadSigned = useUploadSignedMutation(id ?? "")
  const addAdditionalFile = useAddAdditionalFileMutation(id ?? "")
  const proposeReplacement = useProposeReplacementMutation(id ?? "")
  const replacementDecision = useReplacementDecisionMutation(id ?? "")
  const updatePriority = useUpdatePriorityMutation(id ?? "")
  const resetPriority = useResetPriorityMutation(id ?? "")

  const basePath = user?.role === "ops" ? "/ops" : "/client"
  const isOps = user?.role === "ops"
  const isClient = user?.role === "client"

  const { sorted: sortedLineItems, sortKey, direction, toggleSort } =
    useTableSort<PiLineItem, LineItemSortKey>(
      pi?.lineItems,
      lineItemSortValue,
      "materialNum"
    )

  // Seeds the draft map from the server once per PI, not on every
  // background refetch of the *same* PI (e.g. one triggered by another
  // row's own debounced save) — otherwise a save-in-flight on one row
  // could stomp an unsaved edit the user is still typing into another.
  useEffect(() => {
    if (!pi) return
    const initial: Record<string, number> = {}
    for (const item of pi.lineItems ?? []) {
      initial[item.id] = Number(item.priorityQty)
    }
    setPriorityDrafts(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi?.id])

  useEffect(() => {
    const timers = priorityDebounceTimers.current
    return () => {
      for (const timer of Object.values(timers)) {
        clearTimeout(timer)
      }
    }
  }, [])

  function handlePriorityChange(lineItemId: string, value: number) {
    setPriorityDrafts((prev) => ({ ...prev, [lineItemId]: value }))

    const timers = priorityDebounceTimers.current
    if (timers[lineItemId]) {
      clearTimeout(timers[lineItemId])
    }
    timers[lineItemId] = setTimeout(() => {
      updatePriority.mutate(
        { lineItemId, priorityQty: value },
        {
          onError: (error) =>
            toast.error(
              getErrorMessage(error, "Не удалось сохранить приоритет")
            ),
        }
      )
    }, PRIORITY_SAVE_DEBOUNCE_MS)
  }

  function handleResetPriority() {
    if (!window.confirm("Сбросить весь приоритет по этой проформе?")) {
      return
    }
    // A pending per-row debounced save landing after this would silently
    // resurrect a stale value on top of the reset — nothing left to save.
    for (const timer of Object.values(priorityDebounceTimers.current)) {
      clearTimeout(timer)
    }
    priorityDebounceTimers.current = {}

    resetPriority.mutate(undefined, {
      onSuccess: (updatedPi) => {
        const zeroed: Record<string, number> = {}
        for (const item of updatedPi.lineItems ?? []) {
          zeroed[item.id] = 0
        }
        setPriorityDrafts(zeroed)
        toast.success("Приоритет сброшен")
      },
      onError: (error) =>
        toast.error(
          getErrorMessage(error, "Не удалось сбросить приоритет")
        ),
    })
  }

  const livePriorityTotals = useMemo(() => {
    const items = pi?.lineItems ?? []
    let totalQty = 0
    const forContainers: Array<{ value: number; loadability: number | null }> = []
    for (const item of items) {
      const value = priorityDrafts[item.id] ?? Number(item.priorityQty)
      totalQty += value
      forContainers.push({
        value,
        loadability: item.loadability !== null ? Number(item.loadability) : null,
      })
    }
    return {
      totalQty,
      totalContainers: sumByLoadabilityGroups(forContainers),
    }
  }, [pi?.lineItems, priorityDrafts])

  const editModeActive = isClient && isPriorityMode && !pi?.isArchivedShipped

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка...</p>
  }
  if (!pi) {
    return <p className="text-sm text-muted-foreground">Карточка не найдена.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => navigate(`${basePath}/pi`)}
      >
        <ArrowLeft /> К списку
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{pi.piNumber}</h1>
        <StatusBadge status={pi.status} map={PI_STATUS} />
        {isOps && (
          <span className="text-sm text-muted-foreground">
            {pi.customer.name}
          </span>
        )}
        {isClient && !pi.isArchivedShipped && (
          <Button
            variant={isPriorityMode ? "default" : "outline"}
            size="sm"
            className="ml-auto"
            onClick={() => setIsPriorityMode((v) => !v)}
          >
            {isPriorityMode ? "Готово" : "Режим приоритизации"}
          </Button>
        )}
        {isPriorityMode && (
          <Button
            variant="outline"
            size="sm"
            disabled={resetPriority.isPending}
            onClick={handleResetPriority}
          >
            {resetPriority.isPending ? "Сброс..." : "Сбросить"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className={isClient && !pi.isArchivedShipped ? "" : "ml-auto"}
          disabled={isExporting}
          onClick={() => {
            setIsExporting(true)
            exportPiXlsx(pi.id)
              .catch(() =>
                toast.error("Не удалось выгрузить Excel")
              )
              .finally(() => setIsExporting(false))
          }}
        >
          {isExporting ? "Выгрузка..." : "Скачать Excel"}
        </Button>
      </div>

      {/* Aggregates: the same "Всего / Ожидает" as on the list card, plus what has
          already shipped (0 is shown as 0 — "nothing shipped yet" is information). */}
      <div
        className="flex flex-wrap gap-x-6 gap-y-1 text-sm"
        data-testid="pi-aggregates"
      >
        <div>
          <span className="text-muted-foreground">Всего: </span>
          {formatNumber(pi.totalQty)}
        </div>
        <div>
          <span className="text-muted-foreground">Ожидает: </span>
          {formatNumber(pi.qtyPending)}
        </div>
        <div data-testid="pi-shipped">
          <span className="text-muted-foreground">Отправлено: </span>
          {formatNumber(pi.shippedQty)}
        </div>
      </div>

      {/* Files */}
      <Card>
        <CardHeader>
          <CardTitle>Файлы</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Original PI file */}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">Исходная проформа</h3>
            {pi.piFileUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <DownloadButton url={pi.piFileUrl} />
                <span className="text-xs text-muted-foreground">
                  загружено {formatDateTime(pi.piFileUploadedAt)}
                  {pi.piFileUploadedBy && ` · ${pi.piFileUploadedBy.email}`}
                </span>
                {isOps && !pi.pendingReplacementFileUrl && (
                  <Dialog open={proposeOpen} onOpenChange={setProposeOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Предложить замену
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Предложить замену файла</DialogTitle>
                      </DialogHeader>
                      <FileUploadForm
                        accept=".pdf,application/pdf"
                        submitLabel="Предложить"
                        isSubmitting={proposeReplacement.isPending}
                        onSubmit={(file) =>
                          proposeReplacement.mutate(file, {
                            onSuccess: () => {
                              setProposeOpen(false)
                              toast.success("Замена предложена клиенту")
                            },
                            onError: (error) =>
                              toast.error(
                                getErrorMessage(
                                  error,
                                  "Не удалось предложить замену"
                                )
                              ),
                          })
                        }
                      />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            ) : isOps ? (
              <FileUploadForm
                accept=".pdf,application/pdf"
                submitLabel="Загрузить проформу"
                isSubmitting={uploadPi.isPending}
                onSubmit={(file) =>
                  uploadPi.mutate(file, {
                    onError: (error) =>
                      toast.error(
                        getErrorMessage(error, "Не удалось загрузить файл")
                      ),
                  })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Проформа ещё не загружена CEAT.
              </p>
            )}
          </div>

          <Separator />

          {/* Signed file */}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">Подписанный файл</h3>
            {pi.signedFileUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <DownloadButton url={pi.signedFileUrl} />
                <span className="text-xs text-muted-foreground">
                  загружено {formatDateTime(pi.signedFileUploadedAt)}
                  {pi.signedFileUploadedBy &&
                    ` · ${pi.signedFileUploadedBy.email}`}
                </span>
              </div>
            ) : !isOps ? (
              <FileUploadForm
                accept=".pdf,application/pdf"
                submitLabel="Загрузить подписанный файл"
                isSubmitting={uploadSigned.isPending}
                onSubmit={(file) =>
                  uploadSigned.mutate(file, {
                    onError: (error) =>
                      toast.error(
                        getErrorMessage(error, "Не удалось загрузить файл")
                      ),
                  })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Клиент ещё не загрузил подписанный файл.
              </p>
            )}
          </div>

          <Separator />

          {/* Additional files */}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">Доп. файлы</h3>
            {pi.additionalFiles && pi.additionalFiles.length > 0 ? (
              <ul className="grid gap-2">
                {pi.additionalFiles.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <DownloadButton url={f.fileUrl} label="Скачать" />
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(f.uploadedAt)} · {f.uploadedBy?.email ?? "—"}
                      {f.description && ` — ${f.description}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Нет доп. файлов.</p>
            )}
            <AddAdditionalFileForm
              isSubmitting={addAdditionalFile.isPending}
              onSubmit={(file, description) =>
                addAdditionalFile.mutate(
                  { file, description },
                  {
                    onSuccess: () => toast.success("Файл добавлен"),
                    onError: (error) =>
                      toast.error(
                        getErrorMessage(error, "Не удалось добавить файл")
                      ),
                  }
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Pending replacement */}
      {pi.pendingReplacementFileUrl && (
        <Card className="ring-blue-500/30">
          <CardHeader>
            <CardTitle>CEAT предложил замену файла</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">
                  Текущий файл
                </span>
                {pi.piFileUrl && <DownloadButton url={pi.piFileUrl} />}
              </div>
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">
                  Предложенный файл
                </span>
                <DownloadButton url={pi.pendingReplacementFileUrl} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              предложено {formatDateTime(pi.pendingReplacementProposedAt)}
              {pi.pendingReplacementProposedBy &&
                ` · ${pi.pendingReplacementProposedBy.email}`}
            </p>
            {!isOps ? (
              <div className="flex gap-2">
                <Button
                  disabled={replacementDecision.isPending}
                  onClick={() =>
                    replacementDecision.mutate(true, {
                      onSuccess: () => toast.success("Замена одобрена"),
                      onError: (error) =>
                        toast.error(
                          getErrorMessage(error, "Не удалось одобрить замену")
                        ),
                    })
                  }
                >
                  Одобрить
                </Button>
                <Button
                  variant="outline"
                  disabled={replacementDecision.isPending}
                  onClick={() =>
                    replacementDecision.mutate(false, {
                      onSuccess: () => toast.success("Замена отклонена"),
                      onError: (error) =>
                        toast.error(
                          getErrorMessage(error, "Не удалось отклонить замену")
                        ),
                    })
                  }
                >
                  Отклонить
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ожидает решения клиента.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle>Позиции</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedLineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет позиций.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {LINE_ITEM_COLUMNS.map((col) => (
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
                  <TableCell>{formatNumber(pi.qtyPending)}</TableCell>
                  <TableCell>{formatNumber(pi.totalQty)}</TableCell>
                  <TableCell>
                    {formatNumber(String(sumField(pi.lineItems ?? [], "mt")), 3)}
                  </TableCell>
                  <TableCell>
                    {formatNumber(
                      String(sumField(pi.lineItems ?? [], "loadFactor")),
                      4
                    )}
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>
                    {formatNumber(
                      String(
                        sumField(
                          pi.lineItems ?? [],
                          "currentWeekDispatchLoadFactor"
                        )
                      ),
                      4
                    )}{" "}
                    / {formatNumber(pi.currentWeekPlanQty)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                  <TableCell>Приоритет</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    {formatNumber(String(livePriorityTotals.totalQty))} /{" "}
                    {formatNumber(String(livePriorityTotals.totalContainers))}{" "}
                    конт.
                  </TableCell>
                </TableRow>
                {sortedLineItems.map((item) => {
                  const draftValue =
                    priorityDrafts[item.id] ?? Number(item.priorityQty)
                  return (
                    <TableRow key={item.id}>
                      <TableCell>{item.materialNum ?? "—"}</TableCell>
                      <TableCell className="whitespace-normal">
                        {item.materialDesc ?? "—"}
                      </TableCell>
                      <TableCell>
                        {formatNumber(item.balanceToBeDelivered)}
                      </TableCell>
                      <TableCell>{formatNumber(item.quantity)}</TableCell>
                      <TableCell>{formatNumber(item.mt, 3)}</TableCell>
                      <TableCell>{formatNumber(item.loadFactor, 4)}</TableCell>
                      <TableCell>{formatNumber(item.loadability)}</TableCell>
                      <TableCell>
                        {formatNumber(item.currentWeekDispatchLoadFactor, 4)} /{" "}
                        {formatNumber(item.currentWeekDispatchQty)}
                      </TableCell>
                      <TableCell>
                        {editModeActive ? (
                          <PriorityInput
                            value={draftValue}
                            max={Number(item.balanceToBeDelivered ?? 0)}
                            loadability={item.loadability}
                            onChange={(value) =>
                              handlePriorityChange(item.id, value)
                            }
                          />
                        ) : (
                          formatNumber(item.priorityQty)
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
