import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface AddAdditionalFileFormProps {
  onSubmit: (file: File, description?: string) => void
  isSubmitting: boolean
}

export function AddAdditionalFileForm({
  onSubmit,
  isSubmitting,
}: AddAdditionalFileFormProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (file) {
      onSubmit(file, description.trim() || undefined)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Textarea
        placeholder={t("common.descriptionOptional")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <Button type="submit" disabled={!file || isSubmitting} className="self-start">
        {isSubmitting ? t("common.uploading") : t("common.addFile")}
      </Button>
    </form>
  )
}
