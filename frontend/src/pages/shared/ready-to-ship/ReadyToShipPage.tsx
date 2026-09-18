import { useMemo, useState } from "react"
import { toast } from "sonner"
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
  useReadyToShipQuery,
  useUnlockContainerMutation,
  type ShippingContainer,
  type UnallocatedLine,
} from "@/api/readyToShip"
import { ActionsBar } from "@/pages/shared/ready-to-ship/ActionsBar"
import {
  ContainerCard,
  type ReadyToShipMode,
} from "@/pages/shared/ready-to-ship/ContainerCard"
import { MoveDialog } from "@/pages/shared/ready-to-ship/MoveDialog"
import {
  RemoveDialog,
  type RemoveTarget,
} from "@/pages/shared/ready-to-ship/RemoveDialog"
import { ReadyLinesTable } from "@/pages/shared/ready-to-ship/ReadyLinesTable"
import { formatNumber } from "@/lib/format"
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
  const { data: customers, isLoading } = useCustomersQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const customerId = selectedId ?? customers?.[0]?.id

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка...</p>
  }
  if (!customerId) {
    return <p className="text-sm text-muted-foreground">Нет клиентов.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {customers && customers.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Клиент:</span>
          <Select value={customerId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-64" aria-label="Клиент">
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
  const isClient = mode === "client"
  const query = useReadyToShipQuery(customerId)
  const unlock = useUnlockContainerMutation()

  const [moveLine, setMoveLine] = useState<UnallocatedLine | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<ShippingContainer | null>(null)
  const [lastContainerId, setLastContainerId] = useState<string | null>(null)

  const view = query.data

  const summary = useMemo(() => {
    if (!view) return null
    const working = view.containers.filter(
      (c) => !c.isConfirmed && c.allocations.length > 0
    )
    const confirmed = view.containers.filter((c) => c.isConfirmed)
    const free = view.containers.filter(
      (c) => !c.isConfirmed && c.allocations.length === 0
    )
    return {
      working,
      confirmed,
      free,
      remainingTotal: view.unallocatedLines.reduce(
        (sum, line) => sum + line.remainingQty,
        0
      ),
    }
  }, [view])

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка...</p>
  }
  if (query.isError || !view || !summary) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">
          {getErrorMessage(query.error, "Не удалось загрузить раздел")}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Повторить
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
          <h1 className="text-xl font-semibold">Готово к отгрузке</h1>
          <p className="text-sm text-muted-foreground">
            {isClient
              ? "Разложите план недели по контейнерам, подтвердите и приложите маркировку."
              : "Состояние плана клиента (только просмотр). Подтверждённый контейнер можно разблокировать."}
          </p>
        </div>
        <div
          className="flex flex-wrap items-center gap-2 text-xs"
          data-testid="ready-summary"
        >
          <Badge variant="secondary">
            Строк к распределению: {view.unallocatedLines.length}
          </Badge>
          <Badge variant="secondary">
            Остаток: {formatNumber(String(summary.remainingTotal))} шт.
          </Badge>
          <Badge variant="secondary">
            Контейнеров: {view.containers.length} (нужно ≥{" "}
            {view.totalPossibleContainers})
          </Badge>
        </div>
      </div>

      {isClient && <ActionsBar view={view} />}

      {/* Side by side only from 1400px: below that each panel is too narrow
          for the list table (it would scroll sideways), so they stack. */}
      <div className="grid gap-4 min-[1400px]:grid-cols-2 min-[1400px]:items-start">
        <Card className="min-[1400px]:sticky min-[1400px]:top-4" data-testid="ready-panel">
          <CardHeader>
            <CardTitle>Список готового</CardTitle>
          </CardHeader>
          <CardContent>
            <ReadyLinesTable
              lines={view.unallocatedLines}
              canMove={isClient}
              onMove={setMoveLine}
            />
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3" data-testid="containers-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium">Контейнеры</h2>
            <span className="text-xs text-muted-foreground">
              в работе {summary.working.length} · подтверждено{" "}
              {summary.confirmed.length} · свободно {summary.free.length}
            </span>
          </div>

          {filled.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Пока ничего не размещено{isClient ? ": используйте «Переместить» в списке слева." : "."}
            </p>
          )}

          {filled.map((container) => (
            <ContainerCard
              key={container.id}
              container={container}
              mode={mode}
              onRemove={setRemoveTarget}
              onUnlock={setUnlockTarget}
            />
          ))}

          {summary.free.length > 0 && (
            <Card size="sm" data-testid="free-slots">
              <CardHeader>
                <CardTitle className="text-sm">
                  Свободные слоты ({summary.free.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {summary.free.map((container) => (
                  <Badge key={container.id} variant="outline">
                    {container.label}
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
            containers={view.containers}
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
        </>
      )}

      {!isClient && (
        <ConfirmDialog
          open={unlockTarget !== null}
          onOpenChange={(open) => {
            if (!open) setUnlockTarget(null)
          }}
          title={`Разблокировать «${unlockTarget?.label ?? ""}»?`}
          description="После разблокировки клиент сможет менять состав этого контейнера, файлы маркировки на изменённых строках будут удалены."
          confirmLabel="Разблокировать"
          destructive
          isPending={unlock.isPending}
          onConfirm={() => {
            if (!unlockTarget) return
            unlock.mutate(unlockTarget.id, {
              onSuccess: () => {
                toast.success(`«${unlockTarget.label}» разблокирован`)
                setUnlockTarget(null)
              },
              onError: (error) => {
                toast.error(getErrorMessage(error, "Не удалось разблокировать"))
                setUnlockTarget(null)
              },
            })
          }}
        />
      )}
    </div>
  )
}
