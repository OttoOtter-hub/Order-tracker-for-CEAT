import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

export const SEARCH_QUERY_MAX_LENGTH = 100;

/** GET /search query. */
export class SearchQueryDto {
  @ApiPropertyOptional({
    description:
      "A substring of the material number (as typed) or of its description (any case). Empty finds nothing.",
    maxLength: SEARCH_QUERY_MAX_LENGTH,
  })
  @IsOptional()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH, {
    context: errorContext("SEARCH_QUERY_TOO_LONG", {
      max: SEARCH_QUERY_MAX_LENGTH,
    }),
  })
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "ops: limit the search to this customer (every customer when omitted); a client always gets their own",
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
