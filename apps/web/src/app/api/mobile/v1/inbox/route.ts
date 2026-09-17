import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getInboxItems, createTextCapture, createMediaCapture, CaptureError } from "@/lib/inbox";

// Not in proxy.ts's RESOLVERS — CaptureItem is owned by User, not Project
// (see lib/inbox.ts's header comment); every handler here scopes by
// x-user-id itself.

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await getInboxItems(currentUser.id);
  return NextResponse.json({ items });
}

const textCaptureSchema = z.object({
  kind: z.enum(["LINK", "TEXT"]),
  text: z.string().min(1),
  sourceApp: z.string().optional(),
  projectId: z.string().optional(),
});

// LINK/TEXT arrive as JSON; IMAGE/AUDIO_NOTE as multipart (mirrors every
// other upload route in this app, e.g. shots/[id]/images/upload).
export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");
    const kindRaw = formData.get("kind");
    const kind = kindRaw === "AUDIO_NOTE" ? "AUDIO_NOTE" : kindRaw === "IMAGE" ? "IMAGE" : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!kind) {
      return NextResponse.json({ error: 'kind must be "IMAGE" or "AUDIO_NOTE" for a multipart capture' }, { status: 400 });
    }
    if (kind === "IMAGE" && !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image files are allowed for an IMAGE capture" }, { status: 400 });
    }
    if (kind === "AUDIO_NOTE" && !file.type.startsWith("audio/")) {
      return NextResponse.json({ error: "Only audio files are allowed for an AUDIO_NOTE capture" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const item = await createMediaCapture(currentUser.id, {
        kind,
        buffer,
        fileName: file.name,
        mimeType: file.type,
        text: formData.get("text")?.toString(),
        sourceApp: formData.get("sourceApp")?.toString(),
        projectId: formData.get("projectId")?.toString(),
      });
      return NextResponse.json(item, { status: 201 });
    } catch (error) {
      if (error instanceof CaptureError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }

  const body = textCaptureSchema.parse(await req.json());
  const item = await createTextCapture(currentUser.id, body);
  return NextResponse.json(item, { status: 201 });
}
