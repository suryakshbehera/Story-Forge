import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { extractTextFromDocument, DocumentParseError, SUPPORTED_DOCUMENT_MIME_TYPES } from "@/lib/document-parse";
import { parseStoryDocument, matchExistingNames } from "@/lib/story-ingestion";

const MAX_BYTES = 20 * 1024 * 1024;

// Phase 9 — parses an uploaded PDF/DOCX into a StoryBible + SeriesBlueprint +
// Characters + Locations preview. This is a read-only draft: the source file
// is stored (same reasoning as any other upload — traceability/re-parsing),
// but nothing is written to StoryBible/SeriesBlueprint/Character/Location
// until POST .../ingest/apply is called with the (possibly edited) preview.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.type !== "SERIES") {
    return NextResponse.json(
      { error: "Document ingestion is only available for Series projects." },
      { status: 400 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const modelIdParam = formData.get("modelId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!SUPPORTED_DOCUMENT_MIME_TYPES.includes(file.type as (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number])) {
    return NextResponse.json(
      { error: "Only PDF or .docx files are allowed" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Document must be under 20MB" }, { status: 400 });
  }

  const model = await getModelOrDefault("STORY_INGESTION", typeof modelIdParam === "string" ? modelIdParam : undefined);
  if (!model) {
    return NextResponse.json(
      { error: "No Story Ingestion model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = buildStorageKey("project-source", projectId, file.name);
  await storage.put(key, buffer);
  const sourceAsset = await prisma.asset.create({
    data: {
      type: "SOURCE_DOCUMENT",
      storageKey: key,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      projectSourceId: projectId,
    },
  });

  try {
    const text = await extractTextFromDocument(file);
    const preview = await parseStoryDocument({ text, modelId: model.modelId });
    const matches = await matchExistingNames(projectId, preview);
    return NextResponse.json({ sourceAsset, preview, matches, modelId: model.modelId });
  } catch (error) {
    if (error instanceof DocumentParseError || error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message, sourceAsset }, { status: 422 });
    }
    throw error;
  }
}
