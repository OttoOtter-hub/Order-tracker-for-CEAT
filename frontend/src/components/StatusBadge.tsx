import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { statusStyle, type StatusStyle } from "@/lib/statusStyles"
import { cn } from "@/lib/utils"

interface StatusBadgeProps {
  status: string
  map: Record<string, StatusStyle>
  className?: string
}

export function StatusBadge({ status, map, className }: StatusBadgeProps) {
  const { t } = useTranslation()
  const style = statusStyle(map, status)
  return (
    <Badge variant="outline" className={cn("border-transparent", style.className, className)}>
      {style.labelKey ? t(style.labelKey) : status}
    </Badge>
  )
}
