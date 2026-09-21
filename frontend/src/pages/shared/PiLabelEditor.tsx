import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  PI_LABEL_MAX_LENGTH,
  useUpdateLabelMutation,
} from "@/api/proformaInvoices"
import { getErrorMessage } from "@/lib/errors"

interface PiLabelEditorProps {
  piId: string
  label: string | null
}

// The client's "Название" field, shown next to the PI number for as long as
// the PI is unsigned (the parent stops rendering it once it is signed — from
// then on the label is plain text, with no way back).
export function PiLabelEditor({ piId, label }: PiLabelEditorProps) {
  const updateLabel = useUpdateLabelMutation(piId)
  const [draft, setDraft] = useState(label ?? "")

  const trimmed = draft.trim()
  const isDirty = trimmed !== (label ?? "")

  function save() {
    if (!isDirty || updateLabel.isPending) return
    updateLabel.mutate(trimmed === "" ? null : trimmed, {
      onSuccess: (pi) => {
        setDraft(pi.label ?? "")
        toast.success("Название сохранено")
      },
      onError: (error) =>
        toast.error(getErrorMessage(error, "Не удалось сохранить название")),
    })
  }

  return (
    <form
      className="flex items-center gap-2"
      data-testid="pi-label-editor"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Input
        value={draft}
        maxLength={PI_LABEL_MAX_LENGTH}
        placeholder="Название"
        aria-label="Название"
        className="h-8 w-56"
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!isDirty || updateLabel.isPending}
      >
        {updateLabel.isPending ? "Сохранение..." : "Сохранить"}
      </Button>
    </form>
  )
}
