import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyIngestionPreview, ingestionResponseSchema } from "@/lib/story-ingestion";

const bodySchema = z.object({
  preview: ingestionResponseSchema,
  modelId: z.string(),
  sourceFileName: z.string().optional(),
});

// Commits a previously-returned ingestion preview (POST .../ingest) — the
// client resends its own copy, possibly hand-edited first, same "server is
// stateless between calls" idiom as the Story Chat surface.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { preview, modelId, sourceFileName } = bodySchema.parse(await req.json());

  const result = await applyIngestionPreview({ projectId, preview, modelId, sourceFileName });

  return NextResponse.json(result);
}
