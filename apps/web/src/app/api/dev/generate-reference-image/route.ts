import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getDefaultModelForJob } from "@/lib/ai/models";
import { generateImage, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";

// TEMPORARY dev-only utility: generates a reference image from a text prompt
// and attaches it to a Character or Location as a REFERENCE_IMAGE asset.
// Exists only because the real UI expects the user to upload their own
// reference art (manual-first, no AI-draft step for that asset type) — this
// is a one-off stand-in for that upload step when no local file is
// available. Delete this route once it's no longer needed.
const bodySchema = z.object({
  prompt: z.string().min(1),
  characterId: z.string().optional(),
  locationId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = bodySchema.parse(await req.json());
  if (!body.characterId && !body.locationId) {
    return NextResponse.json({ error: "characterId or locationId required" }, { status: 400 });
  }

  const model = await getDefaultModelForJob("IMAGE_GENERATION");
  if (!model) {
    return NextResponse.json({ error: "No Image Generation model configured." }, { status: 400 });
  }

  try {
    const generated = await generateImage({ modelId: model.modelId, prompt: body.prompt, aspectRatio: "16:9" });
    const buffer = Buffer.from(generated.base64, "base64");
    const ext = generated.mimeType === "image/jpeg" ? "jpg" : "png";
    const ownerId = body.characterId ?? body.locationId!;
    const key = buildStorageKey(body.characterId ? "characters" : "locations", ownerId, `ref-${Date.now()}.${ext}`);
    await storage.put(key, buffer);
    const asset = await prisma.asset.create({
      data: {
        type: "REFERENCE_IMAGE",
        storageKey: key,
        fileName: `ref.${ext}`,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        characterId: body.characterId,
        locationId: body.locationId,
        createdBy: "AI",
        modelId: model.modelId,
        prompt: body.prompt,
      },
    });
    return NextResponse.json({ id: asset.id, url: storage.url(asset.storageKey) }, { status: 201 });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
