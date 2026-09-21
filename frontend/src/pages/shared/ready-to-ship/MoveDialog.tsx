import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { TriangleAlert } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FillMeter } from "@/pages/shared/ready-to-ship/FillMeter"
import {
  useMoveMutation,
  type ShippingContainer,
  type UnallocatedLine,
} from "@/api/readyToShip"
import { FILL_TEXT, fillLevel, formatPercent } from "@/lib/fill"
import { formatNumber, formatPiTitle } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"
import { useContainerName } from "@/lib/readyToShip"
import { cn } from "@/lib/utils"

interface MoveFormValues {
  qty: string
  containerId: string
}

interface MoveDialogProps {
  line: UnallocatedLine | null
  containers: ShippingContainer[]
  // Where the previous move went — moving a whole card's lines into one
  // container is the common workflow, so it stays preselected.
  preferredContainerId: string | null
  customerId?: string
  onClose: () => void
  onMoved: (containerId: string) => void
}

export function MoveDialog(props: MoveDialogProps) {
  const { line, onClose } = props
  return (
    <Dialog
      open={line !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {line && <MoveForm key={line.piLineItemId} {...props} line={line} />}
      </DialogContent>
    </Dialog>
  )
}

function MoveForm({
  line,
  containers,
  preferredContainerId,
  customerId,
  onClose,
  onMoved,
}: MoveDialogProps & { line: UnallocatedLine }) {
  const { t } = useTranslation()
  const containerName = useContainerName()
  const move = useMoveMutation(customerId)
  // The backend only takes whole units; a fractional remainder (never seen in
  // practice) can only be moved down to the integer below it.
  const max = Math.floor(line.remainingQty)

  const schema = useMemo(
    () =>
      z.object({
        qty: z
          .string()
          .trim()
          .min(1, t("readyToShip.move.errors.required"))
          .refine((v) => /^\d+$/.test(v), t("readyToShip.move.errors.integer"))
          .refine((v) => Number(v) >= 1, t("readyToShip.move.errors.min"))
          .refine(
            (v) => Number(v) <= max,
            t("readyToShip.move.errors.max", { max })
          ),
        containerId: z.string().min(1, t("readyToShip.move.errors.container")),
      }),
    [max, t]
  )

  const preferred = containers.find(
    (c) => c.id === preferredContainerId && !c.isConfirmed
  )
  const form = useForm<MoveFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { qty: "", containerId: preferred?.id ?? "" },
  })

  // A validation message already on screen was built in the old language:
  // re-validate when the language changes so it is rebuilt in the new one.
  useEffect(() => {
    const failed = Object.keys(form.formState.errors) as (keyof MoveFormValues)[]
    if (failed.length > 0) {
      void form.trigger(failed)
    }
  }, [t, form])

  const qtyText = form.watch("qty")
  const selectedId = form.watch("containerId")
  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : null
  const qtyIsValid = qty !== null && qty >= 1 && qty <= max
  const loadability = line.loadability !== null && line.loadability > 0 ? line.loadability : null

  function projectedPercent(container: ShippingContainer): number | null {
    if (!qtyIsValid || loadability === null) return null
    return container.fillPercent + (qty / loadability) * 100
  }

  const hasTarget = containers.some((c) => !c.isConfirmed)
  const selected = containers.find((c) => c.id === selectedId)
  const selectedProjected = selected ? projectedPercent(selected) : null

  function onSubmit(values: MoveFormValues) {
    const target = containers.find((c) => c.id === values.containerId)
    const amount = Number(values.qty)
    move.mutate(
      {
        piLineItemId: line.piLineItemId,
        containerId: values.containerId,
        qty: amount,
      },
      {
        onSuccess: () => {
          toast.success(
            t("readyToShip.move.success", {
              qty: formatNumber(String(amount)),
              label: target
                ? containerName(target.label)
                : t("readyToShip.move.successFallbackLabel"),
            })
          )
          onMoved(values.containerId)
          onClose()
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, t("readyToShip.move.failed"))),
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("readyToShip.move.title")}</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">
            {line.materialNum ?? "—"}
          </span>{" "}
          · {line.materialDesc ?? "—"}
          <br />
          {t("readyToShip.move.info", {
            title: formatPiTitle(line.piNumber, line.piLabel),
            so: line.soNumber ?? "—",
            qty: formatNumber(String(line.remainingQty)),
          })}
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <FormField
            control={form.control}
            name="qty"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("readyToShip.move.qty")}</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={max}
                      step={1}
                      placeholder={t("readyToShip.move.placeholder", { max })}
                      autoFocus
                      className="w-32"
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      form.setValue("qty", String(max), {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                  >
                    {t("common.all", { max: formatNumber(String(max)) })}
                  </Button>
                  {loadability !== null && qtyIsValid && (
                    <span className="text-xs text-muted-foreground">
                      {t("common.equalsContainers", {
                        n: ((qty ?? 0) / loadability).toFixed(2),
                      })}
                    </span>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="containerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("readyToShip.move.container")}</FormLabel>
                {!hasTarget ? (
                  <p className="text-sm text-muted-foreground">
                    {t("readyToShip.move.allConfirmed")}
                  </p>
                ) : (
                  <div
                    role="radiogroup"
                    aria-label={t("readyToShip.move.container")}
                    className="grid max-h-72 gap-1.5 overflow-y-auto pr-1"
                  >
                    {containers.map((container) => {
                      const projected = projectedPercent(container)
                      const isSelected = field.value === container.id
                      return (
                        <label
                          key={container.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50",
                            isSelected && "border-primary bg-muted/40",
                            container.isConfirmed &&
                              "cursor-not-allowed opacity-50 hover:bg-transparent"
                          )}
                        >
                          <input
                            type="radio"
                            name="container"
                            value={container.id}
                            checked={isSelected}
                            disabled={container.isConfirmed}
                            onChange={() => field.onChange(container.id)}
                            className="size-4 shrink-0"
                          />
                          <span className="w-24 shrink-0 font-medium">
                            {containerName(container.label)}
                          </span>
                          {container.isConfirmed ? (
                            <span className="text-xs text-muted-foreground">
                              {t("readyToShip.move.confirmedTag")}
                            </span>
                          ) : (
                            <>
                              <FillMeter
                                percent={container.fillPercent}
                                className="flex-1"
                              />
                              {projected !== null && (
                                <span
                                  className={cn(
                                    "w-20 shrink-0 text-right text-xs tabular-nums",
                                    FILL_TEXT[fillLevel(projected)]
                                  )}
                                  title={t("readyToShip.move.afterMove")}
                                >
                                  → {formatPercent(projected)}
                                </span>
                              )}
                            </>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedProjected !== null && selectedProjected > 100 && (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {t("readyToShip.move.overloadWarning", {
                label: selected ? containerName(selected.label) : "",
                percent: formatPercent(selectedProjected),
              })}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={move.isPending || !hasTarget || !form.formState.isValid}
            >
              {move.isPending
                ? t("readyToShip.move.submitting")
                : t("readyToShip.move.submit")}
            </Button>
          </div>
        </form>
      </Form>
    </>
  )
}
