import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Download, LockOpen, PackageOpen } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { useAuth } from "@/auth/AuthContext"
import { useCustomersQuery } from "@/api/customers"
import {
  exportReadyToShipXlsx,
  useMoveRemainingToMixMutation,
  useReadyToShipQuery,
  useUnlockAllMutation,
  useUnlockAllocationMutation,
  useUnlockContainerMutation,
  type ShippingContainer,
  type UnallocatedLine,
} from "@/api/readyToShip"
import { ActionsBar } from "@/pages/shared/ready-to-ship/ActionsBar"
import {
  ContainerCard,
  type ReadyToShipMode,
  type UnlockAllocationTarget,
} from "@/pages/shared/ready-to-ship/ContainerCard"
import { MoveDialog } from "@/pages/shared/ready-to-ship/MoveDialog"
import {
  RemoveDialog,
  type RemoveTarget,
} from "@/pages/shared/ready-to-ship/RemoveDialog"
import { ReadyLinesTable } from "@/pages/shared/ready-to-ship/ReadyLinesTable"
import { formatNumber } from "@/lib/format"
import { useContainerName, useContainerTitle } from "@/lib/readyToShip"
import { getErrorMessage } from "@/lib/errors"

// Used by /client/ready-to-ship (working tool) and /ops/ready-to-ship (the
// same picture, read-only, plus "Разблокировать" on confirmed containers).
export function ReadyToShipPage() {
  const { user } = useAuth()
  if (user?.role === "ops") {
    return <OpsReadyToShip />
  }
  return <ReadyToShipContent mode="client" />
}

// ops must name the customer (the API has no "current customer" for them).
// The pilot has exactly one, which is then picked automatically; a picker
// appears as soon as a second one exists.
function OpsReadyToShip() {
  const { t } = useTranslation()
  const { data: customers, isLoading } = useCustomersQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const customerId = selectedId ?? customers?.[0]?.id

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
  }
  if (!customerId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("readyToShip.noCustomers")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {customers && customers.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("readyToShip.customer")}:</span>
          <Select value={customerId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-64" aria-label={t("readyToShip.customer")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <ReadyToShipContent key={customerId} mode="ops" customerId={customerId} />
    </div>
  )
}

