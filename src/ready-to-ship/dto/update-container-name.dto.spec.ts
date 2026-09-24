import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { validationExceptionFactory } from "../../common/errors/api-exception.filter";
import {
  CONTAINER_NAME_MAX_LENGTH,
  UpdateContainerNameDto,
} from "./update-container-name.dto";

async function run(body: unknown) {
  const dto = plainToInstance(UpdateContainerNameDto, body, {
    enableImplicitConversion: true,
  });
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors };
}

describe("UpdateContainerNameDto", () => {
  it("accepts a string, and trims it; accepts null and an empty string", async () => {
    const { dto, errors } = await run({ name: "  Ростов  " });
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("Ростов");

    expect((await run({ name: null })).errors).toHaveLength(0);
    expect((await run({ name: "" })).errors).toHaveLength(0);
  });

  it(`accepts exactly ${CONTAINER_NAME_MAX_LENGTH} characters and rejects one more with CONTAINER_NAME_TOO_LONG`, async () => {
    expect(
      (await run({ name: "я".repeat(CONTAINER_NAME_MAX_LENGTH) })).errors,
    ).toHaveLength(0);

    const { errors } = await run({
      name: "я".repeat(CONTAINER_NAME_MAX_LENGTH + 1),
    });
    expect(validationExceptionFactory(errors).getResponse()).toEqual({
      code: "CONTAINER_NAME_TOO_LONG",
      message: "название — не более 30 символов",
      params: { max: CONTAINER_NAME_MAX_LENGTH },
    });
  });

  it("rejects a non-string with CONTAINER_NAME_NOT_STRING", async () => {
    const { errors } = await run({ name: 42 });
    expect(validationExceptionFactory(errors).getResponse()).toMatchObject({
      code: "CONTAINER_NAME_NOT_STRING",
    });
  });
});
