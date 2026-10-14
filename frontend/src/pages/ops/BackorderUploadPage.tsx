import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Download, Loader2, TriangleAlert } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FileUploadForm } from "@/components/FileUploadForm"
import {
  exportSnapshot,
  useBackorderUploadsQuery,
  useUploadBackorderMutation,
  type BackorderUploadResult,
} from "@/api/backorderUploads"
import { formatDateTime } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"
import { isOutcomeUnknown } from "@/lib/uploadOutcome"
import { useRef, useState } from "react"

function ResultCard({ result }: { result: BackorderUploadResult }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("backorder.resultTitle", { name: result.fileName })}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">
            {t("backorder.rowsProcessed")}:{" "}
          </span>
          {result.rowsProcessed}
        </div>
        <div>
          <span className="text-muted-foreground">{t("backorder.newCards")}: </span>
          {result.newCardsCreated}
        </div>
        <div>
          <span className="text-muted-foreground">
            {t("backorder.cardsUpdated")}:{" "}
          </span>
          {result.cardsUpdated}
        </div>
        <div>
          <span className="text-muted-foreground">{t("backorder.archived")}: </span>
          {result.cardsArchived}
        </div>
        <div>
          <span className="text-muted-foreground">{t("backorder.skipped")}: </span>
          {result.cardsSkippedInvalidRows}
        </div>
      </CardContent>
    </Card>
  )
}

export function BackorderUploadPage() {
  const { t } = useTranslation()
  const { data: uploads, isLoading } = useBackorderUploadsQuery()
  const mutation = useUploadBackorderMutation()
  const [lastResult, setLastResult] = useState<BackorderUploadResult | null>(
    null
  )
  const [exportingId, setExportingId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  // Set synchronously on submit: a second click that lands before React has
  // re-rendered the disabled button is still refused.
  const inFlight = useRef(false)
  // No answer came (gateway timeout, dropped connection): the upload may
  // have gone through, so the page says to check the history, not to retry.
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  function refreshHistory() {
    queryClient.invalidateQueries({ queryKey: ["backorder-uploads"] })
    queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
  }

  function handleUpload(file: File) {
    if (inFlight.current) return
    inFlight.current = true
    setOutcomeUnknown(false)
    mutation.mutate(file, {
      onSuccess: (result) => {
        setLastResult(result)
        toast.success(
          t("backorder.success", {
            rows: result.rowsProcessed,
            created: result.newCardsCreated,
            updated: result.cardsUpdated,
            archived: result.cardsArchived,
          })
        )
      },
      onError: (error) => {
        if (isOutcomeUnknown(error)) {
          setOutcomeUnknown(true)
          refreshHistory()
          return
        }
        toast.error(getErrorMessage(error, t("backorder.failed")))
      },
      onSettled: () => {
        inFlight.current = false
      },
    })
  }

  function handleExportSnapshot(id: string) {
    setExportingId(id)
    exportSnapshot(id)
      .catch((error) =>
        toast.error(getErrorMessage(error, t("common.downloadFailed")))
      )
      .finally(() => setExportingId(null))
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("backorder.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("backorder.uploadCard")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FileUploadForm
            accept=".xlsx"
            submitLabel={t("backorder.submit")}
            pendingLabel={t("backorder.uploading")}
            isSubmitting={mutation.isPending}
            className="flex flex-col gap-3 sm:max-w-sm"
            onSubmit={handleUpload}
          />
          {mutation.isPending && (
            <div
              role="status"
              aria-live="polite"
              data-testid="backorder-uploading"
              className="mt-3 flex items-start gap-2 text-sm"
            >
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
              <div>
                <p className="font-medium">{t("backorder.uploading")}</p>
                <p className="text-muted-foreground">
                  {t("backorder.uploadingHint")}
                </p>
              </div>
            </div>
          )}
          {outcomeUnknown && !mutation.isPending && (
            <div
              role="alert"
              data-testid="backorder-outcome-unknown"
              className="mt-3 flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="flex flex-col items-start gap-2">
                <p className="font-medium">{t("backorder.noAnswerTitle")}</p>
                <p>{t("backorder.noAnswerText")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    refreshHistory()
                    historyRef.current?.scrollIntoView({ behavior: "smooth" })
                  }}
                >
                  {t("backorder.refreshHistory")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {lastResult && <ResultCard result={lastResult} />}

      <Card ref={historyRef}>
        <CardHeader>
          <CardTitle>{t("backorder.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          )}
          {!isLoading && (!uploads || uploads.length === 0) && (
            <p className="text-sm text-muted-foreground">
              {t("backorder.empty")}
            </p>
          )}
          {uploads && uploads.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("backorder.columns.date")}</TableHead>
                  <TableHead>{t("backorder.columns.file")}</TableHead>
                  <TableHead>{t("backorder.columns.uploadedBy")}</TableHead>
                  <TableHead>{t("backorder.columns.rows")}</TableHead>
                  <TableHead>{t("backorder.columns.newCards")}</TableHead>
                  <TableHead>{t("backorder.columns.archived")}</TableHead>
                  <TableHead>{t("backorder.columns.skipped")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.download")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploads.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{formatDateTime(u.uploadedAt)}</TableCell>
                    <TableCell>{u.fileName}</TableCell>
                    <TableCell>{u.uploadedBy.email}</TableCell>
                    <TableCell>{u.rowsProcessed}</TableCell>
                    <TableCell>{u.newCardsCreated}</TableCell>
                    <TableCell>{u.cardsArchived}</TableCell>
                    <TableCell>{u.rowsSkipped}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={exportingId === u.id}
                        onClick={() => handleExportSnapshot(u.id)}
                      >
                        <Download /> {t("common.download")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
