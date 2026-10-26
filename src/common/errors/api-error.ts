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
  "ADMIN_ONLY_ACTION",
  // A client calling a write endpoint that isn't open to clients.
  "CLIENT_READ_ONLY",
  "USER_NOT_LINKED_TO_CUSTOMER",

  // --- Not found ---
  // Missing, or not visible to this user — ownership checks answer 404 on
  // purpose so a client can't probe other customers' ids.
  "NOT_FOUND",
  "NO_CUSTOMER_EXISTS",
  "NO_MARKING_FILE",
  "NO_MARKING_FILES",
  "NOTHING_TO_UNDO",

  // --- Input ---
  "FILE_REQUIRED",
  "QTY_NOT_POSITIVE_INTEGER",
  "PRIORITY_QTY_NOT_INTEGER",
  "PRIORITY_QTY_OUT_OF_RANGE",
  "PI_LABEL_NOT_STRING",
  "PI_LABEL_TOO_LONG",
  "CONTAINER_NAME_NOT_STRING",
  "CONTAINER_NAME_TOO_LONG",
  "INVALID_DATE",
  "DATE_OVERRIDE_EMPTY",
  "CUSTOMER_ID_REQUIRED",
  "PI_NUMBER_NOT_IN_FILENAME",
  "SEARCH_QUERY_TOO_LONG",

  // --- Proforma invoices ---
  "PI_ALREADY_EXISTS",
  "REPLACEMENT_ALREADY_PENDING",
  "NO_PENDING_REPLACEMENT",
  "PI_LABEL_LOCKED_AFTER_SIGNING",
  "PI_ARCHIVED_READ_ONLY",

  // --- Ready to ship ---
  "LINE_NOT_READY_TO_SHIP",
  "LINE_NO_LOADABILITY",
  "MOVE_EXCEEDS_REMAINING",
  "REMOVE_EXCEEDS_ALLOCATED",
  "ALLOCATION_LOCKED",
  "CONTAINER_LOCKED",
  "CONTAINER_EMPTY",
  "NOTHING_TO_CONFIRM",
  "CONTAINER_OVERFILLED",
  "CONTAINER_NOT_LOCKED",
  "ALLOCATION_NOT_LOCKED",
  "UNDO_REMOVE_CONFLICT",
  "UNDO_SKIPPED_ARCHIVED_PI",
  "NOTHING_TO_MOVE",
  "NOTHING_TO_ALLOCATE",
  "MANUAL_CONTAINER_LIMIT",
  "OK_TO_MIX_NAME_NOT_ALLOWED",
  "MARKING_REQUIRES_LOCKED_ALLOCATION",

  // --- Load list (Phase 25) ---
  // An edit while the load list isn't in this role's editing status.
  "LOAD_LIST_NOT_EDITABLE",
  // A status change the current status doesn't allow.
  "LOAD_LIST_WRONG_STATUS",
  // "Send"/"Submit" with no position that isn't confirmed already.
  "LOAD_LIST_EMPTY",
  "REJECTION_COMMENT_REQUIRED",
  "REJECTION_COMMENT_TOO_LONG",
  // "OK" on a client version that no longer fits the current backorder;
  // details list each mismatch.
  "LOAD_LIST_OUTDATED",
  "LOAD_LIST_NO_CLIENT_VERSION",
  // Excel import: the file as a whole, then one detail per bad row.
  "IMPORT_FILE_UNREADABLE",
  "IMPORT_INVALID",
  "IMPORT_CONFIRM_NEW_CONTAINERS",
  "IMPORT_BAD_QUANTITY",
  "IMPORT_UNKNOWN_LINE",
  "IMPORT_ARCHIVED_PI",
  "IMPORT_UNKNOWN_CONTAINER",
  "IMPORT_EXCEEDS_AVAILABLE",
  "IMPORT_CONTAINER_OVERFILLED",
  "IMPORT_NO_LOADABILITY",
  "IMPORT_CONFIRMED_CHANGED",
  "IMPORT_CONTAINER_LOCKED",
  // Mismatches behind LOAD_LIST_OUTDATED.
  "OUTDATED_LINE_GONE",
  "OUTDATED_EXCEEDS_AVAILABLE",
  "OUTDATED_CONTAINER_OVERFILLED",
  "OUTDATED_POSITION_CHANGED",

  // --- Shipped containers ---
  "ARRIVAL_ALREADY_CONFIRMED",
  "ARRIVAL_NOT_CONFIRMED",

  // --- Users ---
  "ACCOUNT_DEACTIVATED",
  "EMAIL_TAKEN",
  "CUSTOMER_REQUIRED_FOR_CLIENT",
  "CANNOT_DEACTIVATE_SELF",
  "ADMIN_REQUIRES_OPS",
  "LAST_ADMIN",
  "CANNOT_RESET_OWN_PASSWORD",
  "WRONG_CURRENT_PASSWORD",
  "PASSWORD_TOO_SHORT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorParams = Record<string, string | number>;

/**
 * One item of a list an error carries along (Phase 25): a bad row of an
 * imported file, a mismatch of a client version. Translated by the frontend
 * like the error itself (errors.<code> with params).
 */
export interface ErrorDetail {
  code: ErrorCode;
  params?: ErrorParams;
  /** The spreadsheet row it is about, when it is about one. */
  row?: number;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  params?: ErrorParams;
  details?: ErrorDetail[];
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
