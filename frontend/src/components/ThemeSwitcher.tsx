import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"
import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { THEMES, type Theme } from "@/theme"

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

// A three-way light / dark / system switch for the side menu, next to
// LanguageSwitcher. next-themes owns persistence and the "dark" class on
// <html> (see main.tsx) — this just renders its current `theme` and calls
// setTheme().
export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  // next-themes only knows the real stored value after mount (it can't read
  // localStorage during SSR-safe first render) — render nothing selected
  // until then rather than guessing, avoiding a flash of the wrong button
  // highlighted right after hydration.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div
      role="group"
      aria-label={t("theme.label")}
      className="inline-flex rounded-md border bg-background p-0.5 text-xs"
      data-testid="theme-switcher"
    >
      {THEMES.map((value) => {
        const Icon = ICONS[value]
        const active = mounted && theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={t(`theme.${value}`)}
            title={t(`theme.${value}`)}
            data-theme-option={value}
            onClick={() => setTheme(value)}
            className={cn(
              "rounded p-1.5 transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}
