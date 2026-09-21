import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  useBackorderUploadsQuery,
  useUploadBackorderMutation,
  type BackorderUploadResult,
} from "@/api/backorderUploads"
import { formatDateTime } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"
import { useState } from "react"

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
            isSubmitting={mutation.isPending}
            className="flex flex-col gap-3 sm:max-w-sm"
            onSubmit={(file) =>
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
                onError: (error) =>
                  toast.error(
                    getErrorMessage(error, t("backorder.failed"))
                  ),
              })
            }
          />
        </CardContent>
      </Card>

      {lastResult && <ResultCard result={lastResult} />}

      <Card>
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
