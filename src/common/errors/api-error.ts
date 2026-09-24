/**
 * Every error the API sends back has one shape (see ApiExceptionFilter):
 *
 *   { statusCode, code, message, params? }
 *
 * `code` is a stable identifier the frontend translates (errors.<CODE> in its
 * en/ru dictionaries), `params` fills that text's {{placeholders}}, and
 * `message` is the server's own wording — shown as-is only when the frontend
 * has no translation for the code. Throw sites keep their exception class
 * (and therefore their HTTP status) and just pass an apiError(...) body:
 *
 *   throw new BadRequestException(
 *     apiError("MOVE_EXCEEDS_REMAINING", `нельзя переместить …`, { qty, remaining }),
 *   );
 *
 * One code per distinct meaning — two throw sites that tell the user the
 * same thing share a code.
 */
export const ERROR_CODES = [
  // No code was set at the throw site (or not an HttpException at all). The
  // frontend deliberately has no translation for it and shows `message`.
  "UNKNOWN_ERROR",
  // ValidationPipe rejected the request body/query (class-validator).
  "VALIDATION_FAILED",

  // --- Authentication / access ---
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  // A client-only action attempted by ops (or anyone else).
  "CLIENT_ONLY_ACTION",
  // An ops-only action or resource attempted by a client.
  "OPS_ONLY_ACTION",
  // A client calling a write endpoint that isn't open to clients.
  "CLIENT_READ_ONLY",
  "USER_NOT_LINKED_TO_CUSTOMER",

  // --- Not found ---
  // Missing, or not visible to this user — ownership checks answer 404 on
  // purpose so a client can't probe other customers' ids.
  "NOT_FOUND",
  "NO_CUSTOMER_EXISTS",
  "NO_MARKING_FILE",
  "NOTHING_TO_UNDO",

  // --- Input ---
  "FILE_REQUIRED",
  "QTY_NOT_POSITIVE_INTEGER",
  "PRIORITY_QTY_NOT_INTEGER",
  "PRIORITY_QTY_OUT_OF_RANGE",
  "PI_LABEL_NOT_STRING",
  "PI_LABEL_TOO_LONG",
  "INVALID_DATE",
  "DATE_OVERRIDE_EMPTY",
  "CUSTOMER_ID_REQUIRED",
  "PI_NUMBER_NOT_IN_FILENAME",

  // --- Proforma invoices ---
  "PI_ALREADY_EXISTS",
  "REPLACEMENT_ALREADY_PENDING",
  "NO_PENDING_REPLACEMENT",
  "PI_LABEL_LOCKED_AFTER_SIGNING",

  // --- Ready to ship ---
  "LINE_NOT_READY_TO_SHIP",
  "LINE_NO_LOADABILITY",
  "MOVE_EXCEEDS_REMAINING",
  "REMOVE_EXCEEDS_ALLOCATED",
  "ALLOCATION_LOCKED",
  "CONTAINER_LOCKED",
  "NOTHING_TO_CONFIRM",
  "CONTAINER_OVERFILLED",
  "CONTAINER_NOT_LOCKED",
  "ALLOCATION_NOT_LOCKED",
  "UNDO_REMOVE_CONFLICT",
  "NOTHING_TO_MOVE",
  "MARKING_REQUIRES_LOCKED_ALLOCATION",

  // --- Shipped containers ---
  "ARRIVAL_ALREADY_CONFIRMED",
  "ARRIVAL_NOT_CONFIRMED",

  // --- Users ---
  "ACCOUNT_DEACTIVATED",
  "EMAIL_TAKEN",
  "CUSTOMER_REQUIRED_FOR_CLIENT",
  "CANNOT_DEACTIVATE_SELF",
  "WRONG_CURRENT_PASSWORD",
  "PASSWORD_TOO_SHORT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorParams = Record<string, string | number>;

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  params?: ErrorParams;
}

export function apiError(
  code: ErrorCode,
  message: string,
  params?: ErrorParams,
): ApiErrorBody {
  return params ? { code, message, params } : { code, message };
}

export interface ErrorContext {
  code: ErrorCode;
  params?: ErrorParams;
}

/**
 * The same code for a class-validator rule in a DTO, passed as the
 * decorator's `context`; validationExceptionFactory picks it up:
 *
 *   @IsInt({ message: "…", context: errorContext("QTY_NOT_POSITIVE_INTEGER") })
 */
export function errorContext(
  code: ErrorCode,
  params?: ErrorParams,
): ErrorContext {
  return params ? { code, params } : { code };
}
