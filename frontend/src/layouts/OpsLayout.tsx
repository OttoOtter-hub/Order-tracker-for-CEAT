import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { FileText, LogOut, Ship, Truck, Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/auth/AuthContext"

const NAV_ITEMS = [
  { to: "/ops/pi", label: "PI", icon: FileText },
  { to: "/ops/ready-to-ship", label: "Готово к отгрузке", icon: Truck },
  { to: "/ops/actual-containers", label: "Готовые контейнеры", icon: Ship },
  { to: "/ops/backorder-upload", label: "Загрузка бэкордера", icon: Upload },
]

export function OpsLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/30">
        <div className="px-4 py-4">
          <p className="text-sm font-semibold">CEAT · Ops</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  isActive && "bg-muted font-medium text-foreground"
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
          >
            <LogOut className="size-4" />
            Выйти
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
