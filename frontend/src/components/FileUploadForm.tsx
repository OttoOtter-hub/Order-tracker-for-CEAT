import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface FileUploadFormProps {
  onSubmit: (file: File) => void
  isSubmitting: boolean
  submitLabel: string
  // The button's text while submitting (default "Uploading...").
  pendingLabel?: string
  accept?: string
  className?: string
}

// Plain <input type="file"> — no drag-drop, this pilot doesn't need it.
export function FileUploadForm({
  onSubmit,
  isSubmitting,
  submitLabel,
  pendingLabel,
  accept,
  className,
}: FileUploadFormProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (file && !isSubmitting) {
      onSubmit(file)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className ?? "flex flex-col gap-3"}>
      {/* Locked while a file is on its way: no other file can be picked
          and the button can't be pressed again until the answer is in. */}
      <Input
        type="file"
        accept={accept}
        disabled={isSubmitting}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button type="submit" disabled={!file || isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting ? (pendingLabel ?? t("common.uploading")) : submitLabel}
      </Button>
    </form>
  )
}
