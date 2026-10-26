import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import {
  useUndoAllMutation,
  useUndoLastMutation,
  type ReadyToShipView,
} from "@/api/readyToShip"
import { getErrorMessage } from "@/lib/errors"
import { useReadyToShipCustomer } from "@/pages/shared/ready-to-ship/customerContext"

// The editor's undo panel (Phase 25: whoever edits the load list now — CEAT
// in its draft, the client in its round), shown while there is anything not
// yet confirmed: either draft containers holding positions, or logged
// actions to roll back (which stays true after everything was taken out
// again, so an accidental "remove" can still be undone), or an empty
// container added by hand — "Undo all" is what takes that one away again.
// Sending / submitting the result is the load-list bar's job.
export function ActionsBar({ view }: { view: ReadyToShipView }) {
  const { t } = useTranslation()
  const customerId = useReadyToShipCustomer()
  const undoLast = useUndoLastMutation(customerId)
  const undoAll = useUndoAllMutation(customerId)
  const [undoAllOpen, setUndoAllOpen] = useState(false)

  const drafts = view.containers.filter(
    (c) => !c.isConfirmed && c.allocations.length > 0
  )
  const hasEmptyManual = view.containers.some(
    (c) => c.isManual && c.allocations.length === 0
  )

  if (view.undoableActions === 0 && drafts.length === 0 && !hasEmptyManual) {
    return null
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
              onSuccess: (next) => {
                toast.success(t("readyToShip.actions.undoneOne"))
                // Passed over, not undone: the removal of a line whose
                // proforma is archived stays as it is.
                for (const skipped of next.undoSkipped ?? []) {
                  toast.warning(
                    t("errors.UNDO_SKIPPED_ARCHIVED_PI", {
                      ...skipped,
                      materialNum: skipped.materialNum ?? "—",
                    })
                  )
                }
              },
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
          disabled={
            undoAll.isPending || (view.undoableActions === 0 && !hasEmptyManual)
          }
          data-testid="undo-all"
          onClick={() => setUndoAllOpen(true)}
        >
          {t("readyToShip.actions.undoAll")}
        </Button>
      </div>

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
    </div>
  )
}
