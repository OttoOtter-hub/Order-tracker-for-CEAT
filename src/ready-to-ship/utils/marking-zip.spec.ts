import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as JSZip from "jszip";
import {
  createZipStream,
  markingArchiveName,
  markingEntryNames,
  sanitizeFileName,
} from "./marking-zip";
import { attachmentDisposition } from "../../common/utils/content-disposition";

describe("marking ZIP names", () => {
  it("sanitizeFileName drops path separators, '..' and control characters, keeps Cyrillic and spaces", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("_._etc_passwd");
    expect(sanitizeFileName("a\\b/c.pdf")).toBe("a_b_c.pdf");
    expect(sanitizeFileName("Маркировка\u0000 \u0007июнь.pdf")).toBe(
      "Маркировка июнь.pdf",
    );
    expect(sanitizeFileName('bad<>:"|?*name.pdf')).toBe("bad_______name.pdf");
    expect(sanitizeFileName("  ..hidden.pdf.  ")).toBe("hidden.pdf");
    expect(sanitizeFileName("...", "file")).toBe("file");
    expect(sanitizeFileName("Маркировка поставки 3.pdf")).toBe(
      "Маркировка поставки 3.pdf",
    );
  });

  it("entry names are '<material>_<original name>', unique even when they repeat (any case)", () => {
    expect(
      markingEntryNames([
        { materialNum: "107071", originalName: "marking.pdf" },
        { materialNum: "107071", originalName: "marking.pdf" },
        { materialNum: "107071", originalName: "MARKING.pdf" },
        { materialNum: "113646", originalName: "marking.pdf" },
        { materialNum: null, originalName: "без материала.pdf" },
        { materialNum: "107071", originalName: "marking_2.pdf" },
      ]),
    ).toEqual([
      "107071_marking.pdf",
      "107071_marking_2.pdf",
      "107071_MARKING_3.pdf",
      "113646_marking.pdf",
      "без материала.pdf",
      "107071_marking_2_2.pdf",
    ]);
  });

  it("names are cleaned too: no way out of the extraction folder", () => {
    expect(
      markingEntryNames([
        { materialNum: "../107", originalName: "../../x.pdf" },
      ]),
    ).toEqual(["_107__._x.pdf"]);
  });

  it("archive name is '<container title>_marking.zip', cleaned", () => {
    expect(markingArchiveName("Контейнер 3", "Ростов")).toBe(
      "Контейнер 3 Ростов_marking.zip",
    );
    expect(markingArchiveName("Контейнер 3", null)).toBe(
      "Контейнер 3_marking.zip",
    );
    expect(markingArchiveName("OK to mix", "  ")).toBe("OK to mix_marking.zip");
    expect(markingArchiveName("Контейнер 4", "Орёл/Курск")).toBe(
      "Контейнер 4 Орёл_Курск_marking.zip",
    );
  });

  it("Content-Disposition carries the exact name (RFC 5987) and an ASCII fallback", () => {
    const header = attachmentDisposition("Контейнер 3 Ростов_marking.zip");
    expect(header).toMatch(
      /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/,
    );
    const encoded = header.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe("Контейнер 3 Ростов_marking.zip");
    expect(attachmentDisposition("it's (1).zip")).toContain(
      "filename*=UTF-8''it%27s%20%281%29.zip",
    );
  });
});

describe("createZipStream", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "marking-zip-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  it("streams the files under their entry names, stored, Cyrillic intact", async () => {
    const a = join(dir, "a.pdf");
    const b = join(dir, "b.pdf");
    writeFileSync(a, "%PDF-1.4 first");
    writeFileSync(b, "%PDF-1.4 второй");

    const zipBuffer = await collect(
      createZipStream(
        [
          { name: "107071_marking.pdf", path: a },
          { name: "113646_Маркировка поставки.pdf", path: b },
        ],
        () => undefined,
      ),
    );
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(Object.keys(zip.files).sort()).toEqual([
      "107071_marking.pdf",
      "113646_Маркировка поставки.pdf",
    ]);
    expect(
      await zip.file("113646_Маркировка поставки.pdf")!.async("string"),
    ).toBe("%PDF-1.4 второй");
    // Stored, not deflated (method 0 in the local file header).
    expect(zipBuffer.readUInt16LE(8)).toBe(0);
  });
});
