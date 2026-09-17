import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

// Parses a single "bytes=start-end" (or suffix "bytes=-N") range header.
// Multi-range ("bytes=0-99,200-299") is intentionally NOT supported — no
// consumer of this route (native video/audio players, expo-image) sends
// one; returning a single range for a multi-range request is a valid,
// simpler fallback per the HTTP spec.
function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  if (!rangeHeader.startsWith("bytes=")) return null;
  const spec = rangeHeader.slice(6).split(",")[0]!.trim();
  const [startPart, endPart] = spec.split("-");

  let start: number;
  let end: number;
  if (startPart === "") {
    // Suffix range: last N bytes.
    const suffixLength = Number(endPart);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startPart);
    end = endPart === "" ? size - 1 : Number(endPart);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) return null;
  // start beyond the end of the resource is unsatisfiable — must be checked
  // BEFORE clamping end, or a huge start (e.g. "bytes=999999999-999999999")
  // survives as start > clamped-end, which fs.createReadStream throws on
  // asynchronously (surfacing as a 500, not a clean 416).
  if (start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

// Streaming + Range + ETag — required before mobile can scrub native video/
// audio (AVPlayer et al. open a media URL with a byte-range probe and rely
// on 206 to seek) and before the server stops buffering whole renders (up
// to tens of MB) into the Node heap per request. See
// docs/product/mobile-technical-plan-2026-09.md §3.2.
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keyParts } = await params;
  const key = keyParts.join("/");

  const stat = await storage.stat(key);
  if (!stat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Accept-Ranges": "bytes" } });
  }

  const asset = await prisma.asset.findFirst({ where: { storageKey: key } });

  const headers: Record<string, string> = {
    "Content-Type": asset?.mimeType ?? "application/octet-stream",
    // storage keys are timestamp-prefixed and never rewritten in place —
    // "immutable" is correct, and "private" blocks shared proxies (which we
    // want while this route is session/signature-gated) without blocking
    // an on-device cache.
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    ETag: etag,
  };
  // ?download=1 forces "Save As" instead of the default inline playback —
  // every other consumer of this route (video players, image tiles) must
  // keep streaming inline, so this only applies when explicitly requested.
  if (req.nextUrl.searchParams.get("download") === "1") {
    const fileName = asset?.fileName ?? key.split("/").pop() ?? "download";
    headers["Content-Disposition"] = `attachment; filename="${fileName.replace(/"/g, "")}"`;
  }

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const body = await storage.stream(key, range);
    if (!body) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    return new NextResponse(body, { status: 206, headers });
  }

  const body = await storage.stream(key);
  if (!body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  headers["Content-Length"] = String(stat.size);
  return new NextResponse(body, { headers });
}
