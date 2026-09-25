import { Fragment, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_PAGE_SIZE,
  useAuditLogQuery,
  type AuditLogEntry,
  type AuditLogFilters,
} from "@/api/auditLog"
import { useUsersQuery } from "@/api/users"
import { formatDate, formatDateTime } from "@/lib/format"
import { openFile } from "@/lib/download"
import { getErrorMessage } from "@/lib/errors"
import { useContainerName } from "@/lib/readyToShip"

// Radix Select can't hold "" as an item value — this stands for "no filter".
const ANY = "any"

// Ids that mean nothing to a reader; the entity column already links the object.
const HIDDEN_FIELDS = new Set(["lineItemId", "allocationId", "customerId"])

// Postgres jsonb doesn't keep key order, so details are laid out in this
// order (what it is about, then before/after, then files, then counters);
// anything not listed goes last.
const FIELD_ORDER = [
  "piNumber",
  "containerNumber",
  "containerLabel",
  "containerLabels",
  "email",
  "role",
  "customerName",
  "isAdmin",
  "materialNum",
  "soNumber",
  "lines",
  "qty",
  "undoneDelta",
  "from",
  "to",
  "overrideEtd",
  "overrideEta",
  "fileName",
  "fileUrl",
  "description",
  "cardCreated",
  "replacedPrevious",
  "currentFileUrl",
  "previousFileUrl",
  "proposedFileUrl",
  "confirmedAt",
  "confirmedBy",
  "positionsLocked",
  "containersUnlocked",
  "positionsUnlocked",
  "positionsRolledBack",
  "linesReset",
  "rowsProcessed",
  "newCardsCreated",
  "cardsUpdated",
  "cardsArchived",
  "rowsSkipped",
  "containersCreated",
]

