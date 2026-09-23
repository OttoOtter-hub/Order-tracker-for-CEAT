import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  NotFoundException,
  Post,
  ValidationPipe,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { IsInt, MaxLength, Min } from "class-validator";
import { apiError, errorContext } from "./api-error";
import {
  ApiExceptionFilter,
  toApiErrorResponse,
  validationExceptionFactory,
} from "./api-exception.filter";

describe("toApiErrorResponse", () => {
  it("keeps a coded exception's status, code, message and params", () => {
    const exception = new BadRequestException(
      apiError("MOVE_EXCEEDS_REMAINING", "нельзя переместить 80", {
        qty: 80,
        remaining: 30,
      }),
    );

    expect(toApiErrorResponse(exception)).toEqual({
      statusCode: 400,
      code: "MOVE_EXCEEDS_REMAINING",
      message: "нельзя переместить 80",
      params: { qty: 80, remaining: 30 },
    });
  });

  it("leaves params out when the throw site had none", () => {
    expect(
      toApiErrorResponse(
        new NotFoundException(apiError("NOT_FOUND", "PiLineItem x not found")),
      ),
    ).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "PiLineItem x not found",
    });
  });

  it("gives an uncoded HttpException UNKNOWN_ERROR and its message as-is", () => {
    expect(
      toApiErrorResponse(
        new ForbiddenException("Client users have read-only access"),
      ),
    ).toEqual({
      statusCode: 403,
      code: "UNKNOWN_ERROR",
      message: "Client users have read-only access",
    });
    // No message at all: Nest's own default text for the status.
    expect(toApiErrorResponse(new NotFoundException())).toEqual({
      statusCode: 404,
      code: "UNKNOWN_ERROR",
      message: "Not Found",
    });
  });

  it("joins a string[] message (class-validator without our factory)", () => {
    const exception = new BadRequestException([
      "a must be an integer",
      "b is required",
    ]);

    expect(toApiErrorResponse(exception)).toMatchObject({
      code: "UNKNOWN_ERROR",
      message: "a must be an integer; b is required",
    });
  });

  it("does not trust a code that isn't in the registry", () => {
    const exception = new BadRequestException({
      code: "MADE_UP",
      message: "x",
    });

    expect(toApiErrorResponse(exception).code).toBe("UNKNOWN_ERROR");
  });

  it("turns an unhandled error into a 500 without leaking its message", () => {
    const result = toApiErrorResponse(
      new Error('relation "secret_table" does not exist'),
    );

    expect(result).toEqual({
      statusCode: 500,
      code: "UNKNOWN_ERROR",
      message: "Internal server error",
    });
  });

  it("handles a thrown non-Error value", () => {
    expect(toApiErrorResponse("boom")).toMatchObject({
      statusCode: 500,
      code: "UNKNOWN_ERROR",
    });
  });
});

class QtyDto {
  @IsInt()
  @Min(1)
  qty!: number;
}

class CodedDto {
  @IsInt({ context: errorContext("QTY_NOT_POSITIVE_INTEGER") })
  qty!: number;

  @MaxLength(3, {
    message: "label too long",
    context: errorContext("PI_LABEL_TOO_LONG", { max: 3 }),
  })
  label!: string;
}

@Controller("probe")
class ProbeController {
  @Get("coded")
  coded() {
    throw new BadRequestException(
      apiError("MOVE_EXCEEDS_REMAINING", "нельзя переместить 80", {
        qty: 80,
        remaining: 30,
      }),
    );
  }

  @Get("plain")
  plain() {
    throw new BadRequestException("customerId обязателен");
  }

  @Get("crash")
  crash() {
    throw new Error("db exploded");
  }

  @Get("async-crash")
  async asyncCrash() {
    await Promise.resolve();
    throw new TypeError("cannot read properties of undefined");
  }

  @Post("validated")
  validated(@Body() dto: QtyDto) {
    return dto;
  }

  @Post("coded-validated")
  codedValidated(@Body() dto: CodedDto) {
    return dto;
  }
}

// The whole path a real request takes: route -> ValidationPipe (with our
// exceptionFactory, as in main.ts) -> handler -> APP_FILTER -> HTTP body.
describe("ApiExceptionFilter over HTTP", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }).compile();
    // logger: false keeps the filter's deliberate 500 logging out of the
    // test output.
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(
      `${baseUrl.replace("[::1]", "localhost")}${path}`,
      init,
    );
    return { status: response.status, body: await response.json() };
  }

  it("sends a handled, coded error with its code and params", async () => {
    expect(await call("/probe/coded")).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        code: "MOVE_EXCEEDS_REMAINING",
        message: "нельзя переместить 80",
        params: { qty: 80, remaining: 30 },
      },
    });
  });

  it("sends a handled, uncoded error as UNKNOWN_ERROR with its message", async () => {
    expect(await call("/probe/plain")).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        code: "UNKNOWN_ERROR",
        message: "customerId обязателен",
      },
    });
  });

  it.each(["/probe/crash", "/probe/async-crash"])(
    "wraps an unhandled error (%s) as a 500 UNKNOWN_ERROR",
    async (path) => {
      expect(await call(path)).toEqual({
        status: 500,
        body: {
          statusCode: 500,
          code: "UNKNOWN_ERROR",
          message: "Internal server error",
        },
      });
    },
  );

  it("gives ValidationPipe failures VALIDATION_FAILED with the details", async () => {
    const { status, body } = await call("/probe/validated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty: 0 }),
    });

    expect(status).toBe(400);
    expect(body).toEqual({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "qty must not be less than 1",
      params: { details: "qty must not be less than 1" },
    });
  });

  it("takes the code and params from a DTO rule's errorContext", async () => {
    const post = (payload: object) =>
      call("/probe/coded-validated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    expect(await post({ qty: 1, label: "abcd" })).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        code: "PI_LABEL_TOO_LONG",
        message: "label too long",
        params: { max: 3 },
      },
    });
    // Two failing rules: the first coded one decides, message lists both.
    const both = await post({ qty: 1.5, label: "abcd" });
    expect(both.body).toMatchObject({
      code: "QTY_NOT_POSITIVE_INTEGER",
      message: "qty must be an integer number; label too long",
    });
    expect(both.body.params).toBeUndefined();
  });

  it("formats Nest's own unknown-route 404 too", async () => {
    expect(await call("/no-such-route")).toEqual({
      status: 404,
      body: {
        statusCode: 404,
        code: "UNKNOWN_ERROR",
        message: "Cannot GET /no-such-route",
      },
    });
  });

  it("lets a valid request through untouched", async () => {
    expect(
      await call("/probe/validated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: 3 }),
      }),
    ).toEqual({ status: 201, body: { qty: 3 } });
  });
});