function ReadyToShipContent({
  mode,
  customerId,
}: {
  mode: ReadyToShipMode
  customerId?: string
}) {
  const { t } = useTranslation()
  const containerName = useContainerName()
  const containerTitle = useContainerTitle()
  const isClient = mode === "client"
  const query = useReadyToShipQuery(customerId)
  const unlock = useUnlockContainerMutation()
  const unlockAllocation = useUnlockAllocationMutation()
  const moveRemaining = useMoveRemainingToMixMutation(customerId)
  const unlockAll = useUnlockAllMutation(customerId)

  const [moveLine, setMoveLine] = useState<UnallocatedLine | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<ShippingContainer | null>(null)
  const [unlockAllocationTarget, setUnlockAllocationTarget] =
    useState<UnlockAllocationTarget | null>(null)
  const [lastContainerId, setLastContainerId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [confirmMoveRemaining, setConfirmMoveRemaining] = useState(false)
  const [confirmUnlockAll, setConfirmUnlockAll] = useState(false)

  const view = query.data

  const summary = useMemo(() => {
    if (!view) return null
    // "OK to mix" is not a slot of the plan: it stays out of the counts and
    // the free slots, and always has its own card after the numbered ones.
    const okToMix = view.containers.find((c) => c.isOkToMix) ?? null
    const numbered = view.containers.filter((c) => !c.isOkToMix)
    const working = numbered.filter(
      (c) => !c.isConfirmed && c.allocations.length > 0
    )
    const confirmed = numbered.filter((c) => c.isConfirmed)
    // The server keeps every slot it ever created (slots are only ever added,
    // so a plan that shrank leaves surplus empty ones — 47 slots for a week
    // that needs 40). Only as many empty slots are shown as the plan still
    // needs: totalPossibleContainers (already rounded up) minus the containers
    // that hold something. Containers with positions are never hidden, so the
    // count can exceed the need only when the client has filled more than it.
    const emptySlots = numbered.filter(
      (c) => !c.isConfirmed && c.allocations.length === 0
    )
    const free = emptySlots.slice(
      0,
      Math.max(0, view.totalPossibleContainers - working.length - confirmed.length)
    )
    const shown = new Set([...working, ...confirmed, ...free, okToMix])
    return {
      working,
      confirmed,
      free,
      okToMix,
      // Anything "Unlock all" would reopen ("OK to mix" included).
      hasLocked: view.containers.some(
        (c) => c.isConfirmed || c.isPartiallyUnlocked
      ),
      // What the client can actually work with, in the server's order.
      visibleContainers: view.containers.filter((c) => shown.has(c)),
      remainingTotal: view.unallocatedLines.reduce(
        (sum, line) => sum + line.remainingQty,
        0
      ),
    }
  }, [view])

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
  }
  if (query.isError || !view || !summary) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">
          {getErrorMessage(query.error, t("readyToShip.loadFailed"))}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    )
  }

  const filled = [...summary.working, ...summary.confirmed].sort(
    (a, b) => view.containers.indexOf(a) - view.containers.indexOf(b)
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t("readyToShip.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {isClient
              ? t("readyToShip.descriptionClient")
              : t("readyToShip.descriptionOps")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex flex-wrap items-center gap-2 text-xs"
            data-testid="ready-summary"
          >
            <Badge variant="secondary">
              {t("readyToShip.badgeLines", { n: view.unallocatedLines.length })}
            </Badge>
            <Badge variant="secondary">
              {t("readyToShip.badgeRemaining", {
                qty: formatNumber(String(summary.remainingTotal)),
              })}
            </Badge>
            <Badge variant="secondary">
              {t("readyToShip.badgeContainers", {
                n: summary.visibleContainers.length - (summary.okToMix ? 1 : 0),
              })}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isExporting}
            data-testid="export-xlsx"
            onClick={() => {
              setIsExporting(true)
              exportReadyToShipXlsx(customerId)
                .catch((error) =>
                  toast.error(getErrorMessage(error, t("readyToShip.exportFailed")))
                )
                .finally(() => setIsExporting(false))
            }}
          >
            <Download />
            {isExporting ? t("common.exporting") : t("readyToShip.exportExcel")}
          </Button>
        </div>
      </div>

      {isClient && <ActionsBar view={view} />}

      {/* Side by side only from 1400px: below that each panel is too narrow
          for the list table (it would scroll sideways), so they stack. */}
      <div className="grid gap-4 min-[1400px]:grid-cols-2 min-[1400px]:items-start">
        <Card className="min-[1400px]:sticky min-[1400px]:top-4" data-testid="ready-panel">
          <CardHeader>
            <CardTitle>{t("readyToShip.list.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReadyLinesTable
              lines={view.unallocatedLines}
              canMove={isClient}
              onMove={setMoveLine}
              toolbar={
                isClient &&
                summary.okToMix && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={view.unallocatedLines.length === 0 || moveRemaining.isPending}
                    data-testid="move-remaining-to-mix"
                    onClick={() => setConfirmMoveRemaining(true)}
                  >
                    <PackageOpen />
                    {t("readyToShip.list.moveRemaining")}
                  </Button>
                )
              }
            />
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3" data-testid="containers-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium">
              {t("readyToShip.containers.title")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("readyToShip.containers.counts", {
                  working: summary.working.length,
                  confirmed: summary.confirmed.length,
                  free: summary.free.length,
                })}
              </span>
              {!isClient && (
                // Next to the per-container "Unlock" on the cards: the same
                // thing for every container that has a locked line.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!summary.hasLocked || unlockAll.isPending}
                  data-testid="unlock-all"
                  onClick={() => setConfirmUnlockAll(true)}
                >
                  <LockOpen /> {t("readyToShip.unlockAll.button")}
                </Button>
              )}
            </div>
          </div>

          {filled.length === 0 && !summary.okToMix?.allocations.length && (
            <p className="text-sm text-muted-foreground">
              {isClient
                ? t("readyToShip.containers.emptyClient")
                : t("readyToShip.containers.emptyOps")}
            </p>
          )}

          {filled.map((container) => (
            <ContainerCard
              key={container.id}
              container={container}
              mode={mode}
              onRemove={setRemoveTarget}
              onUnlock={setUnlockTarget}
              onUnlockAllocation={setUnlockAllocationTarget}
            />
          ))}

          {summary.okToMix && (
            <ContainerCard
              key={summary.okToMix.id}
              container={summary.okToMix}
              mode={mode}
              onRemove={setRemoveTarget}
              onUnlock={setUnlockTarget}
              onUnlockAllocation={setUnlockAllocationTarget}
            />
          )}

          {summary.free.length > 0 && (
            <Card size="sm" data-testid="free-slots">
              <CardHeader>
                <CardTitle className="text-sm">
                  {t("readyToShip.containers.freeSlots", { n: summary.free.length })}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {summary.free.map((container) => (
                  <Badge key={container.id} variant="outline">
                    {containerTitle(container)}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      {isClient && (
        <>
          <MoveDialog
            line={moveLine}
            containers={summary.visibleContainers}
            preferredContainerId={lastContainerId}
            customerId={customerId}
            onClose={() => setMoveLine(null)}
            onMoved={setLastContainerId}
          />
          <RemoveDialog
            target={removeTarget}
            customerId={customerId}
            onClose={() => setRemoveTarget(null)}
          />
          <ConfirmDialog
            open={confirmMoveRemaining}
            onOpenChange={setConfirmMoveRemaining}
            title={t("readyToShip.list.moveRemainingTitle")}
            description={t("readyToShip.list.moveRemainingDescription", {
              lines: view.unallocatedLines.length,
              qty: formatNumber(String(summary.remainingTotal)),
            })}
            confirmLabel={t("readyToShip.list.moveRemainingConfirm")}
            isPending={moveRemaining.isPending}
            onConfirm={() =>
              moveRemaining.mutate(undefined, {
                onSuccess: () => {
                  toast.success(t("readyToShip.list.moveRemainingDone"))
                  setConfirmMoveRemaining(false)
                },
                onError: (error) => {
                  toast.error(
                    getErrorMessage(error, t("readyToShip.list.moveRemainingFailed"))
                  )
                  setConfirmMoveRemaining(false)
                },
              })
            }
          />
        </>
      )}

      {!isClient && (
        <ConfirmDialog
          open={unlockTarget !== null}
          onOpenChange={(open) => {
            if (!open) setUnlockTarget(null)
          }}
          title={t("readyToShip.unlock.title", {
            label: unlockTarget ? containerTitle(unlockTarget) : "",
          })}
          description={t("readyToShip.unlock.description")}
          confirmLabel={t("readyToShip.unlock.confirm")}
          destructive
          isPending={unlock.isPending}
          onConfirm={() => {
            if (!unlockTarget) return
            unlock.mutate(unlockTarget.id, {
              onSuccess: () => {
                toast.success(
                  t("readyToShip.unlock.done", {
                    label: containerTitle(unlockTarget),
                  })
                )
                setUnlockTarget(null)
              },
              onError: (error) => {
                toast.error(
                  getErrorMessage(error, t("readyToShip.unlock.failed"))
                )
                setUnlockTarget(null)
              },
            })
          }}
        />
      )}

      {!isClient && (
        <ConfirmDialog
          open={confirmUnlockAll}
          onOpenChange={setConfirmUnlockAll}
          title={t("readyToShip.unlockAll.title")}
          description={t("readyToShip.unlockAll.description")}
          confirmLabel={t("readyToShip.unlockAll.confirm")}
          destructive
          isPending={unlockAll.isPending}
          onConfirm={() =>
            unlockAll.mutate(undefined, {
              onSuccess: (result) => {
                if (result.containersUnlocked === 0) {
                  toast.info(t("readyToShip.unlockAll.nothing"))
                } else {
                  toast.success(
                    t("readyToShip.unlockAll.done", {
                      containers: result.containersUnlocked,
                      positions: result.positionsUnlocked,
                    })
                  )
                }
                setConfirmUnlockAll(false)
              },
              onError: (error) => {
                toast.error(getErrorMessage(error, t("readyToShip.unlockAll.failed")))
                setConfirmUnlockAll(false)
              },
            })
          }
        />
      )}

      {!isClient && (
        <ConfirmDialog
          open={unlockAllocationTarget !== null}
          onOpenChange={(open) => {
            if (!open) setUnlockAllocationTarget(null)
          }}
          title={t("readyToShip.unlockLine.title", {
            material: unlockAllocationTarget?.allocation.materialNum ?? "—",
            container: unlockAllocationTarget
              ? containerName(unlockAllocationTarget.containerLabel)
              : "",
          })}
          description={t("readyToShip.unlockLine.description")}
          confirmLabel={t("readyToShip.unlockLine.confirm")}
          destructive
          isPending={unlockAllocation.isPending}
          onConfirm={() => {
            if (!unlockAllocationTarget) return
            unlockAllocation.mutate(unlockAllocationTarget.allocation.id, {
              onSuccess: () => {
                toast.success(
                  t("readyToShip.unlockLine.done", {
                    material: unlockAllocationTarget.allocation.materialNum ?? "—",
                  })
                )
                setUnlockAllocationTarget(null)
              },
              onError: (error) => {
                toast.error(
                  getErrorMessage(error, t("readyToShip.unlockLine.failed"))
                )
                setUnlockAllocationTarget(null)
              },
            })
          }}
        />
      )}
    </div>
  )
}
