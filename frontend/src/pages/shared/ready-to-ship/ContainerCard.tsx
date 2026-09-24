import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ChevronDown,
  ChevronRight,
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
import { ContainerNameEditor } from "@/pages/shared/ready-to-ship/ContainerNameEditor"
import { FillMeter } from "@/pages/shared/ready-to-ship/FillMeter"
import type { RemoveTarget } from "@/pages/shared/ready-to-ship/RemoveDialog"
import {
  downloadMarkingFile,
  useDeleteMarkingMutation,
  useUploadMarkingMutation,
  type ContainerAllocation,
  type ShippingContainer,
} from "@/api/readyToShip"
import { FILL_CARD, FILL_TEXT, fillLevel, formatPercent } from "@/lib/fill"
import { formatNumber, formatPiTitle } from "@/lib/format"
import { useContainerTitle } from "@/lib/readyToShip"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

export type ReadyToShipMode = "client" | "ops"

const GREEN_BADGE =
  "border-transparent bg-success/10 text-success-text dark:bg-success/20"
const AMBER_BADGE =
  "border-transparent bg-warning/10 text-warning-text dark:bg-warning/20"

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
  const containerTitle = useContainerTitle()
  const upload = useUploadMarkingMutation()
  const remove = useDeleteMarkingMutation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const hasFile = allocation.markingFile !== null
  const isClient = mode === "client"
  // Phase 16: locked is a per-position thing now — a line can be uploadable
  // even while the rest of its container is still confirmed, or not,
  // depending on which one line ops reopened.
  const canUpload = isClient && allocation.isLocked

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
            allocation.isLocked
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
              container: containerTitle(container),
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

export interface UnlockAllocationTarget {
  allocation: ContainerAllocation
  containerLabel: string
}

interface ContainerCardProps {
  container: ShippingContainer
  mode: ReadyToShipMode
  onRemove: (target: RemoveTarget) => void
  onUnlock: (container: ShippingContainer) => void
  onUnlockAllocation: (target: UnlockAllocationTarget) => void
}

export function ContainerCard({
  container,
  mode,
  onRemove,
  onUnlock,
  onUnlockAllocation,
}: ContainerCardProps) {
  const { t } = useTranslation()
  const containerTitle = useContainerTitle()
  const level = fillLevel(container.fillPercent)
  const isClient = mode === "client"
  const isOps = mode === "ops"
  // "OK to mix" has no capacity: no meter, no fill colour, no percentages —
  // just how much it holds.
  const isOkToMix = container.isOkToMix
  const okToMixSummary = t("readyToShip.card.okToMixSummary", {
    count: container.totalLines,
    qty: formatNumber(String(container.totalQty)),
  })
  const showCounter =
    container.markingFilesTotal > 0 &&
    (container.isConfirmed || container.markingFilesUploaded > 0)
  // The blunt whole-container unlock only makes sense while at least one
  // position is still locked — offer it for "fully confirmed" and
  // "partially unlocked" alike, next to the finer-grained per-line one below.
  const hasAnyLockedPosition = container.isConfirmed || container.isPartiallyUnlocked

  // Screen-only state: a confirmed container starts collapsed, a draft one
  // expanded, and a change of that status (confirm, unlock) resets it.
  const [collapsed, setCollapsed] = useState(container.isConfirmed)
  const [collapsedFor, setCollapsedFor] = useState(container.isConfirmed)
  if (collapsedFor !== container.isConfirmed) {
    setCollapsedFor(container.isConfirmed)
    setCollapsed(container.isConfirmed)
  }

  const toggle = (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="-ml-1.5 shrink-0"
      aria-expanded={!collapsed}
      aria-label={collapsed ? t("readyToShip.card.expand") : t("readyToShip.card.collapse")}
      title={collapsed ? t("readyToShip.card.expand") : t("readyToShip.card.collapse")}
      data-testid="container-toggle"
      onClick={() => setCollapsed((value) => !value)}
    >
      {collapsed ? <ChevronRight /> : <ChevronDown />}
    </Button>
  )

  const cardProps = {
    "data-container-label": container.label,
    "data-ok-to-mix": isOkToMix,
    "data-confirmed": container.isConfirmed,
    "data-partially-unlocked": container.isPartiallyUnlocked,
    "data-collapsed": collapsed,
  }

  if (collapsed) {
    return (
      <Card
        {...cardProps}
        size="sm"
        className={cn("py-2", !isOkToMix && FILL_CARD[level])}
      >
        <CardHeader className="flex items-center gap-2">
          {toggle}
          <CardTitle className="min-w-0 truncate text-base">
            {containerTitle(container)}
          </CardTitle>
          <span
            className={cn(
              "ml-auto text-sm tabular-nums",
              isOkToMix ? "text-muted-foreground" : FILL_TEXT[level]
            )}
          >
            {isOkToMix ? okToMixSummary : formatPercent(container.fillPercent)}
          </span>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card {...cardProps} className={cn("gap-3", !isOkToMix && FILL_CARD[level])}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <div className="flex items-center gap-1">
              {toggle}
              <CardTitle className="text-lg break-words">
                {containerTitle(container)}
              </CardTitle>
            </div>
            {isClient && !isOkToMix && (
              <ContainerNameEditor
                // A name changed elsewhere (another tab) resets the field.
                key={container.name ?? ""}
                containerId={container.id}
                name={container.name}
              />
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {container.isConfirmed ? (
                <Badge variant="outline" className={GREEN_BADGE}>
                  {t("readyToShip.card.confirmed")}
                </Badge>
              ) : container.isPartiallyUnlocked ? (
                <Badge variant="outline" className={AMBER_BADGE}>
                  {t("readyToShip.card.partiallyUnlocked")}
                </Badge>
              ) : (
                <Badge variant="secondary">{t("readyToShip.card.draft")}</Badge>
              )}
              {container.isOverfilled && (
                <Badge variant="destructive">{t("readyToShip.card.overfilled")}</Badge>
              )}
            </div>
          </div>
          {isOkToMix ? (
            <span
              className="shrink-0 text-sm font-medium tabular-nums"
              data-testid="ok-to-mix-summary"
            >
              {okToMixSummary}
            </span>
          ) : (
            <FillMeter percent={container.fillPercent} large className="w-44 shrink-0" />
          )}
        </div>

        {(showCounter || (isOps && hasAnyLockedPosition)) && (
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
            {isOps && hasAnyLockedPosition && (
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
            const showMarking = allocation.isLocked || allocation.markingFile !== null
            return (
              <li
                key={allocation.id}
                className="grid gap-2 py-2 first:pt-0 last:pb-0"
                data-allocation-id={allocation.id}
                data-locked={allocation.isLocked}
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
                    {!isOkToMix && (
                      <div
                        className="text-xs text-muted-foreground tabular-nums"
                        title={t("readyToShip.card.shareHint")}
                      >
                        {formatPercent(allocation.fillContribution * 100)}
                      </div>
                    )}
                    {isClient && !allocation.isLocked && (
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
                    {isOps && allocation.isLocked && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          onUnlockAllocation({
                            allocation,
                            containerLabel: container.label,
                          })
                        }
                      >
                        <LockOpen /> {t("readyToShip.card.unlockLine")}
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
