import { readFileSync } from "fs";
import { join } from "path";
import { ERROR_CODES } from "./api-error";

// The frontend translates every error code the API can send
// (errors.<CODE> in frontend/src/i18n/locales/*.json). This keeps the two
// sides in step: a code added here without its texts — or a stale text left
// behind after a code is removed — fails the backend test run.
const LOCALES_DIR = join(__dirname, "../../../frontend/src/i18n/locales");
const LANGUAGES = ["en", "ru"] as const;

// Shown to the user as the server's message on purpose (see api-error.ts),
// so it must NOT have a translation.
const UNTRANSLATED = new Set(["UNKNOWN_ERROR"]);

function readErrors(language: string): Record<string, unknown> {
  const dictionary = JSON.parse(
    readFileSync(join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as { errors?: Record<string, unknown> };
  return dictionary.errors ?? {};
}

// "{{qty, number}}" -> "qty" (the part after the comma is an i18next format).
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort();
}

describe("error code dictionary (frontend en/ru)", () => {
  const translatedCodes = ERROR_CODES.filter((code) => !UNTRANSLATED.has(code));

  it.each(LANGUAGES)("%s has a text for every error code", (language) => {
    const errors = readErrors(language);
    const missing = translatedCodes.filter(
      (code) => typeof errors[code] !== "string" || errors[code] === "",
    );
    expect(missing).toEqual([]);
  });

  it.each(LANGUAGES)(
    "%s has no texts for unknown or untranslated codes",
    (language) => {
      const known = new Set<string>(translatedCodes);
      const extra = Object.keys(readErrors(language)).filter(
        (key) => !known.has(key),
      );
      expect(extra).toEqual([]);
    },
  );

  it("uses the same {{placeholders}} in en and ru for each code", () => {
    const en = readErrors("en");
    const ru = readErrors("ru");
    const mismatched = translatedCodes.filter(
      (code) =>
        JSON.stringify(placeholders(String(en[code] ?? ""))) !==
        JSON.stringify(placeholders(String(ru[code] ?? ""))),
    );
    expect(mismatched).toEqual([]);
  });
});
