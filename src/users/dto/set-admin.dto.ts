import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class SetAdminDto {
  @ApiProperty({ description: "true to grant admin, false to revoke it" })
  @IsBoolean()
  isAdmin: boolean;
}
