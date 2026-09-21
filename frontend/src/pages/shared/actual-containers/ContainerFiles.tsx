import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Download, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { AddAdditionalFileForm } from "@/pages/shared/AddAdditionalFileForm"
import {
  downloadContainerFile,
  useAddContainerFileMutation,
  useDeleteContainerFileMutation,
  type ActualContainerFile,
} from "@/api/actualContainers"
import { formatDateTime } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"

interface ContainerFilesProps {
  containerId: string
  files: ActualContainerFile[]
  // ops adds and deletes; client only downloads.
  canEdit: boolean
}

// One flat list of files, no types (packing list, photos, Excel, PDF — any
// format), as the spec asks.
export function ContainerFiles({ containerId, files, canEdit }: ContainerFilesProps) {
  const { t } = useTranslation()
  const add = useAddContainerFileMutation(containerId)
  const remove = useDeleteContainerFileMutation(containerId)
  const [toDelete, setToDelete] = useState<ActualContainerFile | null>(null)
  // Remounts the add form after a successful upload so the chosen file and
  // description are cleared.
  const [formVersion, setFormVersion] = useState(0)

  return (
    <div className="grid gap-3">
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("shipped.detail.files.empty")}
        </p>
      ) : (
        <ul className="grid gap-2" data-testid="container-files">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center gap-2 text-sm"
              data-file-name={file.fileName}
            >
              <span className="font-medium">{file.fileName}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  downloadContainerFile(file.id, file.fileName).catch((error) =>
                    toast.error(getErrorMessage(error, t("common.downloadFailed")))
                  )
                }
              >
                <Download /> {t("common.download")}
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setToDelete(file)}
                >
                  <Trash2 /> {t("common.delete")}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDateTime(file.uploadedAt)} · {file.uploadedBy?.email ?? "—"}
                {file.description && ` — ${file.description}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <AddAdditionalFileForm
          key={formVersion}
          isSubmitting={add.isPending}
          onSubmit={(file, description) =>
            add.mutate(
              { file, description },
              {
                onSuccess: () => {
                  toast.success(t("common.fileAdded"))
                  setFormVersion((v) => v + 1)
                },
                onError: (error) =>
                  toast.error(getErrorMessage(error, t("common.addFileFailed"))),
              }
            )
          }
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null)
        }}
        title={t("shipped.detail.files.deleteTitle")}
        description={t("shipped.detail.files.deleteDescription", {
          name: toDelete?.fileName ?? "",
        })}
        confirmLabel={t("common.delete")}
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (!toDelete) return
          remove.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success(t("shipped.detail.files.deleted"))
              setToDelete(null)
            },
            onError: (error) => {
              toast.error(getErrorMessage(error, t("common.deleteFileFailed")))
              setToDelete(null)
            },
          })
        }}
      />
    </div>
  )
}
