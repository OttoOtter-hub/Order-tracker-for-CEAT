import { decodeMultipartFilename } from "./decode-multipart-filename";

// What multer hands over for a filename the browser sent as UTF-8.
const asMulterSees = (utf8Name: string) =>
  Buffer.from(utf8Name, "utf8").toString("latin1");

describe("decodeMultipartFilename", () => {
  it("restores a Cyrillic name that arrived as latin1 mojibake", () => {
    expect(decodeMultipartFilename(asMulterSees("упаковочный лист.pdf"))).toBe(
      "упаковочный лист.pdf",
    );
  });

  it("restores other non-ASCII scripts and accents", () => {
    expect(decodeMultipartFilename(asMulterSees("café №1.xlsx"))).toBe(
      "café №1.xlsx",
    );
  });

  it("leaves ASCII names alone", () => {
    expect(decodeMultipartFilename("packing list.pdf")).toBe(
      "packing list.pdf",
    );
  });

  it("leaves a name that was already decoded correctly alone", () => {
    expect(decodeMultipartFilename("упаковочный лист.pdf")).toBe(
      "упаковочный лист.pdf",
    );
  });

  it("leaves a genuine latin1 name alone (its bytes are not valid UTF-8)", () => {
    expect(decodeMultipartFilename("café.pdf")).toBe("café.pdf");
  });
});
