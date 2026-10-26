import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";
import { errorContext } from "../../common/errors/api-error";
import { REJECTION_COMMENT_MAX_LENGTH } from "../load-list.service";

/** POST /ready-to-ship/load-list/reject — the comment the client will see. */
export class RejectLoadListDto {
  @ApiProperty({ maxLength: REJECTION_COMMENT_MAX_LENGTH })
  @MaxLength(REJECTION_COMMENT_MAX_LENGTH, {
    context: errorContext("REJECTION_COMMENT_TOO_LONG", {
      max: REJECTION_COMMENT_MAX_LENGTH,
    }),
  })
  @IsString({ context: errorContext("REJECTION_COMMENT_REQUIRED") })
  comment: string;
}
