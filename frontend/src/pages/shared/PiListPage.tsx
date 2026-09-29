import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Search } from "lucide-react"
import { useAuth } from "@/auth/AuthContext"
import { usePiListQuery, type ProformaInvoice } from "@/api/proformaInvoices"
import { exportBackorderXlsx } from "@/api/backorderUploads"
import { getErrorMessage } from "@/lib/errors"
import { PiCard } from "@/pages/shared/PiCard"
import { UploadPiDialog } from "@/pages/shared/UploadPiDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { matchesSearch } from "@/lib/search"
import { cn } from "@/lib/utils"

type PiTab = "active" | "archive"

// A card matches by its number and name, or by any of its lines' material
// and description (the list already carries the lines, fully shipped ones too).
function cardMatches(pi: ProformaInvoice, needle: string): boolean {
  return matchesSearch(needle, [
    pi.piNumber,
    pi.label,
    ...(pi.lineItems ?? []).flatMap((line) => [line.materialNum, line.materialDesc]),
  ])
}

// Used by both /ops/pi and /client/pi — the only role-conditional content is
// the upload button (ops-only); "Выгрузить весь бэкордер" is shown to both
// roles, the API itself scopes the export to the caller's customer_id.
export function PiListPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: list, isLoading } = usePiListQuery()
  const [tab, setTab] = useState<PiTab>("active")
  const [isExporting, setIsExporting] = useState(false)
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query).trim()

  const basePath = user?.role === "ops" ? "/ops" : "/client"

  const { active, archived } = useMemo(() => {
    const all = (list ?? []).filter((pi) => cardMatches(pi, needle))
    return {
      active: all.filter((pi) => !pi.isArchivedShipped),
      archived: all.filter((pi) => pi.isArchivedShipped),
    }
  }, [list, needle])
  const visible = tab === "active" ? active : archived

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("piList.title")}</h1>
        <div className="flex items-center gap-4">
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

      {/* Active / Archive — both roles; the archive is read-only (fully
          shipped, or gone from the backorder) but every card opens. */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={t("piList.title")}
          className="flex w-fit items-center gap-1 rounded-lg border p-1"
        >
          {(
            [
              ["active", t("piList.tabActive"), active.length],
              ["archive", t("piList.tabArchive"), archived.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`pi-tab-${key}`}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors",
                tab === key
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
              <span className="tabular-nums opacity-80">{count}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("piList.searchPlaceholder")}
            aria-label={t("piList.searchAria")}
            className="pl-8"
            data-testid="pi-list-search"
          />
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      {!isLoading && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {needle
            ? t("piList.emptySearch")
            : tab === "archive"
              ? t("piList.emptyArchive")
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
