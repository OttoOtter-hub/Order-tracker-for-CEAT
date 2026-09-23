import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  usePiFileHistoryQuery,
  type PiFileHistoryEntry,
  type PiFileType,
} from "@/api/proformaInvoices"
import { formatDateTime } from "@/lib/format"
import { openFile } from "@/lib/download"
import { getErrorMessage } from "@/lib/errors"

const FILE_TYPES: { type: PiFileType; labelKey: string }[] = [
  { type: "original", labelKey: "piDetail.files.original" },
  { type: "signed", labelKey: "piDetail.files.signed" },
]

// Phase 19: every version of the card's original and signed files, current
// and replaced. Read-only for both roles — the only action is downloading
// (same /files/:id/download as everywhere, the backend lets a client through
// for archived versions of their own card). Collapsed by default, and the
// request is only made once it's opened.
export function PiFileHistory({ piId }: { piId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const history = usePiFileHistoryQuery(piId, open)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            className="flex items-center gap-1.5 text-left"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronRight className="size-4" aria-hidden />
            )}
            {t("piDetail.history.title")}
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-4">
          {history.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : history.isError ? (
            <p className="text-sm text-destructive">
              {getErrorMessage(history.error, t("piDetail.history.loadFailed"))}
            </p>
          ) : (
            FILE_TYPES.map(({ type, labelKey }, index) => (
              <div key={type} className="grid gap-2">
                {index > 0 && <Separator />}
                <h3 className="text-sm font-medium">{t(labelKey)}</h3>
                <VersionList
                  versions={(history.data ?? []).filter((v) => v.fileType === type)}
                />
              </div>
            ))
          )}
        </CardContent>
      )}
    </Card>
  )
}

function VersionList({ versions }: { versions: PiFileHistoryEntry[] }) {
  const { t } = useTranslation()
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("piDetail.history.none")}</p>
    )
  }
  return (
    <ul className="grid gap-2">
      {versions.map((version) => (
        <li
          key={version.id ?? `current-${version.fileType}`}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openFile(version.fileUrl).catch((error) =>
                toast.error(getErrorMessage(error, t("common.downloadFailed")))
              )
            }
          >
            {t("common.download")}
          </Button>
          {version.isCurrent ? (
            <Badge>{t("piDetail.history.current")}</Badge>
          ) : (
            <Badge variant="outline">{t("piDetail.history.archived")}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {t("common.uploadedAt", { date: formatDateTime(version.uploadedAt) })}
            {version.uploadedBy && ` · ${version.uploadedBy.email}`}
            {version.replacedAt &&
              ` · ${t("piDetail.history.replacedAt", {
                date: formatDateTime(version.replacedAt),
              })}`}
          </span>
        </li>
      ))}
    </ul>
  )
}
