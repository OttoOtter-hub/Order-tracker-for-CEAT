import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/StatusBadge"
import { SortableHead } from "@/components/SortableHead"
import { FileUploadForm } from "@/components/FileUploadForm"
import { AddAdditionalFileForm } from "@/pages/shared/AddAdditionalFileForm"
import { PriorityInput } from "@/pages/shared/PriorityInput"
import { PiLabelEditor } from "@/pages/shared/PiLabelEditor"
import { PiFileHistory } from "@/pages/shared/PiFileHistory"
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
import { formatDateTime, formatNumber, formatPiTitle } from "@/lib/format"
import { openFile } from "@/lib/download"
import { getErrorMessage } from "@/lib/errors"
import { useTableSort } from "@/hooks/useTableSort"
import { cn } from "@/lib/utils"
import { sumByLoadabilityGroups } from "@/lib/sumByLoadability"

const PRIORITY_SAVE_DEBOUNCE_MS = 500

function DownloadButton({ url, label }: { url: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        openFile(url).catch((error) =>
          toast.error(getErrorMessage(error, t("common.downloadFailed")))
        )
      }
    >
      {label ?? t("common.download")}
    </Button>
  )
}

const LINE_ITEM_COLUMNS = [
  { key: "materialNum", labelKey: "piDetail.lines.columns.material" },
  { key: "materialDesc", labelKey: "piDetail.lines.columns.description" },
  { key: "balanceToBeDelivered", labelKey: "piDetail.lines.columns.balance" },
  { key: "quantity", labelKey: "piDetail.lines.columns.quantity" },
  { key: "mt", labelKey: "piDetail.lines.columns.mt" },
  { key: "loadFactor", labelKey: "piDetail.lines.columns.loadFactor" },
  { key: "loadability", labelKey: "piDetail.lines.columns.loadability" },
  { key: "plan", labelKey: "piDetail.lines.columns.weekPlan" },
  { key: "priorityQty", labelKey: "piDetail.lines.columns.priority" },
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
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: pi, isLoading } = usePiDetailQuery(id)

  const [proposeOpen, setProposeOpen] = useState(false)
  const [replaceSignedOpen, setReplaceSignedOpen] = useState(false)
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
              getErrorMessage(error, t("piDetail.lines.saveFailed"))
            ),
        }
      )
    }, PRIORITY_SAVE_DEBOUNCE_MS)
  }

  function handleResetPriority() {
    if (!window.confirm(t("piDetail.lines.confirmReset"))) {
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
        toast.success(t("piDetail.lines.resetDone"))
      },
      onError: (error) =>
        toast.error(
          getErrorMessage(error, t("piDetail.lines.resetFailed"))
        ),
    })
  }

  const livePriorityTotals = useMemo(() => {
    const items = pi?.lineItems ?? []
    let totalQty = 0
    let lineCount = 0
    const forContainers: Array<{ value: number; loadability: number | null }> = []
    for (const item of items) {
      const value = priorityDrafts[item.id] ?? Number(item.priorityQty)
      totalQty += value
      if (value > 0) lineCount++
      forContainers.push({
        value,
        loadability: item.loadability !== null ? Number(item.loadability) : null,
      })
    }
    return {
      totalQty,
      lineCount,
      totalContainers: sumByLoadabilityGroups(forContainers),
    }
  }, [pi?.lineItems, priorityDrafts])

  // Only the materials with something to actually compare — a card can carry
  // well over a hundred materials on its line items with most never
  // allocated or shipped; a wall of 0/0/0 rows isn't a useful comparison.
  // The backend still computes every material's row (see
  // ProformaInvoicesService.buildReconciliation) — this is a display filter,
  // not a business rule.
  const activeReconciliation = useMemo(
    () =>
      (pi?.reconciliation ?? []).filter(
        (row) => row.plannedQty > 0 || row.shippedQty > 0
      ),
    [pi?.reconciliation]
  )

  const editModeActive = isClient && isPriorityMode && !pi?.isArchivedShipped
  // The name is the client's to set, but only until the PI is signed.
  const canEditLabel = isClient && !!pi && !pi.signedFileUrl

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
  }
  if (!pi) {
    return (
      <p className="text-sm text-muted-foreground">{t("piDetail.notFound")}</p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => navigate(`${basePath}/pi`)}
      >
        <ArrowLeft /> {t("common.backToList")}
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        {canEditLabel ? (
          <>
            <h1 className="text-xl font-semibold">{pi.piNumber}</h1>
            <PiLabelEditor key={pi.id} piId={pi.id} label={pi.label} />
          </>
        ) : (
          <h1 className="text-xl font-semibold break-words">
            {formatPiTitle(pi.piNumber, pi.label)}
          </h1>
        )}
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
            {isPriorityMode ? t("piDetail.priorityDone") : t("piDetail.priorityMode")}
          </Button>
        )}
        {isPriorityMode && (
          <Button
            variant="outline"
            size="sm"
            disabled={resetPriority.isPending}
            onClick={handleResetPriority}
          >
            {resetPriority.isPending ? t("piDetail.resetting") : t("piDetail.reset")}
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
              .catch((error) =>
                toast.error(getErrorMessage(error, t("piDetail.exportFailed")))
              )
              .finally(() => setIsExporting(false))
          }}
        >
          {isExporting ? t("common.exporting") : t("piDetail.downloadExcel")}
        </Button>
      </div>

      {/* Aggregates: the same "Всего / Ожидает" as on the list card, plus what has
          already shipped (0 is shown as 0 — "nothing shipped yet" is information). */}
      <div
        className="flex flex-wrap gap-x-6 gap-y-1 text-sm"
        data-testid="pi-aggregates"
      >
        <div>
          <span className="text-muted-foreground">{t("piDetail.total")}: </span>
          {formatNumber(pi.totalQty)}
        </div>
        <div>
          <span className="text-muted-foreground">{t("piDetail.pending")}: </span>
          {formatNumber(pi.qtyPending)}
        </div>
        <div data-testid="pi-shipped">
          <span className="text-muted-foreground">{t("piDetail.shipped")}: </span>
          {formatNumber(pi.shippedQty)}
        </div>
        {/* Live from the drafts, so it follows an edit as you type; equals the
            server's priorityLineItemsCount once the save has landed. */}
        <div data-testid="pi-priority-lines">
          <span className="text-muted-foreground">
            {t("piDetail.priorityLines")}:{" "}
          </span>
          {livePriorityTotals.lineCount}
        </div>
      </div>

      {/* Files */}
      <Card>
        <CardHeader>
          <CardTitle>{t("piDetail.files.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Original PI file */}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">{t("piDetail.files.original")}</h3>
            {pi.piFileUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <DownloadButton url={pi.piFileUrl} />
                <span className="text-xs text-muted-foreground">
                  {t("common.uploadedAt", { date: formatDateTime(pi.piFileUploadedAt) })}
                  {pi.piFileUploadedBy && ` · ${pi.piFileUploadedBy.email}`}
                </span>
                {isOps && !pi.pendingReplacementFileUrl && (
                  <Dialog open={proposeOpen} onOpenChange={setProposeOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        {t("piDetail.files.proposeReplacement")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("piDetail.files.proposeTitle")}</DialogTitle>
                      </DialogHeader>
                      <FileUploadForm
                        accept=".pdf,application/pdf"
                        submitLabel={t("piDetail.files.propose")}
                        isSubmitting={proposeReplacement.isPending}
                        onSubmit={(file) =>
                          proposeReplacement.mutate(file, {
                            onSuccess: () => {
                              setProposeOpen(false)
                              toast.success(t("piDetail.files.proposed"))
                            },
                            onError: (error) =>
                              toast.error(
                                getErrorMessage(
                                  error,
                                  t("piDetail.files.proposeFailed")
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
                submitLabel={t("piDetail.files.uploadProforma")}
                isSubmitting={uploadPi.isPending}
                onSubmit={(file) =>
                  uploadPi.mutate(file, {
                    onError: (error) =>
                      toast.error(
                        getErrorMessage(error, t("common.uploadFailed"))
                      ),
                  })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("piDetail.files.notUploadedByCeat")}
              </p>
            )}
          </div>

          <Separator />

          {/* Signed file */}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">{t("piDetail.files.signed")}</h3>
            {pi.signedFileUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <DownloadButton url={pi.signedFileUrl} />
                <span className="text-xs text-muted-foreground">
                  {t("common.uploadedAt", { date: formatDateTime(pi.signedFileUploadedAt) })}
                  {pi.signedFileUploadedBy &&
                    ` · ${pi.signedFileUploadedBy.email}`}
                </span>
                {/* The client's own action, no CEAT approval (same upload-signed
                    as before signing); the backend moves the previous signed
                    file into the file history first (Phase 19). */}
                {!isOps && (
                  <Dialog open={replaceSignedOpen} onOpenChange={setReplaceSignedOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        {t("piDetail.files.replaceSigned")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("piDetail.files.replaceSignedTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("piDetail.files.replaceSignedHint")}
                        </DialogDescription>
                      </DialogHeader>
                      <FileUploadForm
                        accept=".pdf,application/pdf"
                        submitLabel={t("piDetail.files.replaceSignedSubmit")}
                        isSubmitting={uploadSigned.isPending}
                        onSubmit={(file) =>
                          uploadSigned.mutate(file, {
                            onSuccess: () => {
                              setReplaceSignedOpen(false)
                              toast.success(t("piDetail.files.signedReplaced"))
                            },
                            onError: (error) =>
                              toast.error(
                                getErrorMessage(error, t("common.uploadFailed"))
                              ),
                          })
                        }
                      />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            ) : !isOps ? (
              <FileUploadForm
                accept=".pdf,application/pdf"
                submitLabel={t("piDetail.files.uploadSigned")}
                isSubmitting={uploadSigned.isPending}
                onSubmit={(file) =>
                  uploadSigned.mutate(file, {
                    onError: (error) =>
                      toast.error(
                        getErrorMessage(error, t("common.uploadFailed"))
                      ),
                  })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("piDetail.files.notSignedYet")}
              </p>
            )}
          </div>

          <Separator />

          {/* Additional files */}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">{t("piDetail.files.additional")}</h3>
            {pi.additionalFiles && pi.additionalFiles.length > 0 ? (
              <ul className="grid gap-2">
                {pi.additionalFiles.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <DownloadButton url={f.fileUrl} />
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(f.uploadedAt)} · {f.uploadedBy?.email ?? "—"}
                      {f.description && ` — ${f.description}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("piDetail.files.noAdditional")}
              </p>
            )}
            <AddAdditionalFileForm
              isSubmitting={addAdditionalFile.isPending}
              onSubmit={(file, description) =>
                addAdditionalFile.mutate(
                  { file, description },
                  {
                    onSuccess: () => toast.success(t("common.fileAdded")),
                    onError: (error) =>
                      toast.error(
                        getErrorMessage(error, t("common.addFileFailed"))
                      ),
                  }
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <PiFileHistory piId={pi.id} />

      {/* Pending replacement */}
      {pi.pendingReplacementFileUrl && (
        <Card className="ring-blue-500/30">
          <CardHeader>
            <CardTitle>{t("piDetail.replacement.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">
                  {t("piDetail.replacement.current")}
                </span>
                {pi.piFileUrl && <DownloadButton url={pi.piFileUrl} />}
              </div>
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">
                  {t("piDetail.replacement.proposedFile")}
                </span>
                <DownloadButton url={pi.pendingReplacementFileUrl} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("piDetail.replacement.proposedAt", {
                date: formatDateTime(pi.pendingReplacementProposedAt),
              })}
              {pi.pendingReplacementProposedBy &&
                ` · ${pi.pendingReplacementProposedBy.email}`}
            </p>
            {!isOps ? (
              <div className="flex gap-2">
                <Button
                  disabled={replacementDecision.isPending}
                  onClick={() =>
                    replacementDecision.mutate(true, {
                      onSuccess: () => toast.success(t("piDetail.replacement.approved")),
                      onError: (error) =>
                        toast.error(
                          getErrorMessage(error, t("piDetail.replacement.approveFailed"))
                        ),
                    })
                  }
                >
                  {t("piDetail.replacement.approve")}
                </Button>
                <Button
                  variant="outline"
                  disabled={replacementDecision.isPending}
                  onClick={() =>
                    replacementDecision.mutate(false, {
                      onSuccess: () => toast.success(t("piDetail.replacement.rejected")),
                      onError: (error) =>
                        toast.error(
                          getErrorMessage(error, t("piDetail.replacement.rejectFailed"))
                        ),
                    })
                  }
                >
                  {t("piDetail.replacement.reject")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("piDetail.replacement.awaiting")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle>{t("piDetail.lines.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedLineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("piDetail.lines.empty")}
            </p>
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
                      {t(col.labelKey)}
                    </SortableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                  <TableCell>{t("piDetail.lines.total")}</TableCell>
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
                  <TableCell>{t("piDetail.lines.priorityRow")}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    {t("piDetail.lines.priorityTotal", {
                      qty: formatNumber(String(livePriorityTotals.totalQty)),
                      n: formatNumber(String(livePriorityTotals.totalContainers)),
                    })}
                  </TableCell>
                </TableRow>
                {sortedLineItems.map((item) => {
                  const draftValue =
                    priorityDrafts[item.id] ?? Number(item.priorityQty)
                  return (
                    <TableRow
                      key={item.id}
                      data-priority={draftValue > 0}
                      className={cn(
                        // A line with a priority stays marked in read-only
                        // view too, not only while priority mode is on.
                        draftValue > 0 &&
                          "bg-yellow-50 hover:bg-yellow-100/70 dark:bg-yellow-500/10 dark:hover:bg-yellow-500/15"
                      )}
                    >
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

      {/* Reconciliation (Phase 12): plan vs actual per material, quantities
          only — no pricing, no alerts on the delta, purely informational.
          Only materials with any planned or shipped quantity are listed (see
          activeReconciliation above); the whole block is hidden, not just an
          empty table, when there's nothing to show. */}
      {activeReconciliation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("piDetail.reconciliation.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("piDetail.reconciliation.columns.sku")}</TableHead>
                  <TableHead>
                    {t("piDetail.reconciliation.columns.description")}
                  </TableHead>
                  <TableHead>
                    {t("piDetail.reconciliation.columns.planned")}
                  </TableHead>
                  <TableHead>
                    {t("piDetail.reconciliation.columns.shipped")}
                  </TableHead>
                  <TableHead>
                    {t("piDetail.reconciliation.columns.delta")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeReconciliation.map((row) => (
                  <TableRow key={row.materialNum}>
                    <TableCell>{row.materialNum}</TableCell>
                    <TableCell className="whitespace-normal">
                      {row.materialDesc ?? "—"}
                    </TableCell>
                    <TableCell>{formatNumber(String(row.plannedQty))}</TableCell>
                    <TableCell>{formatNumber(String(row.shippedQty))}</TableCell>
                    <TableCell
                      className={cn(
                        "font-medium",
                        // Not a warning — a plain, calm signal either way:
                        // green for "more shipped than planned", the
                        // ordinary text color otherwise. Never red/amber.
                        row.delta > 0 && "text-green-600 dark:text-green-400"
                      )}
                    >
                      {formatNumber(String(row.delta))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
