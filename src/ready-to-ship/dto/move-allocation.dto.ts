import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

export class MoveAllocationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  piLineItemId: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  containerId: string;

  @ApiProperty({
    minimum: 1,
    description: "Whole units to move into the container",
  })
  @IsInt({
    message: "количество указывается в целых штуках",
    context: errorContext("QTY_NOT_POSITIVE_INTEGER"),
  })
  @Min(1, {
    message: "количество должно быть больше нуля",
    context: errorContext("QTY_NOT_POSITIVE_INTEGER"),
  })
  qty: number;
}
