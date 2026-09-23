import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// Every HttpException thrown from app code carries an error code, so the
// frontend can translate it (see api-error.ts). A new throw with a bare
// string — the way these used to be written — fails here instead of
// quietly reaching users as untranslated UNKNOWN_ERROR text.
const SRC = join(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

// The argument must be apiError(...) itself, or an object literal spreading
// one (extra fields alongside the code, e.g. CONTAINER_OVERFILLED). `*` is
// allowed in the gaps so usage examples inside doc comments count too.
const CODED_ARGUMENT = /^[\s*]*(apiError\(|\{[\s*]*\.\.\.apiError\()/;

describe("HttpException throw sites", () => {
  it("all pass an apiError(...) body", () => {
    const uncoded: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/throw new (\w+Exception)\(\s*/g)) {
        const argument = text.slice(match.index! + match[0].length);
        if (!CODED_ARGUMENT.test(argument)) {
          const line = text.slice(0, match.index).split("\n").length;
          uncoded.push(`${relative(SRC, file)}:${line} ${match[1]}`);
        }
      }
    }
    expect(uncoded).toEqual([]);
  });
});
