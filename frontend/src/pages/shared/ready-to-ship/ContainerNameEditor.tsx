import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  CONTAINER_NAME_MAX_LENGTH,
  useRenameContainerMutation,
} from "@/api/readyToShip"
import { getErrorMessage } from "@/lib/errors"

interface ContainerNameEditorProps {
  containerId: string
  name: string | null
}

// Phase 22: the client's name for a numbered container — same field as the
// PI card's "Name" (PiLabelEditor): Enter or "Save" stores it, an empty
// field clears it. Not offered on "OK to mix" (the server refuses it).
export function ContainerNameEditor({
  containerId,
  name,
}: ContainerNameEditorProps) {
  const { t } = useTranslation()
  const rename = useRenameContainerMutation()
  const [draft, setDraft] = useState(name ?? "")

  const trimmed = draft.trim()
  const isDirty = trimmed !== (name ?? "")

  function save() {
    if (!isDirty || rename.isPending) return
    rename.mutate(
      { containerId, name: trimmed === "" ? null : trimmed },
      {
        onSuccess: (view) => {
          const saved = view.containers.find((c) => c.id === containerId)
          setDraft(saved?.name ?? "")
          toast.success(t("labelEditor.saved"))
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, t("labelEditor.failed"))),
      }
    )
  }

  return (
    <form
      className="flex items-center gap-2"
      data-testid="container-name-editor"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Input
        value={draft}
        maxLength={CONTAINER_NAME_MAX_LENGTH}
        placeholder={t("labelEditor.placeholder")}
        aria-label={t("readyToShip.card.nameAria")}
        className="h-7 w-44"
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button
        type="submit"
        size="xs"
        variant="outline"
        disabled={!isDirty || rename.isPending}
      >
        {rename.isPending ? t("common.saving") : t("common.save")}
      </Button>
    </form>
  )
}
