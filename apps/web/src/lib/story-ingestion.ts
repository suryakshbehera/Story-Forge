import { z } from "zod";
import { prisma } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { createVersion } from "@/lib/versioning";

// Phase 9 — one-time document ingestion. Modeled directly on
// lib/scenes.ts's generateScenes(): strict-JSON system prompt, zod-validated
// response, JSON.parse/safeParse -> OpenRouterError on failure. Parsing is a
// preview only — nothing is written to StoryBible/SeriesBlueprint/Character/
// Location until applyIngestionPreview() is called (the "Apply" click).

const nullableText = () => z.string().nullable().optional();

const ingestionResponseSchema = z.object({
  storyBible: z.object({
    premise: nullableText(),
    genre: nullableText(),
    tone: nullableText(),
    language: nullableText(),
    worldRules: nullableText(),
    visualStyle: nullableText(),
    timelineNotes: nullableText(),
    content: z.string().min(1),
  }),
  blueprint: z.object({
    actStructure: nullableText(),
    sceneShotGuidance: nullableText(),
    runtimeTarget: nullableText(),
    tone: nullableText(),
    content: z.string().min(1),
  }),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        identity: nullableText(),
        appearance: nullableText(),
        personality: nullableText(),
        clothing: nullableText(),
        background: nullableText(),
        characterArc: nullableText(),
      })
    )
    .default([]),
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        description: nullableText(),
        architecture: nullableText(),
        environment: nullableText(),
        timeWeather: nullableText(),
        visualStyle: nullableText(),
      })
    )
    .default([]),
});

export type IngestionPreview = z.infer<typeof ingestionResponseSchema>;
export { ingestionResponseSchema };

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const INGESTION_SYSTEM_PROMPT = `You are the Story Ingestion engine inside Narrata, a manual-first AI story/video production studio.
A producer has uploaded a source document (a series bible, pitch doc, character sheet, or similar) for a new series. Read it and extract everything below as strict JSON — no prose, no markdown code fences, no commentary.

Fill every field you can support from the document. If the document is silent on a field, use your best judgment from context (genre/tone/premise) rather than leaving obvious fields empty — like a writer drafting a first pass, not a form-filler. "content" fields are full prose write-ups (a few paragraphs each), not one-line summaries.

The JSON must match this shape exactly:
{
  "storyBible": {
    "premise": "one-paragraph premise or null",
    "genre": "short genre label or null",
    "tone": "short tone label or null",
    "language": "the document's language, e.g. English, or null",
    "worldRules": "world-building rules/constraints or null",
    "visualStyle": "overall visual style description or null",
    "timelineNotes": "chronology/continuity notes or null",
    "content": "the full Story Bible write-up, several paragraphs"
  },
  "blueprint": {
    "actStructure": "the series' typical episode act structure (e.g. '3-act: cold open, escalation, resolution') or null",
    "sceneShotGuidance": "typical scene/shot counts per episode (e.g. '6-8 scenes, 2-3 shots each') or null",
    "runtimeTarget": "typical episode runtime (e.g. '8-10 minutes') or null",
    "tone": "short tone label for the format itself or null",
    "content": "a short write-up of the format shape new episodes should follow"
  },
  "characters": [
    {
      "name": "character name",
      "identity": "role/identity or null",
      "appearance": "physical appearance or null",
      "personality": "personality traits or null",
      "clothing": "typical clothing/costume or null",
      "background": "backstory or null",
      "characterArc": "arc across the series or null"
    }
  ],
  "locations": [
    {
      "name": "location name",
      "description": "general description or null",
      "architecture": "architectural details or null",
      "environment": "environment/setting details or null",
      "timeWeather": "typical time of day/weather or null",
      "visualStyle": "visual style for this location or null"
    }
  ]
}

Only list characters/locations that are actually described or clearly implied in the document. Use an empty array if none are described.`;

interface ParseStoryDocumentParams {
  text: string;
  modelId: string;
}

