/**
 * Line items have no id that survives a backorder re-upload (they're
 * deleted and recreated wholesale), so "the same line week to week" is
 * (materialNum, soNumber). A single space joins the two into one map key;
 * it's only ever used to look itself back up, never parsed apart.
 */
export function lineItemKey(
  materialNum: string | null,
  soNumber: string | null,
): string {
  return `${materialNum ?? ""} ${soNumber ?? ""}`;
}
