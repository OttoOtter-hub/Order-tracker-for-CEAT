import { stampDateOnFilename } from "./stamp-date-on-filename";

describe("stampDateOnFilename", () => {
  it("inserts the date before the extension", () => {
    expect(
      stampDateOnFilename("MTK ROSBERG INR.xlsx", new Date("2026-09-03T12:00:00Z")),
    ).toBe("MTK ROSBERG INR_2026-09-03.xlsx");
  });

  it("handles a filename with no extension", () => {
    expect(stampDateOnFilename("backorder", new Date("2026-09-03T00:00:00Z"))).toBe(
      "backorder_2026-09-03",
    );
  });

  it("handles a dotfile-style name (leading dot only) without treating it as an extension", () => {
    expect(stampDateOnFilename(".xlsx", new Date("2026-09-03T00:00:00Z"))).toBe(
      ".xlsx_2026-09-03",
    );
  });

  it("keeps only the last extension for a filename with multiple dots", () => {
    expect(
      stampDateOnFilename("MTK.ROSBERG.INR.xlsx", new Date("2026-09-03T00:00:00Z")),
    ).toBe("MTK.ROSBERG.INR_2026-09-03.xlsx");
  });
});
