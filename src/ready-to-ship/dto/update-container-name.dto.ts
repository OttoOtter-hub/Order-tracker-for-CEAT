import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MaxLength, ValidateIf } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

export const CONTAINER_NAME_MAX_LENGTH = 30;

/**
 * Same contract as the PI card's name (UpdateLabelDto): `name` must be
 * present — a string of at most 30 characters, or `null` to clear it.
 * Surrounding whitespace is dropped before the length check, and an empty
 * (or all-blank) string is stored as null by the service.
 */
export class UpdateContainerNameDto {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: CONTAINER_NAME_MAX_LENGTH,
    description: "Название контейнера; пустая строка или null — без названия",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @ValidateIf((_object, value) => value !== null)
  // Decorators register bottom-up and the first coded failure becomes the
  // API code — IsString last, so a non-string reads NOT_STRING, not TOO_LONG.
  @MaxLength(CONTAINER_NAME_MAX_LENGTH, {
    message: `название — не более ${CONTAINER_NAME_MAX_LENGTH} символов`,
    context: errorContext("CONTAINER_NAME_TOO_LONG", {
      max: CONTAINER_NAME_MAX_LENGTH,
    }),
  })
  @IsString({
    message: "название должно быть строкой или null",
    context: errorContext("CONTAINER_NAME_NOT_STRING"),
  })
  name: string | null;
}
