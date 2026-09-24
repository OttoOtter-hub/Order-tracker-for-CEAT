import { useTranslation } from "react-i18next"
import { Pencil } from "lucide-react"
import { formatDay } from "@/lib/format"
import { overrideHint } from "@/lib/actualContainers"
import { cn } from "@/lib/utils"

interface DateCellProps {
  // The date to show: the manual one if set, otherwise the file's.
  value: string | null
  overridden: boolean
  // What the file itself said, for the tooltip of an overridden date.
  sourceValue: string | null
}

// A date that CEAT changed by hand must not pass for the file's own — it is
// amber with a pencil, and the tooltip says what the file had.
export function DateCell({ value, overridden, sourceValue }: DateCellProps) {
  const { t } = useTranslation()
  if (!value) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap tabular-nums",
        overridden && "font-medium text-warning-text"
      )}
      data-overridden={overridden}
      title={overridden ? overrideHint(sourceValue) : undefined}
    >
      {formatDay(value)}
      {overridden && <Pencil className="size-3" aria-label={t("shipped.overrideAria")} />}
    </span>
  )
}
