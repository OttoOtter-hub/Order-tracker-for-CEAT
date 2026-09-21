import type { UnallocatedLine } from "@/api/readyToShip"

// The backend rejects a move for a line with no usable loadability (its fill
// can't be computed), so the UI never offers one: the row is marked and its
// button disabled instead of letting the client hit the error in the dialog.
export function isPlaceable(line: UnallocatedLine): boolean {
  return line.loadability !== null && line.loadability > 0
}
