import { IsBoolean } from "class-validator";

export class ReplacementDecisionDto {
  @IsBoolean()
  approved: boolean;
}
