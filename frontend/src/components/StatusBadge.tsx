import { Badge } from "@/components/ui/badge"
import { statusStyle, type StatusStyle } from "@/lib/statusStyles"
import { cn } from "@/lib/utils"

interface StatusBadgeProps {
  status: string
  map: Record<string, StatusStyle>
  className?: string
}

export function StatusBadge({ status, map, className }: StatusBadgeProps) {
  const style = statusStyle(map, status)
  return (
    <Badge variant="outline" className={cn("border-transparent", style.className, className)}>
      {style.label}
    </Badge>
  )
}
