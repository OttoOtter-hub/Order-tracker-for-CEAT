import { ApiProperty } from "@nestjs/swagger";

/**
 * Response shape for POST /backorder-uploads specifically — richer than
 * the persisted BackorderUpload row (adds cardsUpdated, computed on the
 * fly, not stored) and deliberately omits `uploadedBy` (the frontend
 * already knows who's uploading; no need to round-trip a User relation
 * through this one-off response). GET /backorder-uploads (the audit list)
 * still returns full BackorderUpload entities, unaffected.
 */
export class ActualContainersUploadSummaryDto {
  @ApiProperty({ description: "Containers first seen in this file (ETD-ETA)" })
  containersCreated: number;

  @ApiProperty({
    description:
      "Containers of ETD-ETA that already existed — their file-sourced fields were overwritten, override dates untouched",
  })
  containersUpdated: number;

  @ApiProperty({
    description:
      "Containers that appear in Dispatch but in no ETD-ETA row, ever — created with only a container number (no port/vessel/dates)",
  })
  containersWithoutTransportData: number;

  @ApiProperty({ description: "ETA-15 rows applied to a known container" })
  eta15Updated: number;

  @ApiProperty({
    description: "ETA-15 rows whose container is not known at all — skipped",
  })
  eta15Unmatched: number;

  @ApiProperty({
    description:
      "Containers whose dispatch lines were replaced (Radial + Bias combined)",
  })
  containersReplaced: number;

  @ApiProperty({ description: "Dispatch lines written in this upload" })
  dispatchLinesStored: number;

  @ApiProperty({
    description:
      "Dispatch rows with a container or material but no usable container id / quantity — dropped",
  })
  dispatchRowsSkipped: number;

  @ApiProperty({
    description: "PI cards whose shipped_qty changed in the full recompute",
  })
  cardsShippedQtyChanged: number;
}

export class BackorderUploadResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  uploadedAt: Date;

  @ApiProperty()
  fileName: string;

  @ApiProperty({ description: "Valid data rows read from Radial BO + Bias BO" })
  rowsProcessed: number;

  @ApiProperty({
    description: "PI numbers with no existing card, so a new one was created",
  })
  newCardsCreated: number;

  @ApiProperty({
    description:
      "PI numbers that already had a card — its line items were refreshed and its aggregates recomputed",
  })
  cardsUpdated: number;

  @ApiProperty({
    description:
      "Cards not present in this upload's snapshot (and not already archived) — presumed fully shipped, flagged is_archived_shipped=true. A card that reappears in a later upload is un-archived automatically.",
  })
  cardsArchived: number;

  @ApiProperty({
    description:
      "Rows with a material number but no readable PI number (Quotation cell) — couldn't be attributed to any card, so dropped. Distinct from ordinary blank padding rows, which aren't counted.",
  })
  cardsSkippedInvalidRows: number;

  @ApiProperty({
    description:
      "Raw rows of every sheet archived in BackorderUploadSnapshot for this upload",
  })
  snapshotRows: number;

  @ApiProperty({ type: ActualContainersUploadSummaryDto })
  actualContainers: ActualContainersUploadSummaryDto;
}
