import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

export class RemoveAllocationDto {
  @ApiProperty({
    format: "uuid",
    description: "Allocation row to take units out of",
  })
  @IsUUID()
  allocationId: string;

  @ApiProperty({
    minimum: 1,
    description: "Whole units to return to the unallocated list",
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
