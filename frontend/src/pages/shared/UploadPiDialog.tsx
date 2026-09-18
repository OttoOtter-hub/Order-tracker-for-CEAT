import { useState } from "react"
import { useNavigate } from "react-router-dom"
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

interface UploadPiDialogProps {
  basePath: string
}

// Ops-only, top-level action on the PI list — not tied to any existing
// card. Number comes from the filename server-side: if a card with that
// number already exists (e.g. created from a backorder row) this fills in
// its pi_file_url, otherwise it creates a new card.
export function UploadPiDialog({ basePath }: UploadPiDialogProps) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const mutation = useUploadPiMutation()

  function handleSubmit(file: File) {
    mutation.mutate(file, {
      onSuccess: (pi) => {
        setOpen(false)
        toast.success(`Проформа ${pi.piNumber} загружена`)
        navigate(`${basePath}/pi/${pi.id}`)
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, "Не удалось загрузить проформу"))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Загрузить проформу</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Загрузить проформу</DialogTitle>
          <DialogDescription>
            Номер PI распознаётся из имени файла. Если карточка с этим
            номером уже есть и файл ещё не загружен — он будет прикреплён к
            ней, иначе создастся новая карточка.
          </DialogDescription>
        </DialogHeader>
        <FileUploadForm
          accept=".pdf,application/pdf"
          submitLabel="Загрузить"
          isSubmitting={mutation.isPending}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
