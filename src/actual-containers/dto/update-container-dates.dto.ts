import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, Matches } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = "must be a calendar date in the form YYYY-MM-DD";
const INVALID_DATE = errorContext("INVALID_DATE");

/**
 * Each field: a date sets that override, `null` clears just that one, and
 * leaving it out keeps it as it is. (@IsOptional lets both null and
 * undefined through validation.)
 */
export class UpdateContainerDatesDto {
  @ApiPropertyOptional({ example: "2026-09-25", nullable: true })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: `overrideEtd ${DATE_MESSAGE}`,
    context: INVALID_DATE,
  })
  @IsISO8601(
    { strict: true },
    { message: `overrideEtd ${DATE_MESSAGE}`, context: INVALID_DATE },
  )
  overrideEtd?: string | null;

  @ApiPropertyOptional({ example: "2026-10-20", nullable: true })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: `overrideEta ${DATE_MESSAGE}`,
    context: INVALID_DATE,
  })
  @IsISO8601(
    { strict: true },
    { message: `overrideEta ${DATE_MESSAGE}`, context: INVALID_DATE },
  )
  overrideEta?: string | null;
}
