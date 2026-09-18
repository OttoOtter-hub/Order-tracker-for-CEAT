import { toast } from "sonner"
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Загрузка «{result.fileName}» обработана</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">Строк обработано: </span>
          {result.rowsProcessed}
        </div>
        <div>
          <span className="text-muted-foreground">Новых карточек: </span>
          {result.newCardsCreated}
        </div>
        <div>
          <span className="text-muted-foreground">Обновлено карточек: </span>
          {result.cardsUpdated}
        </div>
        <div>
          <span className="text-muted-foreground">Заархивировано: </span>
          {result.cardsArchived}
        </div>
        <div>
          <span className="text-muted-foreground">Пропущено строк: </span>
          {result.cardsSkippedInvalidRows}
        </div>
      </CardContent>
    </Card>
  )
}

export function BackorderUploadPage() {
  const { data: uploads, isLoading } = useBackorderUploadsQuery()
  const mutation = useUploadBackorderMutation()
  const [lastResult, setLastResult] = useState<BackorderUploadResult | null>(
    null
  )

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Загрузка бэкордера</h1>

      <Card>
        <CardHeader>
          <CardTitle>Загрузить файл</CardTitle>
        </CardHeader>
        <CardContent>
          <FileUploadForm
            accept=".xlsx"
            submitLabel="Загрузить"
            isSubmitting={mutation.isPending}
            className="flex flex-col gap-3 sm:max-w-sm"
            onSubmit={(file) =>
              mutation.mutate(file, {
                onSuccess: (result) => {
                  setLastResult(result)
                  toast.success(
                    `Обработано ${result.rowsProcessed} строк: ${result.newCardsCreated} новых, ${result.cardsUpdated} обновлено, ${result.cardsArchived} заархивировано`
                  )
                },
                onError: (error) =>
                  toast.error(
                    getErrorMessage(error, "Не удалось загрузить файл")
                  ),
              })
            }
          />
        </CardContent>
      </Card>

      {lastResult && <ResultCard result={lastResult} />}

      <Card>
        <CardHeader>
          <CardTitle>История загрузок</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          )}
          {!isLoading && (!uploads || uploads.length === 0) && (
            <p className="text-sm text-muted-foreground">Загрузок ещё не было.</p>
          )}
          {uploads && uploads.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Файл</TableHead>
                  <TableHead>Загрузил</TableHead>
                  <TableHead>Строк</TableHead>
                  <TableHead>Новых карточек</TableHead>
                  <TableHead>Заархивировано</TableHead>
                  <TableHead>Пропущено строк</TableHead>
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
