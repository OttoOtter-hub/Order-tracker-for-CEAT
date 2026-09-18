import type { UnallocatedLine } from "@/api/readyToShip"

export const NOT_PLACEABLE_HINT =
  "Нельзя разместить: у строки не задана loadability, поэтому её заполнение контейнера не посчитать"

// The backend rejects a move for a line with no usable loadability (its fill
// can't be computed), so the UI never offers one: the row is marked and its
// button disabled instead of letting the client hit the error in the dialog.
export function isPlaceable(line: UnallocatedLine): boolean {
  return line.loadability !== null && line.loadability > 0
}

// "1 файл", "2 файла", "5 файлов", "11 файлов", "21 файл"
export function pluralFiles(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} файл`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} файла`
  return `${n} файлов`
}
