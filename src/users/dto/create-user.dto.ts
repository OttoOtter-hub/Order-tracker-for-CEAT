import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsUUID,
  MinLength,
} from "class-validator";
import { Role } from "../../common/enums/role.enum";
import { errorContext } from "../../common/errors/api-error";

export const MIN_PASSWORD_LENGTH = 8;

export class CreateUserDto {
  @ApiProperty({ example: "buyer@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @MinLength(MIN_PASSWORD_LENGTH, {
    context: errorContext("PASSWORD_TOO_SHORT", { min: MIN_PASSWORD_LENGTH }),
  })
  password: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Required for role=client, ignored for role=ops",
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    default: false,
    description: "Make the new user an admin — ops only (400 for a client)",
  })
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}
