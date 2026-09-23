import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import {
  useConfirmArrivalMutation,
  useRevokeArrivalConfirmationMutation,
  type ActualContainer,
} from "@/api/actualContainers"
import { formatDateTime } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"

const AMBER_BADGE =
  "border-transparent bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
const GREEN_BADGE =
  "border-transparent bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400"

interface ArrivalMarkerProps {
  container: ActualContainer
  // Only the client can confirm — and only for their own containers, so the
  // caller (not this component) decides who gets to see the button at all.
  canConfirm: boolean
  // ops-only undo of a manual confirmation; the detail page passes it, the
  // list doesn't.
  canRevoke?: boolean
}

// container.arrivalStatus === null: nothing to show, at all — the parent
// doesn't need to guard the call, this returns null itself.
export function ArrivalMarker({
  container,
  canConfirm,
  canRevoke = false,
}: ArrivalMarkerProps) {
  const { t } = useTranslation()
  const confirm = useConfirmArrivalMutation(container.id)
  const revoke = useRevokeArrivalConfirmationMutation(container.id)
  const [revokeOpen, setRevokeOpen] = useState(false)

  if (container.arrivalStatus === null) {
    return null
  }

  if (container.arrivalStatus === "arrived") {
    const manual = container.arrivalConfirmedBy !== null
    // arrivalConfirmedAt is only ever stored by a manual confirmation — an
    // automatic "arrived" leaves it null, so there's nothing to revoke there.
    const showRevoke = canRevoke && container.arrivalConfirmedAt !== null
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={GREEN_BADGE}
          title={
            manual
              ? t("shipped.arrival.confirmedTooltip", {
                  email: container.arrivalConfirmedBy,
                  date: formatDateTime(container.arrivalConfirmedAt),
                })
              : undefined
          }
        >
          {manual ? t("shipped.arrival.arrived") : t("shipped.arrival.arrivedAuto")}
        </Badge>
        {showRevoke && (
          <>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => setRevokeOpen(true)}
            >
              <Undo2 /> {t("shipped.arrival.revoke")}
            </Button>
            <ConfirmDialog
              open={revokeOpen}
              onOpenChange={setRevokeOpen}
              title={t("shipped.arrival.revokeTitle", {
                container: container.containerNumber,
              })}
              description={t("shipped.arrival.revokeDescription")}
              confirmLabel={t("shipped.arrival.revoke")}
              destructive
              isPending={revoke.isPending}
              onConfirm={() =>
                revoke.mutate(undefined, {
                  onSuccess: () => {
                    setRevokeOpen(false)
                    toast.success(t("shipped.arrival.revoked"))
                  },
                  onError: (error) => {
                    setRevokeOpen(false)
                    toast.error(
                      getErrorMessage(error, t("shipped.arrival.revokeFailed"))
                    )
                  },
                })
              }
            />
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={AMBER_BADGE}>
        {t("shipped.arrival.expected")}
      </Badge>
      {canConfirm && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={confirm.isPending}
          onClick={(e) => {
            e.stopPropagation()
            confirm.mutate(undefined, {
              onSuccess: () => toast.success(t("shipped.arrival.confirmed")),
              onError: (error) =>
                toast.error(
                  getErrorMessage(error, t("shipped.arrival.confirmFailed"))
                ),
            })
          }}
        >
          {confirm.isPending ? t("common.working") : t("shipped.arrival.confirm")}
        </Button>
      )}
    </div>
  )
}
