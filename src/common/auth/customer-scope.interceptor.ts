import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Role } from "../enums/role.enum";
import { apiError } from "../errors/api-error";
import { getByPath } from "../utils/get-by-path";
import { SCOPE_BY_CUSTOMER_KEY } from "./scope-by-customer.decorator";
import { RequestUser } from "./request-user.interface";

/**
 * For controllers annotated with @ScopeByCustomer(path), restricts the client
 * role to rows belonging to their own customer_id. Filters list responses and
 * 404s on a detail response that belongs to another customer, instead of
 * repeating this check in every service method.
 *
 * v2 note: with the PI-card model, every client-visible entity has a direct
 * or single-hop path to customer_id (ProformaInvoice.customer.id), so this
 * is now the only scoping mechanism in the app — kept as a declarative
 * decorator rather than hand-checked per pilot's single-client scale, in
 * case a second client is onboarded later.
 */
@Injectable()
export class CustomerScopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    const path = this.reflector.getAllAndOverride<string>(
      SCOPE_BY_CUSTOMER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!user || user.role !== Role.CLIENT || !path) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (Array.isArray(data)) {
          return data.filter(
            (item) => getByPath(item, path) === user.customerId,
          );
        }
        if (data && typeof data === "object") {
          if (getByPath(data, path) !== user.customerId) {
            throw new NotFoundException(apiError("NOT_FOUND", "Not Found"));
          }
        }
        return data;
      }),
    );
  }
}
