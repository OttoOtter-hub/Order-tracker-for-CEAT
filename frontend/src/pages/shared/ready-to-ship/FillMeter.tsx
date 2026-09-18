import { cn } from "@/lib/utils"
import { FILL_BAR, FILL_TEXT, fillLevel, formatPercent } from "@/lib/fill"

interface FillMeterProps {
  percent: number
  large?: boolean
  className?: string
}

// Percentage plus a bar, both coloured by the same threshold (normal up to
// 90%, yellow to 100%, red above) — so a container's state reads at a glance
// in the card header and, smaller, next to every option in the move dialog.
export function FillMeter({ percent, large = false, className }: FillMeterProps) {
  const level = fillLevel(percent)
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-fill-level={level}
    >
      <span
        className={cn(
          "font-semibold tabular-nums",
          large ? "text-2xl leading-none" : "text-sm",
          FILL_TEXT[level]
        )}
      >
        {formatPercent(percent)}
      </span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        className={cn(
          "min-w-12 flex-1 overflow-hidden rounded-full bg-muted",
          large ? "h-2.5" : "h-1.5"
        )}
      >
        <div
          className={cn("h-full rounded-full", FILL_BAR[level])}
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>
    </div>
  )
}
