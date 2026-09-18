import { formatDateForFilename } from "../../common/utils/format-date";

/**
 * "MTK ROSBERG INR.xlsx" + 2026-09-03 -> "MTK ROSBERG INR_2026-09-03.xlsx".
 * CEAT's own export always carries the same filename week to week, so the
 * stored copy's *original name* (StoredFile.original_name — the physical
 * on-disk file stays UUID-named regardless, see FilesService) needs this
 * stamp to stay distinguishable upload to upload.
 */
export function stampDateOnFilename(originalName: string, date: Date): string {
  const dateStr = formatDateForFilename(date);
  const dotIndex = originalName.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `${originalName}_${dateStr}`;
  }
  return `${originalName.slice(0, dotIndex)}_${dateStr}${originalName.slice(dotIndex)}`;
}
