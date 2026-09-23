import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useAuth } from "@/auth/AuthContext"
import { usePiListQuery } from "@/api/proformaInvoices"
import { exportBackorderXlsx } from "@/api/backorderUploads"
import { getErrorMessage } from "@/lib/errors"
import { PiCard } from "@/pages/shared/PiCard"
import { UploadPiDialog } from "@/pages/shared/UploadPiDialog"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

// Used by both /ops/pi and /client/pi — the only role-conditional content is
// the upload button (ops-only); "Выгрузить весь бэкордер" is shown to both
// roles, the API itself scopes the export to the caller's customer_id.
export function PiListPage() {
  const { t } = useTranslation()
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
        <h1 className="text-xl font-semibold">{t("piList.title")}</h1>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-4 rounded border-input"
            />
            {t("piList.showArchived")}
          </Label>
          <Button
            variant="outline"
            size="sm"
            disabled={isExporting}
            onClick={() => {
              setIsExporting(true)
              exportBackorderXlsx()
                .catch((error) =>
                  toast.error(getErrorMessage(error, t("piList.exportFailed")))
                )
                .finally(() => setIsExporting(false))
            }}
          >
            {isExporting ? t("common.exporting") : t("piList.exportBackorder")}
          </Button>
          {user?.role === "ops" && <UploadPiDialog basePath={basePath} />}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      {!isLoading && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {list && list.length > 0
            ? t("piList.emptyWithArchived")
            : t("piList.empty")}
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
