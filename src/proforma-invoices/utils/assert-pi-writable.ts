import { BadRequestException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";

/**
 * An archived card (fully shipped, or gone from the backorder) is read-only:
 * no priority, name, file or replacement changes — 400 PI_ARCHIVED_READ_ONLY.
 * Reading, downloading its files and exporting it stay open. Call it after
 * the ownership check, so another customer's card is still a plain 404.
 */
export function assertPiWritable(pi: { isArchivedShipped: boolean }): void {
  if (pi.isArchivedShipped) {
    throw new BadRequestException(
      apiError(
        "PI_ARCHIVED_READ_ONLY",
        "карточка в архиве — изменения недоступны, только просмотр и скачивание",
      ),
    );
  }
}
