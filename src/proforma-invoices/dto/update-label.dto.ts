import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MaxLength, ValidateIf } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

export const PI_LABEL_MAX_LENGTH = 30;

/**
 * `label` must be present: a string of at most 30 characters, or `null` to
 * clear it. Surrounding whitespace is dropped before the length check, and an
 * empty (or all-blank) string is stored as null by the service.
 */
export class UpdateLabelDto {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: PI_LABEL_MAX_LENGTH,
    description: "Название карточки; пустая строка или null — без названия",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @ValidateIf((_object, value) => value !== null)
  @IsString({
    message: "название должно быть строкой или null",
    context: errorContext("PI_LABEL_NOT_STRING"),
  })
  @MaxLength(PI_LABEL_MAX_LENGTH, {
    message: `название — не более ${PI_LABEL_MAX_LENGTH} символов`,
    context: errorContext("PI_LABEL_TOO_LONG", { max: PI_LABEL_MAX_LENGTH }),
  })
  label: string | null;
}
