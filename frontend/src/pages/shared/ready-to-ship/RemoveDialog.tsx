import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
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
import {
  useRemoveMutation,
  type ContainerAllocation,
} from "@/api/readyToShip"
import { formatNumber, formatPiTitle } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"
import { useContainerName } from "@/lib/readyToShip"

export interface RemoveTarget {
  allocation: ContainerAllocation
  containerLabel: string
}

interface RemoveFormValues {
  qty: string
}

interface RemoveDialogProps {
  target: RemoveTarget | null
  customerId?: string
  onClose: () => void
}

export function RemoveDialog(props: RemoveDialogProps) {
  const { target, onClose } = props
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        {target && (
          <RemoveForm key={target.allocation.id} {...props} target={target} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RemoveForm({
  target,
  customerId,
  onClose,
}: RemoveDialogProps & { target: RemoveTarget }) {
  const { t } = useTranslation()
  const containerName = useContainerName()
  const { allocation, containerLabel } = target
  const remove = useRemoveMutation(customerId)
  const max = Math.floor(allocation.allocatedQty)

  const schema = useMemo(
    () =>
      z.object({
        qty: z
          .string()
          .trim()
          .min(1, t("readyToShip.remove.errors.required"))
          .refine((v) => /^\d+$/.test(v), t("readyToShip.remove.errors.integer"))
          .refine((v) => Number(v) >= 1, t("readyToShip.remove.errors.min"))
          .refine(
            (v) => Number(v) <= max,
            t("readyToShip.remove.errors.max", { max })
          ),
      }),
    [max, t]
  )

  const form = useForm<RemoveFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { qty: String(max) },
  })

  // A validation message already on screen was built in the old language:
  // re-validate when the language changes so it is rebuilt in the new one.
  useEffect(() => {
    const failed = Object.keys(form.formState.errors) as (keyof RemoveFormValues)[]
    if (failed.length > 0) {
      void form.trigger(failed)
    }
  }, [t, form])

  function onSubmit(values: RemoveFormValues) {
    const amount = Number(values.qty)
    remove.mutate(
      { allocationId: allocation.id, qty: amount },
      {
        onSuccess: () => {
          toast.success(
            t("readyToShip.remove.success", {
              qty: formatNumber(String(amount)),
              material: allocation.materialNum ?? "—",
            })
          )
          onClose()
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, t("readyToShip.remove.failed"))),
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("readyToShip.remove.title", {
            container: containerName(containerLabel),
          })}
        </DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">
            {allocation.materialNum ?? "—"}
          </span>{" "}
          · {allocation.materialDesc ?? "—"}
          <br />
          {t("readyToShip.remove.info", {
            title: formatPiTitle(allocation.piNumber, allocation.piLabel),
            qty: formatNumber(String(allocation.allocatedQty)),
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
                <FormLabel>{t("readyToShip.remove.qty")}</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={max}
                      step={1}
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
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={remove.isPending || !form.formState.isValid}
            >
              {remove.isPending
                ? t("common.working")
                : t("readyToShip.remove.submit")}
            </Button>
          </div>
        </form>
      </Form>
    </>
  )
}
