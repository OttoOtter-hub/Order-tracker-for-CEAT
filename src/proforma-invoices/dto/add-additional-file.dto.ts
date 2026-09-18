import { IsOptional, IsString } from "class-validator";

export class AddAdditionalFileDto {
  @IsOptional()
  @IsString()
  description?: string;
}
