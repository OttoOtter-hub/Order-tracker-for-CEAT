import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import {
  useConfirmMutation,
  useUndoAllMutation,
  useUndoLastMutation,
  type ReadyToShipView,
} from "@/api/readyToShip"
import { formatPercent } from "@/lib/fill"
import { getErrorMessage } from "@/lib/errors"

// Client-only panel, shown while there is anything not yet confirmed: either
// draft containers holding positions, or logged actions to roll back (which
// stays true after everything was taken out again, so an accidental "remove"
// can still be undone).
export function ActionsBar({ view }: { view: ReadyToShipView }) {
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
    confirmBlockedReason = `Нельзя подтвердить: перегружены ${overfilled
      .map((c) => `${c.label} (${formatPercent(c.fillPercent)})`)
      .join(", ")}`
  } else if (!view.canConfirm) {
    confirmBlockedReason = "Нечего подтверждать: нет контейнеров с позициями"
  }

  return (
    <div
      className="sticky top-0 z-20 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
      data-testid="actions-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm">
          <span className="font-medium">Несохранённые изменения</span>
          <span className="text-muted-foreground">
            {" "}
            · контейнеров с позициями: {drafts.length}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={undoLast.isPending || view.undoableActions === 0}
          onClick={() =>
            undoLast.mutate(undefined, {
              onSuccess: () => toast.success("Последнее действие отменено"),
              onError: (error) =>
                toast.error(getErrorMessage(error, "Не удалось отменить действие")),
            })
          }
        >
          Отменить одно действие
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={undoAll.isPending || view.undoableActions === 0}
          onClick={() => setUndoAllOpen(true)}
        >
          Отменить всё
        </Button>

        {/* A disabled <button> swallows pointer events, so the hint lives on a wrapper. */}
        <span title={confirmBlockedReason ?? undefined}>
          <Button
            type="button"
            size="sm"
            disabled={confirmBlockedReason !== null || confirm.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Подтвердить
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
        title="Отменить все несохранённые изменения?"
        description="Все перемещения в незафиксированных контейнерах будут откатаны, позиции вернутся в список готового. Подтверждённые контейнеры не затрагиваются. Действие необратимо для текущей сессии."
        confirmLabel="Отменить всё"
        destructive
        isPending={undoAll.isPending}
        onConfirm={() =>
          undoAll.mutate(undefined, {
            onSuccess: () => {
              setUndoAllOpen(false)
              toast.success("Все несохранённые изменения отменены")
            },
            onError: (error) =>
              toast.error(getErrorMessage(error, "Не удалось отменить изменения")),
          })
        }
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Подтвердить план?"
        description={`Будут подтверждены все контейнеры с позициями (${drafts.length}). После этого состав можно менять только после разблокировки CEAT, а для каждой позиции нужно будет загрузить файл маркировки.`}
        confirmLabel="Подтвердить"
        isPending={confirm.isPending}
        onConfirm={() =>
          confirm.mutate(undefined, {
            onSuccess: () => {
              setConfirmOpen(false)
              toast.success("План подтверждён")
            },
            // The server re-checks the 100% rule; on a race (or a stale
            // screen) its message names the offending containers.
            onError: (error) => {
              setConfirmOpen(false)
              toast.error(getErrorMessage(error, "Не удалось подтвердить"))
            },
          })
        }
      />
    </div>
  )
}
