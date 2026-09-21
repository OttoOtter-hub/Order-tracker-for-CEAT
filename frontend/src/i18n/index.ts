import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import ru from "./locales/ru.json"

export const LANGUAGES = ["en", "ru"] as const
export type Language = (typeof LANGUAGES)[number]

export const LANGUAGE_STORAGE_KEY = "ui-lang"
// Always English when nothing valid is stored — the browser's or system's
// language is deliberately never consulted.
export const DEFAULT_LANGUAGE: Language = "en"

function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ru"
}

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (isLanguage(stored)) {
      return stored
    }
  } catch {
    // storage blocked or unavailable — fall through to the default
  }
  return DEFAULT_LANGUAGE
}

function syncDocumentLanguage(language: string) {
  document.documentElement.lang = language
}

// Inline resources + initAsync: false make init synchronous, so the very first
// render already has its texts.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: readStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
  initAsync: false,
})

syncDocumentLanguage(i18n.language)
i18n.on("languageChanged", syncDocumentLanguage)

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE
}

export function setLanguage(language: Language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // the choice still applies for this session
  }
  void i18n.changeLanguage(language)
}

// Locale for number formatting, so English reads "1,234.5" and Russian
// "1 234,5". Dates keep their fixed dd.mm.yyyy layout (see lib/format.ts).
export function numberLocale(): string {
  return currentLanguage() === "ru" ? "ru-RU" : "en-US"
}

export default i18n
