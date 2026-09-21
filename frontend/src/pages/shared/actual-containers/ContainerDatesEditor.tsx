import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import {
  useResetContainerDatesMutation,
  useUpdateContainerDatesMutation,
  type ActualContainer,
  type ContainerDatesInput,
} from "@/api/actualContainers"
import { formatDay } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"

interface DateFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  overridden: boolean
  sourceValue: string | null
}

function DateField({
  id,
  label,
  value,
  onChange,
  overridden,
  sourceValue,
}: DateFieldProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {overridden && (
          <Badge
            variant="outline"
            className="border-transparent bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
          >
            изменено вручную
          </Badge>
        )}
      </div>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-44"
      />
      <span className="text-xs text-muted-foreground">
        {sourceValue
          ? `В файле: ${formatDay(sourceValue)}`
          : "В файле даты нет"}
      </span>
    </div>
  )
}

// ops only. Saving a date sets that manual override; emptying the field of a
// manually-set date drops it (back to the file's). "Сбросить до данных файла"
// drops both and is offered only while at least one override exists.
//
// The parent re-mounts this with a new `key` whenever the container's
// effective dates change on the server, so the inputs always start from what
// is really stored (no effect-driven state syncing).
export function ContainerDatesEditor({ container }: { container: ActualContainer }) {
  const update = useUpdateContainerDatesMutation(container.id)
  const reset = useResetContainerDatesMutation(container.id)
  const [etd, setEtd] = useState(container.etd ?? "")
  const [eta, setEta] = useState(container.eta ?? "")
  const [confirmReset, setConfirmReset] = useState(false)

  function changesFor(
    value: string,
    current: string | null,
    isOverridden: boolean,
    key: keyof ContainerDatesInput,
    into: ContainerDatesInput
  ) {
    if (value === (current ?? "")) return
    if (value === "") {
      // An empty field only means something when there is a manual date to drop.
      if (isOverridden) into[key] = null
      return
    }
    into[key] = value
  }

  const changes: ContainerDatesInput = {}
  changesFor(etd, container.etd, container.isEtdOverridden, "overrideEtd", changes)
  changesFor(eta, container.eta, container.isEtaOverridden, "overrideEta", changes)
  const hasChanges = Object.keys(changes).length > 0
  const hasOverride = container.isEtdOverridden || container.isEtaOverridden

  function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!hasChanges) return
    update.mutate(changes, {
      onSuccess: () => toast.success("Даты сохранены"),
      onError: (error) =>
        toast.error(getErrorMessage(error, "Не удалось сохранить даты")),
    })
  }

  return (
    <>
      <form
        onSubmit={handleSave}
        className="flex flex-col gap-3"
        data-testid="dates-editor"
      >
        <div className="flex flex-wrap gap-6">
          <DateField
            id="override-etd"
            label="ETD"
            value={etd}
            onChange={setEtd}
            overridden={container.isEtdOverridden}
            sourceValue={container.sourceEtd}
          />
          <DateField
            id="override-eta"
            label="ETA"
            value={eta}
            onChange={setEta}
            overridden={container.isEtaOverridden}
            sourceValue={container.sourceEta}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!hasChanges || update.isPending}>
            {update.isPending ? "Сохранение..." : "Сохранить даты"}
          </Button>
          {hasOverride && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reset.isPending}
              onClick={() => setConfirmReset(true)}
            >
              Сбросить до данных файла
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Введённая дата заменяет дату файла и не перезаписывается
            еженедельной загрузкой. Пустое поле снимает ручную дату.
          </span>
        </div>
      </form>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Сбросить даты до данных файла?"
        description="Ручные ETD/ETA будут удалены, снова будут показаны даты из файла бэкордера."
        confirmLabel="Сбросить"
        destructive
        isPending={reset.isPending}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: () => {
              toast.success("Даты сброшены до данных файла")
              setConfirmReset(false)
            },
            onError: (error) => {
              toast.error(getErrorMessage(error, "Не удалось сбросить даты"))
              setConfirmReset(false)
            },
          })
        }
      />
    </>
  )
}
