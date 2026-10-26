import { useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/api/client"
import { useImportLoadListMutation } from "@/api/readyToShip"
import { getErrorDetailMessages, getErrorMessage } from "@/lib/errors"
import type { ReadyToShipMode } from "@/pages/shared/ready-to-ship/ContainerCard"
import { useReadyToShipCustomer } from "@/pages/shared/ready-to-ship/customerContext"

// Phase 25: the load list from an Excel file in the export's own format
// (Container / SKU / Proforma (PI) / SO / Quantity). The server checks the
// whole file first: either it applies all of it (one undo puts the previous
// layout back), or nothing — and says what's wrong, row by row. Containers
// the file names that don't exist yet are created only once ops agrees.
export function ImportDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ReadyToShipMode
}) {
  const { t } = useTranslation()
  const customerId = useReadyToShipCustomer()
  const upload = useImportLoadListMutation(customerId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [newContainers, setNewContainers] = useState<string | null>(null)

  function reset() {
    setFile(null)
    setProblems([])
    setNewContainers(null)
  }

  function close(next: boolean) {
    // Not while the file is being applied: the answer would be lost.
    if (upload.isPending) return
    if (!next) reset()
    onOpenChange(next)
  }

  function send(confirmNewContainers: boolean) {
    if (!file) return
    setProblems([])
    upload.mutate(
      { file, confirmNewContainers },
      {
        onSuccess: () => {
          toast.success(t("readyToShip.import.done"))
          reset()
          onOpenChange(false)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "IMPORT_CONFIRM_NEW_CONTAINERS") {
            setNewContainers(getErrorMessage(error))
            return
          }
          setNewContainers(null)
          const details = getErrorDetailMessages(error)
          if (details.length > 0) {
            setProblems(details)
          } else {
            toast.error(getErrorMessage(error, t("readyToShip.import.failed")))
          }
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        data-testid="import-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("readyToShip.import.title")}</DialogTitle>
          <DialogDescription>
            {mode === "ops"
              ? t("readyToShip.import.descriptionOps")
              : t("readyToShip.import.descriptionClient")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null
              e.target.value = ""
              reset()
              setFile(picked)
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload /> {t("readyToShip.import.pick")}
          </Button>
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {file ? file.name : t("readyToShip.import.noFile")}
          </span>
        </div>

        {problems.length > 0 && (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            data-testid="import-problems"
          >
            <p className="font-medium text-destructive">
              {t("readyToShip.import.problemsTitle", { n: problems.length })}
            </p>
            <ul className="mt-1 max-h-64 list-disc overflow-y-auto pl-5 text-xs">
              {problems.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </div>
        )}

        {newContainers && (
          <div
            className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
            data-testid="import-new-containers"
          >
            <p>{newContainers}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("readyToShip.import.newContainersHint")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => close(false)}
          >
            {t("common.cancel")}
          </Button>
          {newContainers ? (
            <Button
              type="button"
              disabled={upload.isPending}
              data-testid="import-confirm-new"
              onClick={() => send(true)}
            >
              {upload.isPending
                ? t("common.uploading")
                : t("readyToShip.import.createAndApply")}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!file || upload.isPending}
              data-testid="import-apply"
              onClick={() => send(false)}
            >
              {upload.isPending ? t("common.uploading") : t("readyToShip.import.apply")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
