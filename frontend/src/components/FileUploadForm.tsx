import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface FileUploadFormProps {
  onSubmit: (file: File) => void
  isSubmitting: boolean
  submitLabel: string
  accept?: string
  className?: string
}

// Plain <input type="file"> — no drag-drop, this pilot doesn't need it.
export function FileUploadForm({
  onSubmit,
  isSubmitting,
  submitLabel,
  accept,
  className,
}: FileUploadFormProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (file) {
      onSubmit(file)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className ?? "flex flex-col gap-3"}>
      <Input
        type="file"
        accept={accept}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button type="submit" disabled={!file || isSubmitting}>
        {isSubmitting ? t("common.uploading") : submitLabel}
      </Button>
    </form>
  )
}
