import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { FileSpreadsheet, GitCompare, MessageSquareWarning } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import {
  useLoadListStepMutation,
  type LoadListStatus,
  type LoadListStep,
  type ReadyToShipView,
} from "@/api/readyToShip"
import { formatDateTime } from "@/lib/format"
import { formatPercent } from "@/lib/fill"
import { useContainerName, useContainerTitle } from "@/lib/readyToShip"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"
import type { ReadyToShipMode } from "@/pages/shared/ready-to-ship/ContainerCard"
import { ClientVersionDialog } from "@/pages/shared/ready-to-ship/ClientVersionDialog"
import { ImportDialog } from "@/pages/shared/ready-to-ship/ImportDialog"
import { useReadyToShipCustomer } from "@/pages/shared/ready-to-ship/customerContext"

const STATUS_BADGE: Record<LoadListStatus, string> = {
  draft_ceat: "border-transparent bg-secondary text-secondary-foreground",
  sent_to_client:
    "border-transparent bg-warning/10 text-warning-text dark:bg-warning/20",
  client_editing:
    "border-transparent bg-warning/10 text-warning-text dark:bg-warning/20",
  submitted_by_client:
    "border-transparent bg-warning/10 text-warning-text dark:bg-warning/20",
  confirmed:
    "border-transparent bg-success/10 text-success-text dark:bg-success/20",
}

// The steps a viewer can take from a status: which role, and whether the
// step locks/sends the current layout (then the 100% rule applies).
const STEPS: Record<
  ReadyToShipMode,
  Partial<Record<LoadListStatus, { step: LoadListStep; needsLayout: boolean }[]>>
> = {
  ops: {
    draft_ceat: [{ step: "send", needsLayout: true }],
    confirmed: [{ step: "reopen", needsLayout: false }],
  },
  client: {
    sent_to_client: [
      { step: "accept", needsLayout: false },
      { step: "request-edit", needsLayout: false },
    ],
    client_editing: [{ step: "submit", needsLayout: true }],
  },
}

