import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keyParts } = await params;
  const key = keyParts.join("/");

  const data = await storage.get(key);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asset = await prisma.asset.findFirst({ where: { storageKey: key } });

  const headers: Record<string, string> = {
    "Content-Type": asset?.mimeType ?? "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  // ?download=1 forces "Save As" instead of the default inline playback —
  // every other consumer of this route (video players, image tiles) must
  // keep streaming inline, so this only applies when explicitly requested.
  if (req.nextUrl.searchParams.get("download") === "1") {
    const fileName = asset?.fileName ?? key.split("/").pop() ?? "download";
    headers["Content-Disposition"] = `attachment; filename="${fileName.replace(/"/g, "")}"`;
  }

  return new NextResponse(new Uint8Array(data), { headers });
}
