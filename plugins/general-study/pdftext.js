import { readPdf } from "../input-pdf/parse.js";

/**
 * Plain text pulled from a PDF buffer, page by page, through the exact same
 * zero dependency reader input-pdf's own pipeline hook already calls — this
 * is not a second PDF parser, just a second consumer of readPdf's output.
 * Nothing here reads a scanned image's pixels: a PDF with no extractable
 * text (an encrypted file, or one whose streams use a filter this reader
 * does not decode) is named as such rather than returned as empty and
 * silent.
 */
export function extractText(buffer) {
  const doc = readPdf(buffer);
  if (!doc) return { ok: false, error: "not a readable PDF" };
  if (doc.encrypted) return { ok: false, error: "this PDF is encrypted; its content cannot be read without a password" };
  const pages = doc.pages.map((p) => p.lines.map((l) => l.text).join("\n"));
  return {
    ok: true,
    pages,
    text: pages.join("\n\n"),
    problems: doc.problems ?? [],
    unmapped: doc.unmapped ?? 0,
    info: doc.info ?? {},
  };
}
