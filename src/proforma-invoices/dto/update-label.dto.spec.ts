import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PI_LABEL_MAX_LENGTH, UpdateLabelDto } from "./update-label.dto";

async function run(body: unknown) {
  const dto = plainToInstance(UpdateLabelDto, body, {
    enableImplicitConversion: true,
  });
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors };
}

describe("UpdateLabelDto", () => {
  it("accepts a string, and trims it", async () => {
    const { dto, errors } = await run({ label: "  Орел  " });

    expect(errors).toHaveLength(0);
    expect(dto.label).toBe("Орел");
  });

  it("accepts null (clears the label) and an empty string", async () => {
    expect((await run({ label: null })).errors).toHaveLength(0);
    const empty = await run({ label: "" });
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.label).toBe("");
  });

  it(`accepts exactly ${PI_LABEL_MAX_LENGTH} characters and rejects one more`, async () => {
    expect(
      (await run({ label: "я".repeat(PI_LABEL_MAX_LENGTH) })).errors,
    ).toHaveLength(0);

    const { errors } = await run({
      label: "я".repeat(PI_LABEL_MAX_LENGTH + 1),
    });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      "название — не более 30 символов",
    );
  });

  it("does not count the spaces around the text against the limit", async () => {
    const padded = ` ${"a".repeat(PI_LABEL_MAX_LENGTH)} `;

    expect((await run({ label: padded })).errors).toHaveLength(0);
  });

  it("rejects a missing label and non-string values", async () => {
    expect((await run({})).errors).toHaveLength(1);
    expect((await run({ label: 123 })).errors).toHaveLength(1);
    expect((await run({ label: { a: 1 } })).errors).toHaveLength(1);
  });
});
