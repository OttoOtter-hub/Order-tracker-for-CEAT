import archiver = require("archiver");
import type { Readable } from "node:stream";

/**
 * A name that is safe as a file name on any OS and as a ZIP entry: no
 * path separators or ".." (so nothing can be extracted outside the target
 * folder), no control characters, none of Windows' reserved <>:"|?*.
 * Cyrillic, spaces and everything else stay as they are.
 */
export function sanitizeFileName(name: string, fallback = "file"): string {
  const cleaned = name
    // Matching control characters is the point here: they are removed.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\<>:"|?*]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    // Windows drops trailing dots and spaces; leading dots hide the file.
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned || fallback;
}

/**
 * Entry names inside the archive: "<material>_<original name>", cleaned;
 * a name that repeats (compared ignoring case, as Windows does) gets
 * "_2", "_3", … before its extension. Same order as the input.
 */
export function markingEntryNames(
  files: { materialNum: string | null; originalName: string }[],
): string[] {
  const taken = new Set<string>();
  return files.map(({ materialNum, originalName }) => {
    const base = sanitizeFileName(
      materialNum
        ? `${sanitizeFileName(materialNum, "")}_${sanitizeFileName(originalName)}`
        : originalName,
    );
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      candidate = `${stem}_${n}${ext}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/** "<container title>_marking.zip", the title cleaned like any file name. */
export function markingArchiveName(label: string, name: string | null): string {
  const title = name?.trim() ? `${label} ${name.trim()}` : label;
  return `${sanitizeFileName(title, "container")}_marking.zip`;
}

/**
 * The archive as a stream: entries are read from disk one after another
 * while it is being sent, never collected in memory. Stored, not
 * compressed — marking files are PDFs, already compressed.
 */
export function createZipStream(
  entries: { name: string; path: string }[],
  onWarning: (error: Error) => void,
): Readable {
  const archive = archiver("zip", { store: true });
  archive.on("warning", onWarning);
  for (const entry of entries) {
    archive.file(entry.path, { name: entry.name });
  }
  void archive.finalize();
  return archive;
}
