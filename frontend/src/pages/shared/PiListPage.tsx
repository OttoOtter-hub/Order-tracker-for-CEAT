import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/auth/AuthContext"
import { usePiListQuery } from "@/api/proformaInvoices"
import { exportBackorderXlsx } from "@/api/backorderUploads"
import { PiCard } from "@/pages/shared/PiCard"
import { UploadPiDialog } from "@/pages/shared/UploadPiDialog"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

// Used by both /ops/pi and /client/pi — the only role-conditional content is
// the upload button (ops-only); "Выгрузить весь бэкордер" is shown to both
// roles, the API itself scopes the export to the caller's customer_id.
export function PiListPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: list, isLoading } = usePiListQuery()
  const [showArchived, setShowArchived] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const basePath = user?.role === "ops" ? "/ops" : "/client"

  const visible = useMemo(() => {
    if (!list) return []
    return showArchived ? list : list.filter((pi) => !pi.isArchivedShipped)
  }, [list, showArchived])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {user?.role === "ops" ? "Проформы" : "Мои проформы"}
        </h1>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Показать архивные
          </Label>
          <Button
            variant="outline"
            size="sm"
            disabled={isExporting}
            onClick={() => {
              setIsExporting(true)
              exportBackorderXlsx()
                .catch(() => toast.error("Не удалось выгрузить бэкордер"))
                .finally(() => setIsExporting(false))
            }}
          >
            {isExporting ? "Выгрузка..." : "Выгрузить весь бэкордер"}
          </Button>
          {user?.role === "ops" && <UploadPiDialog basePath={basePath} />}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      )}

      {!isLoading && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {list && list.length > 0
            ? "Нет карточек — включите «Показать архивные», чтобы увидеть их."
            : "Пока нет ни одной карточки."}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((pi) => (
          <PiCard
            key={pi.id}
            pi={pi}
            onClick={() => navigate(`${basePath}/pi/${pi.id}`)}
          />
        ))}
      </div>
    </div>
  )
}
