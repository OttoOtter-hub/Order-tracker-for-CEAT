import { extractPiNumber } from "./extract-pi-number";

describe("extractPiNumber", () => {
  it("extracts the number from a plain filename", () => {
    expect(extractPiNumber("100037320.pdf")).toBe("100037320");
  });

  it("extracts the number even with a signed_ prefix", () => {
    expect(extractPiNumber("signed_100037320.pdf")).toBe("100037320");
  });

  it("skips a short digit run (e.g. a year) in favor of the real number", () => {
    expect(extractPiNumber("invoice_2024_100037320_v2.pdf")).toBe(
      "100037320",
    );
  });

  it("returns null when there is no digit run of 6+", () => {
    expect(extractPiNumber("no-digits-here.pdf")).toBeNull();
  });

  it("returns null when digit runs are all too short", () => {
    expect(extractPiNumber("PI-123.pdf")).toBeNull();
  });
});
