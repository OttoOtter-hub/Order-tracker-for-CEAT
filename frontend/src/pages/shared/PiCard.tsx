import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/StatusBadge"
import { PI_STATUS } from "@/lib/statusStyles"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ProformaInvoice } from "@/api/proformaInvoices"

interface PiCardProps {
  pi: ProformaInvoice
  onClick: () => void
}

export function PiCard({ pi, onClick }: PiCardProps) {
  const soNumbers = [
    ...new Set((pi.lineItems ?? []).map((li) => li.soNumber).filter(Boolean)),
  ] as string[]

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick()
      }}
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/50",
        pi.isArchivedShipped && "opacity-60 grayscale-[50%]"
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{pi.piNumber}</CardTitle>
          <StatusBadge status={pi.status} map={PI_STATUS} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {soNumbers.length > 0 && (
          <div className="text-muted-foreground">
            SO: {soNumbers.join(", ")}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <span className="text-muted-foreground">Всего: </span>
            {formatNumber(pi.totalQty)}
          </div>
          <div>
            <span className="text-muted-foreground">Ожидает: </span>
            {formatNumber(pi.qtyPending)}
          </div>
          <div>
            <span className="text-muted-foreground">Конт. ожидает: </span>
            {formatNumber(pi.containersPending)}
          </div>
          <div>
            <span className="text-muted-foreground">План нед.: </span>
            {formatNumber(pi.currentWeekPlanContainers)} конт. /{" "}
            {formatNumber(pi.currentWeekPlanQty)} шт.
          </div>
          <div data-testid="pi-card-priority-lines">
            <span className="text-muted-foreground">Приоритетных позиций: </span>
            {pi.priorityLineItemsCount ?? 0}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
