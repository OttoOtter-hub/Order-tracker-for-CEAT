import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { FileText, History, LogOut, Ship, Truck, Upload, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog"
import { useAuth } from "@/auth/AuthContext"

const NAV_ITEMS = [
  { to: "/ops/pi", labelKey: "nav.pi", icon: FileText },
  { to: "/ops/ready-to-ship", labelKey: "nav.readyToShip", icon: Truck },
  { to: "/ops/actual-containers", labelKey: "nav.shipped", icon: Ship },
  { to: "/ops/backorder-upload", labelKey: "nav.backorderUpload", icon: Upload },
  // Administrators only — an ordinary ops user doesn't see these at all.
  { to: "/ops/users", labelKey: "nav.users", icon: Users, adminOnly: true },
  { to: "/ops/audit-log", labelKey: "nav.auditLog", icon: History, adminOnly: true },
]

export function OpsLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col self-start overflow-y-auto border-r bg-muted/30">
        <div className="px-4 py-4">
          <p className="text-sm font-semibold">{t("nav.opsTitle")}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          <ChangePasswordDialog />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV_ITEMS.filter((item) => !item.adminOnly || user?.isAdmin).map(
            ({ to, labelKey, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  isActive &&
                    "bg-accent font-medium text-accent-foreground shadow-[inset_3px_0_0_var(--primary)]"
                )
              }
            >
              <Icon className="size-4" />
              {t(labelKey)}
            </NavLink>
            )
          )}
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
