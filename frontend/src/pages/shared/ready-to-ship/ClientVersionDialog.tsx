import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  downloadClientVersionXlsx,
  useLoadListDiffQuery,
  useLoadListStepMutation,
  useRejectLoadListMutation,
} from "@/api/readyToShip"
import { formatDateTime, formatNumber } from "@/lib/format"
import { formatPercent } from "@/lib/fill"
import { useContainerName } from "@/lib/readyToShip"
import { getErrorDetailMessages, getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { useReadyToShipCustomer } from "@/pages/shared/ready-to-ship/customerContext"

// Same limit as the server's (REJECTION_COMMENT_MAX_LENGTH).
const COMMENT_MAX_LENGTH = 1000

// Phase 25, ops: the client's version next to CEAT's — what moved where and
// how full each container ends up — then "OK" (checked again against the
// current stock first) or "Reject" with a comment for the client.
export function ClientVersionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const customerId = useReadyToShipCustomer()
  const containerName = useContainerName()
  const diff = useLoadListDiffQuery(customerId, open)
  const approve = useLoadListStepMutation(customerId)
  const reject = useRejectLoadListMutation(customerId)
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState("")
  const [outdated, setOutdated] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)

  const busy = approve.isPending || reject.isPending
  const trimmed = comment.trim()

  function close(next: boolean) {
    if (!next) {
      setRejecting(false)
      setComment("")
      setOutdated([])
    }
    onOpenChange(next)
  }

  function handleApprove() {
    setOutdated([])
    approve.mutate("approve", {
      onSuccess: () => {
        toast.success(t("readyToShip.loadList.steps.approve.done"))
        close(false)
      },
      onError: (error) => {
        // The client's version no longer fits the stock: the list stays in
        // the dialog — CEAT rejects it with a comment.
        const details = getErrorDetailMessages(error)
        if (details.length > 0) setOutdated(details)
        toast.error(
          getErrorMessage(error, t("readyToShip.loadList.steps.approve.failed"))
        )
      },
    })
  }

  function handleReject() {
    reject.mutate(trimmed, {
      onSuccess: () => {
        toast.success(t("readyToShip.clientVersion.rejectDone"))
        close(false)
      },
      onError: (error) =>
        toast.error(getErrorMessage(error, t("readyToShip.clientVersion.rejectFailed"))),
    })
  }

  const data = diff.data

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        data-testid="client-version-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("readyToShip.clientVersion.title")}</DialogTitle>
          <DialogDescription>
            {!data
              ? t("readyToShip.clientVersion.descriptionLoading")
              : data.ceatTakenAt
                ? t("readyToShip.clientVersion.description", {
                    ceat: formatDateTime(data.ceatTakenAt),
                    client: formatDateTime(data.clientTakenAt),
                  })
                : // A load list that never went out from CEAT (the client was
                  // already editing when load lists came in): nothing to
                  // compare with, every position counts as the client's.
                  t("readyToShip.clientVersion.descriptionNoCeat", {
                    client: formatDateTime(data.clientTakenAt),
                  })}
          </DialogDescription>
        </DialogHeader>

        {diff.isLoading && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {diff.isError && (
          <p className="text-sm text-destructive">
            {getErrorMessage(diff.error, t("readyToShip.clientVersion.loadFailed"))}
          </p>
        )}

        {data && (
          <div className="flex min-w-0 flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {t("readyToShip.clientVersion.containers")}
              </h3>
              <div className="overflow-x-auto">
                <Table data-testid="diff-containers">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("readyToShip.clientVersion.colContainer")}</TableHead>
                      <TableHead className="text-right">
                        {t("readyToShip.clientVersion.colCeat")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("readyToShip.clientVersion.colClient")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.containers.map((c) => {
                      const changed =
                        c.ceatQty !== c.clientQty ||
                        c.ceatFillPercent !== c.clientFillPercent
                      const cell = (qty: number, percent: number | null) =>
                        percent === null
                          ? t("common.qtyPcs", { qty: formatNumber(String(qty)) })
                          : `${formatPercent(percent)} · ${t("common.qtyPcs", {
                              qty: formatNumber(String(qty)),
                            })}`
                      return (
                        <TableRow
                          key={c.label}
                          data-changed={changed}
                          className={cn(changed && "bg-warning/5")}
                        >
                          <TableCell>{containerName(c.label)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {cell(c.ceatQty, c.ceatFillPercent)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              c.clientFillPercent !== null &&
                                c.clientFillPercent > 100 &&
                                "text-destructive"
                            )}
                          >
                            {cell(c.clientQty, c.clientFillPercent)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {t("readyToShip.clientVersion.lines", { n: data.lines.length })}
              </h3>
              {data.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("readyToShip.clientVersion.noChanges")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="diff-lines">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("readyToShip.clientVersion.colMaterial")}</TableHead>
                        <TableHead>{t("readyToShip.clientVersion.colPiSo")}</TableHead>
                        <TableHead>{t("readyToShip.clientVersion.colChanges")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.lines.map((line) => (
                        <TableRow
                          key={`${line.piNumber}|${line.materialNum}|${line.soNumber}`}
                        >
                          <TableCell className="align-top">
                            <div className="font-medium">{line.materialNum ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              {line.materialDesc ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-xs">
                            PI {line.piNumber}
                            {line.soNumber ? ` · SO ${line.soNumber}` : ""}
                          </TableCell>
                          <TableCell className="align-top">
                            <ul className="text-xs tabular-nums">
                              {line.changes.map((change) => (
                                <li key={change.container}>
                                  {t("readyToShip.clientVersion.change", {
                                    container: containerName(change.container),
                                    ceat: formatNumber(String(change.ceatQty)),
                                    client: formatNumber(String(change.clientQty)),
                                  })}
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </div>
        )}

        {outdated.length > 0 && (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            data-testid="outdated-details"
          >
            <p className="font-medium text-destructive">
              {t("readyToShip.clientVersion.outdatedTitle")}
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {outdated.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("readyToShip.clientVersion.outdatedHint")}
            </p>
          </div>
        )}

        {rejecting && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="rejection-comment">
              {t("readyToShip.clientVersion.commentLabel")}
            </label>
            <Textarea
              id="rejection-comment"
              value={comment}
              maxLength={COMMENT_MAX_LENGTH}
              rows={4}
              placeholder={t("readyToShip.clientVersion.commentPlaceholder")}
              data-testid="rejection-comment"
              onChange={(e) => setComment(e.target.value)}
            />
            <span className="self-end text-xs text-muted-foreground tabular-nums">
              {comment.length} / {COMMENT_MAX_LENGTH}
            </span>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={isDownloading}
            data-testid="client-version-xlsx"
            onClick={() => {
              setIsDownloading(true)
              downloadClientVersionXlsx(customerId)
                .catch((error) =>
                  toast.error(getErrorMessage(error, t("common.downloadFailed")))
                )
                .finally(() => setIsDownloading(false))
            }}
          >
            <Download />
            {t("readyToShip.clientVersion.downloadXlsx")}
          </Button>
          <div className="flex flex-wrap gap-2">
            {rejecting ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || trimmed.length === 0}
                  data-testid="reject-submit"
                  onClick={handleReject}
                >
                  {reject.isPending
                    ? t("common.working")
                    : t("readyToShip.clientVersion.rejectConfirm")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !data}
                  data-testid="reject-open"
                  onClick={() => setRejecting(true)}
                >
                  {t("readyToShip.clientVersion.reject")}
                </Button>
                <Button
                  type="button"
                  disabled={busy || !data}
                  data-testid="approve"
                  onClick={handleApprove}
                >
                  {approve.isPending
                    ? t("common.working")
                    : t("readyToShip.loadList.steps.approve.button")}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
