import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface PriorityInputProps {
  value: number
  max: number
  loadability: string | null
  onChange: (value: number) => void
}

// Purely a controlled display + input — no debounce/save logic of its own.
// The parent (PiDetailPage) owns the draft state and decides what onChange
// does (update the live total instantly, schedule the debounced PATCH) —
// this component doesn't need to know either of those things happen.
export function PriorityInput({
  value,
  max,
  loadability,
  onChange,
}: PriorityInputProps) {
  const { t } = useTranslation()
  // Priority counts tires — always whole units, never a fraction of one.
  // maxInt floors a (theoretically, if ever) fractional balance down to
  // the highest valid integer priority, so "Весь остаток" can never commit
  // a non-integer either.
  const maxInt = Math.max(0, Math.floor(max))

  // The one path both the input and the button commit through — step="1"
  // on the <Input> only constrains the native spinner arrows, not what a
  // person can type by hand, so rounding has to happen here regardless of
  // how the raw number arrived. Keeping a single commit() means the two
  // can never again drift into validating differently (see the ~0.02
  // fractional-input bug this replaced).
  function commit(raw: number) {
    const rounded = Number.isFinite(raw) ? Math.round(raw) : 0
    onChange(Math.min(Math.max(rounded, 0), maxInt))
  }

  const loadabilityNum = loadability !== null ? Number(loadability) : null
  const containers =
    loadabilityNum && loadabilityNum > 0 ? value / loadabilityNum : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          max={maxInt}
          step={1}
          value={value}
          onChange={(e) => commit(Number(e.target.value))}
          className="w-24"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => commit(maxInt)}
        >
          {t("piDetail.lines.fullBalance")}
        </Button>
      </div>
      {containers !== null && (
        <span className="text-xs text-muted-foreground">
          {t("common.equalsContainers", { n: containers.toFixed(2) })}
        </span>
      )}
    </div>
  )
}
