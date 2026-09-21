import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { LANGUAGES, setLanguage, type Language } from "@/i18n"

const LABELS: Record<Language, string> = { en: "EN", ru: "RU" }

// A two-way EN / RU switch for the side menu. The choice is persisted by
// setLanguage(), and <html lang> follows it (see i18n/index.ts).
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="inline-flex rounded-md border bg-background p-0.5 text-xs"
      data-testid="language-switcher"
    >
      {LANGUAGES.map((language) => {
        const active = i18n.language === language
        return (
          <button
            key={language}
            type="button"
            aria-pressed={active}
            data-lang={language}
            onClick={() => setLanguage(language)}
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {LABELS[language]}
          </button>
        )
      })}
    </div>
  )
}
