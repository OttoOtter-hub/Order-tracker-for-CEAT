import { useState } from "react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {overridden && (
          <Badge
            variant="outline"
            className="border-transparent bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
          >
            {t("shipped.detail.dates.manual")}
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
          ? t("shipped.detail.dates.inFile", { date: formatDay(sourceValue) })
          : t("shipped.detail.dates.noDateInFile")}
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
  const { t } = useTranslation()
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
      onSuccess: () => toast.success(t("shipped.detail.dates.saved")),
      onError: (error) =>
        toast.error(getErrorMessage(error, t("shipped.detail.dates.saveFailed"))),
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
            label={t("shipped.detail.etd")}
            value={etd}
            onChange={setEtd}
            overridden={container.isEtdOverridden}
            sourceValue={container.sourceEtd}
          />
          <DateField
            id="override-eta"
            label={t("shipped.detail.eta")}
            value={eta}
            onChange={setEta}
            overridden={container.isEtaOverridden}
            sourceValue={container.sourceEta}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!hasChanges || update.isPending}>
            {update.isPending
              ? t("common.saving")
              : t("shipped.detail.dates.save")}
          </Button>
          {hasOverride && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reset.isPending}
              onClick={() => setConfirmReset(true)}
            >
              {t("shipped.detail.dates.resetToFile")}
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {t("shipped.detail.dates.hint")}
          </span>
        </div>
      </form>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("shipped.detail.dates.resetTitle")}
        description={t("shipped.detail.dates.resetDescription")}
        confirmLabel={t("shipped.detail.dates.resetConfirm")}
        destructive
        isPending={reset.isPending}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: () => {
              toast.success(t("shipped.detail.dates.resetDone"))
              setConfirmReset(false)
            },
            onError: (error) => {
              toast.error(getErrorMessage(error, t("shipped.detail.dates.resetFailed")))
              setConfirmReset(false)
            },
          })
        }
      />
    </>
  )
}
