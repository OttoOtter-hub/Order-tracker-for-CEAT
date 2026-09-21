import { useMemo } from "react"
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
  const { allocation, containerLabel } = target
  const remove = useRemoveMutation(customerId)
  const max = Math.floor(allocation.allocatedQty)

  const schema = useMemo(
    () =>
      z.object({
        qty: z
          .string()
          .trim()
          .min(1, "Укажите количество")
          .refine((v) => /^\d+$/.test(v), "Только целое число штук")
          .refine((v) => Number(v) >= 1, "Не меньше 1")
          .refine((v) => Number(v) <= max, `Не больше, чем в контейнере (${max})`),
      }),
    [max]
  )

  const form = useForm<RemoveFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { qty: String(max) },
  })

  function onSubmit(values: RemoveFormValues) {
    const amount = Number(values.qty)
    remove.mutate(
      { allocationId: allocation.id, qty: amount },
      {
        onSuccess: () => {
          toast.success(
            `Возвращено в список: ${formatNumber(String(amount))} шт. (${allocation.materialNum ?? "—"})`
          )
          onClose()
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, "Не удалось убрать позицию")),
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Убрать из «{containerLabel}»</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">
            {allocation.materialNum ?? "—"}
          </span>{" "}
          · {allocation.materialDesc ?? "—"}
          <br />
          PI {formatPiTitle(allocation.piNumber, allocation.piLabel)} · сейчас в контейнере{" "}
          {formatNumber(String(allocation.allocatedQty))} шт. Убранное вернётся в
          список готового.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <FormField
            control={form.control}
            name="qty"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Сколько убрать</FormLabel>
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
                    Всё ({formatNumber(String(max))})
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={remove.isPending || !form.formState.isValid}
            >
              {remove.isPending ? "Выполняется..." : "Убрать"}
            </Button>
          </div>
        </form>
      </Form>
    </>
  )
}
