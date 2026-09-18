import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { SortDirection } from "@/hooks/useTableSort"

interface SortableHeadProps {
  active: boolean
  direction: SortDirection
  onClick: () => void
  className?: string
  children: React.ReactNode
}

export function SortableHead({
  active,
  direction,
  onClick,
  className,
  children,
}: SortableHeadProps) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center gap-1 text-left font-medium text-foreground hover:text-foreground/80"
        )}
      >
        {children}
        <Icon className={cn("size-3.5", active ? "opacity-100" : "opacity-40")} />
      </button>
    </TableHead>
  )
}
