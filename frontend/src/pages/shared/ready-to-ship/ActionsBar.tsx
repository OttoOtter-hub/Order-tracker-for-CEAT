import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import {
  useConfirmMutation,
  useUndoAllMutation,
  useUndoLastMutation,
  type ReadyToShipView,
} from "@/api/readyToShip"
import { formatPercent } from "@/lib/fill"
import { useContainerTitle } from "@/lib/readyToShip"
import { getErrorMessage } from "@/lib/errors"

// Client-only panel, shown while there is anything not yet confirmed: either
// draft containers holding positions, or logged actions to roll back (which
// stays true after everything was taken out again, so an accidental "remove"
// can still be undone).
export function ActionsBar({ view }: { view: ReadyToShipView }) {
  const { t } = useTranslation()
  const containerTitle = useContainerTitle()
  const undoLast = useUndoLastMutation()
  const undoAll = useUndoAllMutation()
  const confirm = useConfirmMutation()
  const [undoAllOpen, setUndoAllOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const drafts = view.containers.filter(
    (c) => !c.isConfirmed && c.allocations.length > 0
  )
  const overfilled = drafts.filter((c) => c.isOverfilled)

  if (view.undoableActions === 0 && drafts.length === 0) {
    return null
  }

  // Also enforced by the server (400) — this only keeps the button honest,
  // and explains *why* it's off instead of leaving the client guessing.
  let confirmBlockedReason: string | null = null
  if (overfilled.length > 0) {
    confirmBlockedReason = t("readyToShip.actions.blockedOver", {
      list: overfilled
        .map((c) => `${containerTitle(c)} (${formatPercent(c.fillPercent)})`)
        .join(", "),
    })
  } else if (!view.canConfirm) {
    confirmBlockedReason = t("readyToShip.actions.blockedNothing")
  }

  return (
    <div
      className="sticky top-0 z-20 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
      data-testid="actions-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm">
          <span className="font-medium">{t("readyToShip.actions.title")}</span>
          <span className="text-muted-foreground">
            {" "}
            · {t("readyToShip.actions.containersWithItems", { n: drafts.length })}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={undoLast.isPending || view.undoableActions === 0}
          onClick={() =>
            undoLast.mutate(undefined, {
              onSuccess: () => toast.success(t("readyToShip.actions.undoneOne")),
              onError: (error) =>
                toast.error(
                  getErrorMessage(error, t("readyToShip.actions.undoOneFailed"))
                ),
            })
          }
        >
          {t("readyToShip.actions.undoOne")}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={undoAll.isPending || view.undoableActions === 0}
          onClick={() => setUndoAllOpen(true)}
        >
          {t("readyToShip.actions.undoAll")}
        </Button>

        {/* A disabled <button> swallows pointer events, so the hint lives on a wrapper. */}
        <span title={confirmBlockedReason ?? undefined}>
          <Button
            type="button"
            size="sm"
            disabled={confirmBlockedReason !== null || confirm.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("readyToShip.actions.confirm")}
          </Button>
        </span>
      </div>

      {confirmBlockedReason && (
        <p
          className="mt-2 text-xs text-destructive"
          data-testid="confirm-blocked-reason"
        >
          {confirmBlockedReason}
        </p>
      )}

      <ConfirmDialog
        open={undoAllOpen}
        onOpenChange={setUndoAllOpen}
        title={t("readyToShip.actions.undoAllTitle")}
        description={t("readyToShip.actions.undoAllDescription")}
        confirmLabel={t("readyToShip.actions.undoAll")}
        destructive
        isPending={undoAll.isPending}
        onConfirm={() =>
          undoAll.mutate(undefined, {
            onSuccess: () => {
              setUndoAllOpen(false)
              toast.success(t("readyToShip.actions.undoAllDone"))
            },
            onError: (error) =>
              toast.error(
                getErrorMessage(error, t("readyToShip.actions.undoAllFailed"))
              ),
          })
        }
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("readyToShip.actions.confirmTitle")}
        description={t("readyToShip.actions.confirmDescription", {
          n: drafts.length,
        })}
        confirmLabel={t("readyToShip.actions.confirm")}
        isPending={confirm.isPending}
        onConfirm={() =>
          confirm.mutate(undefined, {
            onSuccess: () => {
              setConfirmOpen(false)
              toast.success(t("readyToShip.actions.confirmDone"))
            },
            // The server re-checks the 100% rule; on a race (or a stale
            // screen) its message names the offending containers.
            onError: (error) => {
              setConfirmOpen(false)
              toast.error(
                getErrorMessage(error, t("readyToShip.actions.confirmFailed"))
              )
            },
          })
        }
      />
    </div>
  )
}
