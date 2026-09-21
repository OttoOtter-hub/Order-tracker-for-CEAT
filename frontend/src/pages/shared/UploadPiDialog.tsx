import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FileUploadForm } from "@/components/FileUploadForm"
import { useUploadPiMutation } from "@/api/proformaInvoices"
import { getErrorMessage } from "@/lib/errors"
import { formatPiTitle } from "@/lib/format"

interface UploadPiDialogProps {
  basePath: string
}

// Ops-only, top-level action on the PI list — not tied to any existing
// card. Number comes from the filename server-side: if a card with that
// number already exists (e.g. created from a backorder row) this fills in
// its pi_file_url, otherwise it creates a new card.
export function UploadPiDialog({ basePath }: UploadPiDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const mutation = useUploadPiMutation()

  function handleSubmit(file: File) {
    mutation.mutate(file, {
      onSuccess: (pi) => {
        setOpen(false)
        toast.success(
          t("uploadPi.success", { title: formatPiTitle(pi.piNumber, pi.label) })
        )
        navigate(`${basePath}/pi/${pi.id}`)
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, t("uploadPi.failed")))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("uploadPi.trigger")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("uploadPi.title")}</DialogTitle>
          <DialogDescription>{t("uploadPi.description")}</DialogDescription>
        </DialogHeader>
        <FileUploadForm
          accept=".pdf,application/pdf"
          submitLabel={t("uploadPi.submit")}
          isSubmitting={mutation.isPending}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
