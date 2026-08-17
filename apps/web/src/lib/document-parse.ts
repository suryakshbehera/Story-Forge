import pdfParse from "pdf-parse";
import mammoth from "mammoth";

// Phase 9 — text extraction only, no OCR/layout preservation. Legacy binary
// .doc isn't supported (mammoth only reads the OOXML .docx format); reject
// it with a clear message rather than silently mis-parsing it.
export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export class DocumentParseError extends Error {}

// Bounded input budget for the STORY_INGESTION model call — same truncate-
// with-marker idiom as assembleContext()'s MAX_CHARS, no chunking/map-reduce
// pipeline. Generous relative to that 60,000 since this is a one-time call.
const MAX_CHARS = 100_000;

export async function extractTextFromDocument(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  let text: string;
  if (file.type === "application/pdf") {
    const result = await pdfParse(buffer);
    text = result.text;
  } else if (file.type === SUPPORTED_DOCUMENT_MIME_TYPES[1]) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    throw new DocumentParseError(
      "Unsupported file type. Upload a PDF or a .docx Word document (legacy .doc isn't supported)."
    );
  }

  text = text.trim();
  if (!text) {
    throw new DocumentParseError("No readable text found in that document.");
  }

  if (text.length > MAX_CHARS) {
    return `${text.slice(0, MAX_CHARS)}\n\n[...document truncated to fit budget...]`;
  }
  return text;
}