export async function parseStoryDocument({ text, modelId }: ParseStoryDocumentParams): Promise<IngestionPreview> {
  const userPrompt = `# Source Document\n${text}\n\n# Instructions\nExtract the Story Bible, Series Blueprint, Characters, and Locations from this document now, as JSON.`;

  const raw = await callChatModel({
    modelId,
    systemPrompt: INGESTION_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }

  const parsed = ingestionResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  return parsed.data;
}

export interface NameMatch {
  name: string;
  isExisting: boolean;
}

// Dry-run of the same case-insensitive matching applyIngestionPreview() uses
// to create-vs-update — lets the preview UI honestly show "3 new, 2 already
// exist (blanks only)" before the user commits to anything.
export async function matchExistingNames(
  projectId: string,
  preview: Pick<IngestionPreview, "characters" | "locations">
): Promise<{ characters: NameMatch[]; locations: NameMatch[] }> {
  const [existingCharacters, existingLocations] = await Promise.all([
    prisma.character.findMany({ where: { projectId }, select: { name: true } }),
    prisma.location.findMany({ where: { projectId }, select: { name: true } }),
  ]);
  const charNames = new Set(existingCharacters.map((c) => c.name.toLowerCase()));
  const locNames = new Set(existingLocations.map((l) => l.name.toLowerCase()));

  return {
    characters: preview.characters.map((c) => ({ name: c.name, isExisting: charNames.has(c.name.toLowerCase()) })),
    locations: preview.locations.map((l) => ({ name: l.name, isExisting: locNames.has(l.name.toLowerCase()) })),
  };
}

// Character/Location are plain-CRUD, not versioned (see schema.prisma), so
// unlike StoryBible/SeriesBlueprint content (freely overwritable — old
// drafts stay recoverable via Version history) applying ingestion must never
// silently clobber a human-entered field. Only fills currently-empty fields
// (covers both null and "" — forms save "" for a cleared field, not null).
function fillIfBlank(existing: string | null, incoming?: string | null): string | undefined {
  if (existing) return undefined;
  return incoming || undefined;
}

interface ApplyIngestionPreviewParams {
  projectId: string;
  preview: IngestionPreview;
  modelId: string;
  sourceFileName?: string;
}

export interface ApplyIngestionResult {
  createdCharacters: string[];
  updatedCharacters: string[];
  createdLocations: string[];
  updatedLocations: string[];
}

export async function applyIngestionPreview({
  projectId,
  preview,
  modelId,
  sourceFileName,
}: ApplyIngestionPreviewParams): Promise<ApplyIngestionResult> {
  const versionPrompt = `Document ingestion${sourceFileName ? ` — ${sourceFileName}` : ""}`;

  const storyBible = await prisma.storyBible.findUniqueOrThrow({ where: { projectId } });
  await createVersion({
    entityType: "STORY_BIBLE",
    entityId: storyBible.id,
    payload: { content: preview.storyBible.content },
    createdBy: "AI",
    prompt: versionPrompt,
    modelId,
  });
  await prisma.storyBible.update({
    where: { projectId },
    data: {
      premise: preview.storyBible.premise ?? null,
      genre: preview.storyBible.genre ?? null,
      tone: preview.storyBible.tone ?? null,
      language: preview.storyBible.language ?? null,
      worldRules: preview.storyBible.worldRules ?? null,
      visualStyle: preview.storyBible.visualStyle ?? null,
      timelineNotes: preview.storyBible.timelineNotes ?? null,
      content: preview.storyBible.content,
    },
  });

  const blueprint = await prisma.seriesBlueprint.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });
  await createVersion({
    entityType: "SERIES_BLUEPRINT",
    entityId: blueprint.id,
    payload: { content: preview.blueprint.content },
    createdBy: "AI",
    prompt: versionPrompt,
    modelId,
  });
  await prisma.seriesBlueprint.update({
    where: { projectId },
    data: {
      actStructure: preview.blueprint.actStructure ?? null,
      sceneShotGuidance: preview.blueprint.sceneShotGuidance ?? null,
      runtimeTarget: preview.blueprint.runtimeTarget ?? null,
      tone: preview.blueprint.tone ?? null,
      content: preview.blueprint.content,
    },
  });

  const [existingCharacters, existingLocations] = await Promise.all([
    prisma.character.findMany({ where: { projectId } }),
    prisma.location.findMany({ where: { projectId } }),
  ]);
  const charByName = new Map(existingCharacters.map((c) => [c.name.toLowerCase(), c]));
  const locByName = new Map(existingLocations.map((l) => [l.name.toLowerCase(), l]));

  const createdCharacters: string[] = [];
  const updatedCharacters: string[] = [];
  for (const c of preview.characters) {
    const existing = charByName.get(c.name.toLowerCase());
    if (existing) {
      await prisma.character.update({
        where: { id: existing.id },
        data: {
          identity: fillIfBlank(existing.identity, c.identity),
          appearance: fillIfBlank(existing.appearance, c.appearance),
          personality: fillIfBlank(existing.personality, c.personality),
          clothing: fillIfBlank(existing.clothing, c.clothing),
          background: fillIfBlank(existing.background, c.background),
          characterArc: fillIfBlank(existing.characterArc, c.characterArc),
        },
      });
      updatedCharacters.push(c.name);
    } else {
      await prisma.character.create({
        data: {
          projectId,
          name: c.name,
          identity: c.identity ?? null,
          appearance: c.appearance ?? null,
          personality: c.personality ?? null,
          clothing: c.clothing ?? null,
          background: c.background ?? null,
          characterArc: c.characterArc ?? null,
        },
      });
      createdCharacters.push(c.name);
    }
  }

  const createdLocations: string[] = [];
  const updatedLocations: string[] = [];
  for (const l of preview.locations) {
    const existing = locByName.get(l.name.toLowerCase());
    if (existing) {
      await prisma.location.update({
        where: { id: existing.id },
        data: {
          description: fillIfBlank(existing.description, l.description),
          architecture: fillIfBlank(existing.architecture, l.architecture),
          environment: fillIfBlank(existing.environment, l.environment),
          timeWeather: fillIfBlank(existing.timeWeather, l.timeWeather),
          visualStyle: fillIfBlank(existing.visualStyle, l.visualStyle),
        },
      });
      updatedLocations.push(l.name);
    } else {
      await prisma.location.create({
        data: {
          projectId,
          name: l.name,
          description: l.description ?? null,
          architecture: l.architecture ?? null,
          environment: l.environment ?? null,
          timeWeather: l.timeWeather ?? null,
          visualStyle: l.visualStyle ?? null,
        },
      });
      createdLocations.push(l.name);
    }
  }

  return { createdCharacters, updatedCharacters, createdLocations, updatedLocations };
}
