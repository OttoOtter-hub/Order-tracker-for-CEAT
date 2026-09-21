import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  Download,
  FileCheck,
  FileX,
  LockOpen,
  Trash2,
  Upload,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { FillMeter } from "@/pages/shared/ready-to-ship/FillMeter"
import type { RemoveTarget } from "@/pages/shared/ready-to-ship/RemoveDialog"
import {
  downloadMarkingFile,
  useDeleteMarkingMutation,
  useUploadMarkingMutation,
  type ContainerAllocation,
  type ShippingContainer,
} from "@/api/readyToShip"
import { FILL_CARD, fillLevel, formatPercent } from "@/lib/fill"
import { formatNumber, formatPiTitle } from "@/lib/format"
import { useContainerName } from "@/lib/readyToShip"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

export type ReadyToShipMode = "client" | "ops"

const GREEN_BADGE =
  "border-transparent bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400"
const AMBER_BADGE =
  "border-transparent bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"

interface MarkingCellProps {
  allocation: ContainerAllocation
  container: ShippingContainer
  mode: ReadyToShipMode
}

// One marking file per allocation row. The client uploads/replaces (only once
// the container is confirmed — a draft's quantity can still change, and a
// change deletes the file) and deletes; both roles can download.
function MarkingCell({ allocation, container, mode }: MarkingCellProps) {
  const { t } = useTranslation()
  const containerName = useContainerName()
  const upload = useUploadMarkingMutation()
  const remove = useDeleteMarkingMutation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const hasFile = allocation.markingFile !== null
  const isClient = mode === "client"
  const canUpload = isClient && container.isConfirmed

  function handleFile(file: File | undefined) {
    if (!file) return
    upload.mutate(
      { allocationId: allocation.id, file },
      {
        onSuccess: () =>
          toast.success(
            hasFile
              ? t("readyToShip.marking.replacedToast")
              : t("readyToShip.marking.uploadedToast")
          ),
        onError: (error) =>
          toast.error(getErrorMessage(error, t("common.uploadFailed"))),
      }
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-marking-state={hasFile ? "uploaded" : "missing"}
    >
      {hasFile ? (
        <Badge
          variant="outline"
          className={GREEN_BADGE}
          title={
            container.isConfirmed
              ? undefined
              : t("readyToShip.marking.validUntilChanged")
          }
        >
          <FileCheck /> {t("readyToShip.marking.uploaded")}
        </Badge>
      ) : (
        <Badge variant="outline" className={AMBER_BADGE}>
          <FileX /> {t("readyToShip.marking.missing")}
        </Badge>
      )}

      {hasFile && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() =>
            downloadMarkingFile(allocation.id).catch((error) =>
              toast.error(getErrorMessage(error, t("common.downloadFailed")))
            )
          }
        >
          <Download /> {t("common.download")}
        </Button>
      )}

      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            data-testid="marking-file-input"
            onChange={(e) => {
              handleFile(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
            {upload.isPending
              ? t("common.uploading")
              : hasFile
                ? t("readyToShip.marking.replace")
                : t("readyToShip.marking.upload")}
          </Button>
        </>
      )}

      {isClient && hasFile && (
        <>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> {t("common.delete")}
          </Button>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={t("readyToShip.marking.deleteTitle")}
            description={t("readyToShip.marking.deleteDescription", {
              material: allocation.materialNum ?? "—",
              container: containerName(container.label),
            })}
            confirmLabel={t("common.delete")}
            destructive
            isPending={remove.isPending}
            onConfirm={() =>
              remove.mutate(allocation.id, {
                onSuccess: () => {
                  setConfirmDelete(false)
                  toast.success(t("readyToShip.marking.deletedToast"))
                },
                onError: (error) =>
                  toast.error(getErrorMessage(error, t("common.deleteFileFailed"))),
              })
            }
          />
        </>
      )}
    </div>
  )
}

interface ContainerCardProps {
  container: ShippingContainer
  mode: ReadyToShipMode
  onRemove: (target: RemoveTarget) => void
  onUnlock: (container: ShippingContainer) => void
}

export function ContainerCard({
  container,
  mode,
  onRemove,
  onUnlock,
}: ContainerCardProps) {
  const { t } = useTranslation()
  const containerName = useContainerName()
  const level = fillLevel(container.fillPercent)
  const isClient = mode === "client"
  const showCounter =
    container.markingFilesTotal > 0 &&
    (container.isConfirmed || container.markingFilesUploaded > 0)

  return (
    <Card
      data-container-label={container.label}
      data-confirmed={container.isConfirmed}
      className={cn("gap-3", FILL_CARD[level])}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle className="text-lg">
              {containerName(container.label)}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {container.isConfirmed ? (
                <Badge variant="outline" className={GREEN_BADGE}>
                  {t("readyToShip.card.confirmed")}
                </Badge>
              ) : (
                <Badge variant="secondary">{t("readyToShip.card.draft")}</Badge>
              )}
              {container.isOverfilled && (
                <Badge variant="destructive">{t("readyToShip.card.overfilled")}</Badge>
              )}
            </div>
          </div>
          <FillMeter percent={container.fillPercent} large className="w-44 shrink-0" />
        </div>

        {(showCounter || (mode === "ops" && container.isConfirmed)) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {showCounter ? (
              <span
                className="text-sm text-muted-foreground"
                data-testid="marking-counter"
              >
                {t("readyToShip.card.markingCounter", {
                  count: container.markingFilesUploaded,
                  total: container.markingFilesTotal,
                })}
              </span>
            ) : (
              <span />
            )}
            {mode === "ops" && container.isConfirmed && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onUnlock(container)}
              >
                <LockOpen /> {t("readyToShip.card.unlock")}
              </Button>
            )}
          </div>
        )}

        {container.isOverfilled && (
          <p className="text-sm text-destructive">
            {t("readyToShip.card.overfilledWarning")}
          </p>
        )}
      </CardHeader>

      <CardContent>
        <ul className="divide-y">
          {container.allocations.map((allocation) => {
            const showMarking = container.isConfirmed || allocation.markingFile !== null
            return (
              <li
                key={allocation.id}
                className="grid gap-2 py-2 first:pt-0 last:pb-0"
                data-allocation-id={allocation.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{allocation.materialNum ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {allocation.materialDesc ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("readyToShip.card.pi", {
                        title: formatPiTitle(allocation.piNumber, allocation.piLabel),
                      })}
                      {allocation.soNumber
                        ? t("readyToShip.card.piSo", { so: allocation.soNumber })
                        : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="font-medium tabular-nums">
                      {t("common.qtyPcs", {
                        qty: formatNumber(String(allocation.allocatedQty)),
                      })}
                    </div>
                    <div
                      className="text-xs text-muted-foreground tabular-nums"
                      title={t("readyToShip.card.shareHint")}
                    >
                      {formatPercent(allocation.fillContribution * 100)}
                    </div>
                    {isClient && !container.isConfirmed && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          onRemove({ allocation, containerLabel: container.label })
                        }
                      >
                        {t("readyToShip.card.remove")}
                      </Button>
                    )}
                  </div>
                </div>
                {showMarking && (
                  <MarkingCell
                    allocation={allocation}
                    container={container}
                    mode={mode}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
