// Theme engine is next-themes (already a dependency — see
// components/ui/sonner.tsx, which already expected a ThemeProvider to exist)
// mounted in main.tsx with attribute="class" and this storage key. This
// module just centralizes the pieces the rest of the app needs to reference
// (the key, and the three theme names) without importing next-themes
// directly everywhere — same shape as i18n/index.ts's LANGUAGES/setLanguage.
export const THEME_STORAGE_KEY = "ui-theme"

export const THEMES = ["light", "dark", "system"] as const
export type Theme = (typeof THEMES)[number]

export function isTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}
