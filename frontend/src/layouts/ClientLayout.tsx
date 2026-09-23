import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { FileText, LogOut, Ship, Truck } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog"
import { useAuth } from "@/auth/AuthContext"
import { useCustomersQuery } from "@/api/customers"

const NAV_ITEMS = [
  { to: "/client/pi", labelKey: "nav.pi", icon: FileText },
  { to: "/client/ready-to-ship", labelKey: "nav.readyToShip", icon: Truck },
  { to: "/client/actual-containers", labelKey: "nav.shipped", icon: Ship },
]

export function ClientLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  // The API scopes /customers to the client's own customer, so this is the
  // company the user belongs to (matched by id anyway, not by position).
  const { data: customers } = useCustomersQuery()
  const customerName =
    customers?.find((customer) => customer.id === user?.customerId)?.name ??
    t("nav.clientFallback")

  function handleLogout() {
    logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-64 shrink-0 flex-col self-start overflow-y-auto border-r bg-muted/30">
        <div className="px-4 py-4">
          <p className="text-sm font-semibold">{customerName}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          <ChangePasswordDialog />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
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
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
          >
            <LogOut className="size-4" />
            {t("nav.logout")}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
