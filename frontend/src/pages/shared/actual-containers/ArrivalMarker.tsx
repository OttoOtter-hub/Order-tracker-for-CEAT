import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useConfirmArrivalMutation,
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
}

// container.arrivalStatus === null: nothing to show, at all — the parent
// doesn't need to guard the call, this returns null itself.
export function ArrivalMarker({ container, canConfirm }: ArrivalMarkerProps) {
  const { t } = useTranslation()
  const confirm = useConfirmArrivalMutation(container.id)

  if (container.arrivalStatus === null) {
    return null
  }

  if (container.arrivalStatus === "arrived") {
    const manual = container.arrivalConfirmedBy !== null
    return (
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