function inFieldOrder<T>(entries: [string, T][]): [string, T][] {
  const rank = (key: string) => {
    const index = FIELD_ORDER.indexOf(key)
    return index === -1 ? FIELD_ORDER.length : index
  }
  return [...entries].sort(([a], [b]) => rank(a) - rank(b))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

// A <input type="date"> day in the user's own timezone -> [start, next day).
function dayStart(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString()
}
function dayEnd(day: string): string {
  const next = new Date(`${day}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return next.toISOString()
}

// Phase 20b: the action journal — ops only, read only.
export function AuditLogPage() {
  const { t } = useTranslation()
  const [actorUserId, setActorUserId] = useState(ANY)
  const [entityType, setEntityType] = useState(ANY)
  const [fromDay, setFromDay] = useState("")
  const [toDay, setToDay] = useState("")
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const users = useUsersQuery()

  const filters: AuditLogFilters = {
    actorUserId: actorUserId === ANY ? undefined : actorUserId,
    entityType: entityType === ANY ? undefined : entityType,
    from: fromDay ? dayStart(fromDay) : undefined,
    to: toDay ? dayEnd(toDay) : undefined,
  }
  const log = useAuditLogQuery(filters, page)
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / AUDIT_PAGE_SIZE)) : 1

  // Any filter change starts again from the first page.
  function changeFilter<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setPage(1)
    }
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const hasFilters =
    actorUserId !== ANY || entityType !== ANY || fromDay !== "" || toDay !== ""

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("audit.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("audit.description")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">{t("audit.filters.user")}</Label>
          <Select value={actorUserId} onValueChange={changeFilter(setActorUserId)}>
            <SelectTrigger className="w-56" aria-label={t("audit.filters.user")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("audit.filters.anyUser")}</SelectItem>
              {(users.data ?? []).map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">
            {t("audit.filters.entityType")}
          </Label>
          <Select value={entityType} onValueChange={changeFilter(setEntityType)}>
            <SelectTrigger className="w-56" aria-label={t("audit.filters.entityType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("audit.filters.anyEntityType")}</SelectItem>
              {AUDIT_ENTITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`audit.entityTypes.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
            {t("audit.filters.from")}
          </Label>
          <Input
            id="audit-from"
            type="date"
            className="w-40"
            value={fromDay}
            max={toDay || undefined}
            onChange={(e) => changeFilter(setFromDay)(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
            {t("audit.filters.to")}
          </Label>
          <Input
            id="audit-to"
            type="date"
            className="w-40"
            value={toDay}
            min={fromDay || undefined}
            onChange={(e) => changeFilter(setToDay)(e.target.value)}
          />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActorUserId(ANY)
              setEntityType(ANY)
              setFromDay("")
              setToDay("")
              setPage(1)
            }}
          >
            {t("audit.filters.reset")}
          </Button>
        )}
      </div>

      {log.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : log.isError ? (
        <p className="text-sm text-destructive">
          {getErrorMessage(log.error, t("audit.loadFailed"))}
        </p>
      ) : !log.data?.items.length ? (
        <p className="text-sm text-muted-foreground">{t("audit.empty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("audit.total", { count: log.data.total })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("audit.columns.when")}</TableHead>
                <TableHead>{t("audit.columns.who")}</TableHead>
                <TableHead>{t("audit.columns.action")}</TableHead>
                <TableHead>{t("audit.columns.entity")}</TableHead>
                <TableHead className="w-28">{t("audit.columns.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.data.items.map((entry) => {
                const isOpen = expanded.has(entry.id)
                return (
                  <Fragment key={entry.id}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell>{entry.actor?.email ?? "—"}</TableCell>
                      <TableCell>
                        <ActionText action={entry.action} />
                      </TableCell>
                      <TableCell>
                        <EntityCell entry={entry} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          aria-expanded={isOpen}
                          onClick={() => toggle(entry.id)}
                        >
                          {isOpen ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                          {isOpen ? t("audit.hide") : t("audit.show")}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={5}>
                          <Details metadata={entry.metadata} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("audit.page", { page, pages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || log.isFetching}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("audit.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages || log.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("audit.next")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// An action code the dictionary doesn't know (a newer backend) shows as is.
function ActionText({ action }: { action: string }) {
  const { t, i18n } = useTranslation()
  const key = `audit.actions.${action}`
  return <>{i18n.exists(key) ? t(key) : action}</>
}

function EntityCell({ entry }: { entry: AuditLogEntry }) {
  const { t, i18n } = useTranslation()
  const containerName = useContainerName()
  const meta = entry.metadata
  const text = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : null)

  let reference: ReactNode = null
  switch (entry.entityType) {
    case "pi":
      reference =
        entry.entityId && text("piNumber") ? (
          <Link className="underline underline-offset-2" to={`/ops/pi/${entry.entityId}`}>
            {text("piNumber")}
          </Link>
        ) : (
          text("piNumber")
        )
      break
    case "actual_container":
      reference =
        entry.entityId && text("containerNumber") ? (
          <Link
            className="underline underline-offset-2"
            to={`/ops/actual-containers/${entry.entityId}`}
          >
            {text("containerNumber")}
          </Link>
        ) : (
          text("containerNumber")
        )
      break
    case "shipping_container":
      reference = text("containerLabel") ? containerName(text("containerLabel")!) : null
      break
    case "backorder_upload":
      reference = text("fileName")
      break
    case "user":
      reference = text("email")
      break
  }
  const typeKey = `audit.entityTypes.${entry.entityType}`
  return (
    <div className="grid">
      <span className="text-xs text-muted-foreground">
        {i18n.exists(typeKey) ? t(typeKey) : entry.entityType}
      </span>
      {reference && <span>{reference}</span>}
    </div>
  )
}

function Details({ metadata }: { metadata: Record<string, unknown> }) {
  const { t } = useTranslation()
  // A file's name and its link are one line: "File: BL.pdf [Download]".
  const pairedFile = typeof metadata.fileName === "string" && typeof metadata.fileUrl === "string"
  const fields = inFieldOrder(
    Object.entries(metadata).filter(
      ([key]) => !HIDDEN_FIELDS.has(key) && !(pairedFile && key === "fileUrl")
    )
  )
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("audit.noDetails")}</p>
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {fields.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="text-muted-foreground">
            <FieldLabel name={key} />
          </dt>
          <dd className="flex flex-wrap items-center gap-2">
            <FieldValue name={key} value={value} />
            {pairedFile && key === "fileName" && (
              <FieldValue name="fileUrl" value={metadata.fileUrl} />
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

function FieldLabel({ name }: { name: string }) {
  const { t, i18n } = useTranslation()
  const key = `audit.fields.${name}`
  return <>{i18n.exists(key) ? t(key) : name}</>
}

function FieldValue({ name, value }: { name: string; value: unknown }): ReactNode {
  const { t, i18n } = useTranslation()
  const containerName = useContainerName()

  if (value === null || value === undefined || value === "") {
    return "—"
  }
  if (typeof value === "boolean") {
    return value ? t("audit.yes") : t("audit.no")
  }
  if (typeof value === "string" && /FileUrl$|^fileUrl$/.test(name) && value.startsWith("/files/")) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-6"
        onClick={() =>
          openFile(value).catch((error) =>
            toast.error(getErrorMessage(error, t("common.downloadFailed")))
          )
        }
      >
        {t("audit.download")}
      </Button>
    )
  }
  if (name === "containerLabel" && typeof value === "string") {
    return containerName(value)
  }
  if (name === "containerLabels" && Array.isArray(value)) {
    return value.map((label) => containerName(String(label))).join(", ")
  }
  if (name === "role" && typeof value === "string") {
    const key = `users.roles.${value}`
    return i18n.exists(key) ? t(key) : value
  }
  if (Array.isArray(value)) {
    return value.map(String).join(", ")
  }
  if (typeof value === "object") {
    // e.g. dates_changed's { from: { overrideEtd, overrideEta }, to: {…} }
    const parts = inFieldOrder(Object.entries(value as Record<string, unknown>))
    return (
      <span className="inline-flex flex-wrap gap-x-3">
        {parts.map(([innerName, innerValue]) => (
          <span key={innerName}>
            <span className="text-muted-foreground">
              <FieldLabel name={innerName} />:
            </span>{" "}
            <FieldValue name={innerName} value={innerValue} />
          </span>
        ))}
      </span>
    )
  }
  if (typeof value === "string" && ISO_DATE.test(value)) {
    return formatDate(value)
  }
  if (typeof value === "string" && ISO_DATE_TIME.test(value)) {
    return formatDateTime(value)
  }
  return String(value)
}