// Phase 25: where the load list stands, what the viewer can do next, and the
// way back from a rejection (CEAT's comment, and what had to be cut).
export function LoadListBar({
  view,
  mode,
}: {
  view: ReadyToShipView
  mode: ReadyToShipMode
}) {
  const { t } = useTranslation()
  const customerId = useReadyToShipCustomer()
  const containerName = useContainerName()
  const containerTitle = useContainerTitle()
  const stepMutation = useLoadListStepMutation(customerId)
  const [pendingStep, setPendingStep] = useState<LoadListStep | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const { loadList } = view
  const steps = STEPS[mode][loadList.status] ?? []

  // The same 100% rule the server applies to "send" / "submit" — this only
  // keeps the button honest and says why it's off.
  const drafts = view.containers.filter(
    (c) => !c.isConfirmed && c.allocations.length > 0
  )
  const overfilled = drafts.filter((c) => c.isOverfilled)
  let layoutBlockedReason: string | null = null
  if (overfilled.length > 0) {
    layoutBlockedReason = t("readyToShip.loadList.blockedOver", {
      list: overfilled
        .map((c) => `${containerTitle(c)} (${formatPercent(c.fillPercent)})`)
        .join(", "),
    })
  } else if (!view.canConfirm) {
    layoutBlockedReason = t("readyToShip.loadList.blockedNothing")
  }

  const since =
    {
      draft_ceat: null,
      sent_to_client: loadList.rejectedAt ?? loadList.sentAt,
      client_editing: loadList.editRequestedAt,
      submitted_by_client: loadList.submittedAt,
      confirmed: loadList.confirmedAt,
    }[loadList.status] ?? null

  const showRejection =
    loadList.status === "sent_to_client" && loadList.rejectionComment !== null

  function run(step: LoadListStep) {
    stepMutation.mutate(step, {
      onSuccess: () => {
        setPendingStep(null)
        toast.success(t(`readyToShip.loadList.steps.${step}.done`))
      },
      onError: (error) => {
        setPendingStep(null)
        toast.error(
          getErrorMessage(error, t(`readyToShip.loadList.steps.${step}.failed`))
        )
      },
    })
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-card p-3"
      data-testid="load-list-bar"
      data-status={loadList.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t("readyToShip.loadList.title")}</span>
            <Badge
              variant="outline"
              className={cn(STATUS_BADGE[loadList.status])}
              data-testid="load-list-status"
            >
              {t(`readyToShip.loadList.status.${loadList.status}`)}
            </Badge>
            {since && (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(since)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`readyToShip.loadList.hint.${mode}.${loadList.status}`)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loadList.canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="import-xlsx"
              onClick={() => setImportOpen(true)}
            >
              <FileSpreadsheet /> {t("readyToShip.import.button")}
            </Button>
          )}
          {mode === "ops" && loadList.status === "submitted_by_client" && (
            <Button
              type="button"
              size="sm"
              data-testid="open-client-version"
              onClick={() => setDiffOpen(true)}
            >
              <GitCompare /> {t("readyToShip.clientVersion.open")}
            </Button>
          )}
          {steps.map(({ step, needsLayout }, index) => {
            const blocked = needsLayout ? layoutBlockedReason : null
            return (
              // A disabled <button> swallows pointer events, so the hint
              // lives on a wrapper.
              <span key={step} title={blocked ?? undefined}>
                <Button
                  type="button"
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={blocked !== null || stepMutation.isPending}
                  data-testid={`load-list-${step}`}
                  onClick={() => setPendingStep(step)}
                >
                  {t(`readyToShip.loadList.steps.${step}.button`)}
                </Button>
              </span>
            )
          })}
        </div>
      </div>

      {steps.some((s) => s.needsLayout) &&
        layoutBlockedReason &&
        drafts.length > 0 && (
          <p className="text-xs text-destructive" data-testid="send-blocked-reason">
            {layoutBlockedReason}
          </p>
        )}

      {showRejection && (
        <div
          className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
          data-testid="rejection-banner"
        >
          <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">
              {t("readyToShip.loadList.rejected.title")}
            </span>
            <p className="whitespace-pre-wrap break-words">
              {loadList.rejectionComment}
            </p>
            {loadList.rejectionAdjustments.length > 0 && (
              <div className="mt-1">
                <span className="text-xs text-muted-foreground">
                  {t("readyToShip.loadList.rejected.adjustments")}
                </span>
                <ul className="list-disc pl-5 text-xs">
                  {loadList.rejectionAdjustments.map((a) => (
                    <li
                      key={`${a.containerLabel}#${a.piNumber}#${a.materialNum}#${a.soNumber}`}
                    >
                      {t("readyToShip.loadList.rejected.adjustment", {
                        container: containerName(a.containerLabel),
                        materialNum: a.materialNum ?? "—",
                        piNumber: a.piNumber,
                        wanted: a.wanted,
                        placed: a.placed,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingStep !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStep(null)
        }}
        title={
          pendingStep ? t(`readyToShip.loadList.steps.${pendingStep}.title`) : ""
        }
        description={
          pendingStep
            ? t(`readyToShip.loadList.steps.${pendingStep}.description`, {
                n: drafts.length,
              })
            : ""
        }
        confirmLabel={
          pendingStep ? t(`readyToShip.loadList.steps.${pendingStep}.button`) : ""
        }
        isPending={stepMutation.isPending}
        onConfirm={() => {
          if (pendingStep) run(pendingStep)
        }}
      />

      {mode === "ops" && (
        <ClientVersionDialog
          open={diffOpen && loadList.status === "submitted_by_client"}
          onOpenChange={setDiffOpen}
        />
      )}
      {loadList.canEdit && (
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} mode={mode} />
      )}
    </div>
  )
}
