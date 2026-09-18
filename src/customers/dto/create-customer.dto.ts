import { IsEnum, IsOptional, IsString } from "class-validator";
import { PaymentTerms } from "../../common/enums/payment-terms.enum";

export class CreateCustomerDto {
  @IsString()
  name: string;

  @IsString()
  customerCode: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  defaultPort?: string;

  @IsOptional()
  @IsEnum(PaymentTerms)
  defaultPaymentTerms?: PaymentTerms;
}
