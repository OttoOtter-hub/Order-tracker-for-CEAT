import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";

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
  @IsInt({ message: "количество указывается в целых штуках" })
  @Min(1, { message: "количество должно быть больше нуля" })
  qty: number;
}
