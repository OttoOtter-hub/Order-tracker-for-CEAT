import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ValidationError } from "class-validator";
import {
  ERROR_CODES,
  ErrorCode,
  ErrorContext,
  ErrorParams,
  apiError,
} from "./api-error";

export interface ApiErrorResponse {
  statusCode: number;
  code: ErrorCode;
  message: string;
  params?: ErrorParams;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}

function isParams(value: unknown): value is ErrorParams {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (v) => typeof v === "string" || typeof v === "number",
    )
  );
}

// Nest's own bodies carry `message` as a string, or a string[] for
// class-validator failures that didn't go through our exceptionFactory.
function messageOf(response: unknown, fallback: string): string {
  if (typeof response === "string") {
    return response;
  }
  if (response && typeof response === "object" && "message" in response) {
    const message = (response as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
    if (Array.isArray(message) && message.every((m) => typeof m === "string")) {
      return message.join("; ");
    }
  }
  return fallback;
}

/**
 * Maps anything thrown out of a request into the one API error shape. An
 * HttpException keeps its status and — if its body came from apiError() —
 * its code and params; anything else becomes UNKNOWN_ERROR. Unhandled
 * (non-HTTP) errors answer 500 with Nest's generic text, never the error's
 * own message: that can hold SQL, file paths or other internals.
 */
export function toApiErrorResponse(exception: unknown): ApiErrorResponse {
  if (!(exception instanceof HttpException)) {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "UNKNOWN_ERROR",
      message: "Internal server error",
    };
  }

  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  const message = messageOf(response, exception.message);
  const body =
    response && typeof response === "object"
      ? (response as { code?: unknown; params?: unknown })
      : {};

  const result: ApiErrorResponse = {
    statusCode,
    code: isErrorCode(body.code) ? body.code : "UNKNOWN_ERROR",
    message,
  };
  if (isParams(body.params)) {
    result.params = body.params;
  }
  return result;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiExceptionFilter");

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse();
    const body = toApiErrorResponse(exception);

    if (body.statusCode >= 500) {
      // Nest's built-in filter logs these; replacing it mustn't make
      // unexpected failures silent in journalctl.
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // A file download that fails mid-stream has already sent its status and
    // headers — there's no JSON body left to send, only a connection to end.
    if (httpAdapter.isHeadersSent(response)) {
      httpAdapter.end(response);
      return;
    }
    httpAdapter.reply(response, body, body.statusCode);
  }
}

interface FailedConstraint {
  message: string;
  context?: unknown;
}

function flattenValidationErrors(
  errors: ValidationError[],
): FailedConstraint[] {
  return errors.flatMap((error) => [
    ...Object.entries(error.constraints ?? {}).map(([name, message]) => ({
      message,
      context: error.contexts?.[name],
    })),
    ...flattenValidationErrors(error.children ?? []),
  ]);
}

function isErrorContext(value: unknown): value is ErrorContext {
  return (
    !!value &&
    typeof value === "object" &&
    isErrorCode((value as { code?: unknown }).code)
  );
}

/**
 * ValidationPipe's exceptionFactory: same 400 as before, but with a code.
 * The first failed rule that names its own code (errorContext() in the DTO)
 * decides it; otherwise VALIDATION_FAILED, with class-validator's own texts
 * (English, field-level) as `details`, so the translated message can still
 * say what was wrong. `message` always lists every failure, as before.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const failed = flattenValidationErrors(errors);
  const details = failed.map((f) => f.message).join("; ");
  const message = details || "Validation failed";
  const coded = failed.find((f) => isErrorContext(f.context))?.context as
    ErrorContext | undefined;
  return new BadRequestException(
    coded
      ? apiError(coded.code, message, coded.params)
      : apiError("VALIDATION_FAILED", message, { details }),
  );
}
