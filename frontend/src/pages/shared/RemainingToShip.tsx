import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { formatRemainingPercent } from "@/lib/remainingPercent"

// "Remaining to ship: N%" with a bar filled to the same N — the tile and the
// card header use it; an archived card shows "Shipped 100%" instead (the
// caller decides).
export function RemainingToShip({
  value,
  className,
}: {
  value: number | null | undefined
  className?: string
}) {
  const { t } = useTranslation()
  const width = value === null || value === undefined ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className={cn("grid gap-1", className)} data-testid="remaining-to-ship">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("piProgress.remaining")}</span>
        <span className="font-medium tabular-nums">{formatRemainingPercent(value)}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t("piProgress.remaining")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
      >
        <div className="h-full rounded-full bg-info" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
