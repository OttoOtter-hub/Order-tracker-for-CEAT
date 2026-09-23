import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";
import { errorContext } from "../../common/errors/api-error";
import { MIN_PASSWORD_LENGTH } from "../../users/dto/create-user.dto";

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    context: errorContext("PASSWORD_TOO_SHORT", { min: MIN_PASSWORD_LENGTH }),
  })
  newPassword: string;
}
