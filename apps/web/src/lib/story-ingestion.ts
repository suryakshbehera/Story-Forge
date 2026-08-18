import { z } from "zod";
import { prisma, type ProjectType } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { createVersion } from "@/lib/versioning";

// Phase 9 — one-time document ingestion. Modeled directly on
// lib/scenes.ts's generateScenes(): strict-JSON system prompt, zod-validated
// response, JSON.parse/safeParse -> OpenRouterError on failure. Parsing is a
// preview only — nothing is written to Story/StoryBible/SeriesBlueprint/
// Character/Location until applyIngestionPreview() is called ("Apply").
//
// SINGLE projects get `story` (mirrors the Story model); SERIES projects get
// `storyBible` + `blueprint` (SeriesBlueprint has no SINGLE-video analog —
// there are no episodes for a format shape to apply across). Both optional
// in the schema so one response type covers either path; parseStoryDocument
// only ever asks the model to fill the one relevant to the project's type.

const nullableText = () => z.string().nullable().optional();

const characterSchema = z.object({
  name: z.string().min(1),
  identity: nullableText(),
  appearance: nullableText(),
  personality: nullableText(),
  clothing: nullableText(),
  background: nullableText(),
  characterArc: nullableText(),
});

const locationSchema = z.object({
  name: z.string().min(1),
  description: nullableText(),
  architecture: nullableText(),
  environment: nullableText(),
  timeWeather: nullableText(),
  visualStyle: nullableText(),
});

const ingestionResponseSchema = z.object({
  story: z
    .object({
      topic: nullableText(),
      premise: nullableText(),
      genre: nullableText(),
      tone: nullableText(),
      language: nullableText(),
      duration: nullableText(),
      narrationStyle: nullableText(),
      openingStyle: nullableText(),
      closingStyle: nullableText(),
      content: z.string().min(1),
    })
    .nullable()
    .optional(),
  storyBible: z
    .object({
      premise: nullableText(),
      genre: nullableText(),
      tone: nullableText(),
      language: nullableText(),
      worldRules: nullableText(),
      visualStyle: nullableText(),
      timelineNotes: nullableText(),
      content: z.string().min(1),
    })
    .nullable()
    .optional(),
  blueprint: z
    .object({
      actStructure: nullableText(),
      sceneShotGuidance: nullableText(),
      runtimeTarget: nullableText(),
      tone: nullableText(),
      content: z.string().min(1),
    })
    .nullable()
    .optional(),
  characters: z.array(characterSchema).default([]),
  locations: z.array(locationSchema).default([]),
});

// Structured Outputs schema (OpenAI-compatible `json_schema` strict mode,
// passed through by OpenRouter) mirroring ingestionResponseSchema above.
// Passed to callChatModel's jsonSchema param instead of jsonMode's looser
// json_object — constrains the model to the exact flat shape token-by-token
// rather than merely telling it the shape in prose, which is what let a
// model close the "storyBible" object one brace late and silently nest
// "blueprint"/"characters"/"locations" a level deeper (zod's lenient
// top-level parsing then dropped them to their .default([])/undefined
// instead of erroring — see the STORY_INGESTION ingestion-panel bug this
// was added to fix). Strict mode requires every property to be listed in
// "required" and forbids extra properties at every level; optionality is
// expressed as a nullable type (["string","null"]) instead of omission.
const nullableStringSchema = { type: ["string", "null"] } as const;

function requireAll(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as const;
}

const characterJsonSchema = requireAll({
  name: { type: "string" },
  identity: nullableStringSchema,
  appearance: nullableStringSchema,
  personality: nullableStringSchema,
  clothing: nullableStringSchema,
  background: nullableStringSchema,
  characterArc: nullableStringSchema,
});

const locationJsonSchema = requireAll({
  name: { type: "string" },
  description: nullableStringSchema,
  architecture: nullableStringSchema,
  environment: nullableStringSchema,
  timeWeather: nullableStringSchema,
  visualStyle: nullableStringSchema,
});

function nullableObject(schema: ReturnType<typeof requireAll>) {
  return { anyOf: [schema, { type: "null" }] } as const;
}

const ingestionJsonSchema = requireAll({
  story: nullableObject(
    requireAll({
      topic: nullableStringSchema,
      premise: nullableStringSchema,
      genre: nullableStringSchema,
      tone: nullableStringSchema,
      language: nullableStringSchema,
      duration: nullableStringSchema,
      narrationStyle: nullableStringSchema,
      openingStyle: nullableStringSchema,
      closingStyle: nullableStringSchema,
      content: { type: "string" },
    })
  ),
  storyBible: nullableObject(
    requireAll({
      premise: nullableStringSchema,
      genre: nullableStringSchema,
      tone: nullableStringSchema,
      language: nullableStringSchema,
      worldRules: nullableStringSchema,
      visualStyle: nullableStringSchema,
      timelineNotes: nullableStringSchema,
      content: { type: "string" },
    })
  ),
  blueprint: nullableObject(
    requireAll({
      actStructure: nullableStringSchema,
      sceneShotGuidance: nullableStringSchema,
      runtimeTarget: nullableStringSchema,
      tone: nullableStringSchema,
      content: { type: "string" },
    })
  ),
  characters: { type: "array", items: characterJsonSchema },
  locations: { type: "array", items: locationJsonSchema },
});

export type IngestionPreview = z.infer<typeof ingestionResponseSchema>;
export { ingestionResponseSchema };

// Requires strict JSON output via jsonSchema (see callChatModel) — the word
// "JSON" appears below since the provider's structured-output mode still
// expects it mentioned in-prompt.
const CHARACTERS_LOCATIONS_SHAPE = `  "characters": [
    {
      "name": "character name",
      "identity": "role/identity or null",
      "appearance": "physical appearance or null",
      "personality": "personality traits or null",
      "clothing": "typical clothing/costume or null",
      "background": "backstory or null",
      "characterArc": "arc across the story or null"
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

function buildIngestionSystemPrompt(projectType: ProjectType): string {
  const intro = `You are the Story Ingestion engine inside Narrata, a manual-first AI story/video production studio.
A producer has uploaded a source document (a bible, pitch doc, character sheet, or similar) for a ${
    projectType === "SINGLE" ? "single video" : "series"
  }. Read it and extract everything below as strict JSON — no prose, no markdown code fences, no commentary.

Fill every field you can support from the document. If the document is silent on a field, use your best judgment from context (genre/tone/premise) rather than leaving obvious fields empty — like a writer drafting a first pass, not a form-filler. "content" fields are full prose write-ups (a few paragraphs each), not one-line summaries.

Characters and Locations matter as much as the ${
    projectType === "SINGLE" ? "Story" : "Story Bible/Blueprint"
  } write-up — a document with a named cast and named settings should never come back with empty characters/locations arrays. Extract every character and location the document describes or clearly implies, each with as many of its fields filled in as the document supports, not just a bare name.

The response must have exactly these five top-level keys: "story", "storyBible", "blueprint", "characters", "locations". ${
    projectType === "SINGLE"
      ? 'Set "storyBible" and "blueprint" to null — this is a single video, not a series.'
      : 'Set "story" to null — this is a series, not a single video.'
  }

The JSON must match this shape exactly:
{
`;

  const singleShape = `  "story": {
    "topic": "short topic/subject line or null",
    "premise": "one-paragraph premise or null",
    "genre": "short genre label or null",
    "tone": "short tone label or null",
    "language": "the document's language, e.g. English, or null",
    "duration": "target duration, e.g. '5-7 minutes', or null",
    "narrationStyle": "style of narration, e.g. first-person reflective, or null",
    "openingStyle": "how the video should open or null",
    "closingStyle": "how the video should close or null",
    "content": "the full Story write-up, several paragraphs"
  },
`;

  const seriesShape = `  "storyBible": {
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
`;

  return intro + (projectType === "SINGLE" ? singleShape : seriesShape) + CHARACTERS_LOCATIONS_SHAPE;
}

interface ParseStoryDocumentParams {
  text: string;
  modelId: string;
  projectType: ProjectType;
}

export async function parseStoryDocument({
  text,
  modelId,
  projectType,
}: ParseStoryDocumentParams): Promise<IngestionPreview> {
  const userPrompt = `# Source Document\n${text}\n\n# Instructions\nExtract the ${
    projectType === "SINGLE" ? "Story" : "Story Bible, Series Blueprint,"
  } Characters, and Locations from this document now, as JSON.`;

  const raw = await callChatModel({
    modelId,
    systemPrompt: buildIngestionSystemPrompt(projectType),
    userPrompt,
    jsonSchema: { name: "story_ingestion", schema: ingestionJsonSchema },
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
  projectType: ProjectType;
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
  projectType,
  preview,
  modelId,
  sourceFileName,
}: ApplyIngestionPreviewParams): Promise<ApplyIngestionResult> {
  const versionPrompt = `Document ingestion${sourceFileName ? ` — ${sourceFileName}` : ""}`;

  if (projectType === "SINGLE") {
    if (!preview.story) {
      throw new OpenRouterError("AI response didn't include Story fields for this single-video project.");
    }
    const story = await prisma.story.findUniqueOrThrow({ where: { projectId } });
    await createVersion({
      entityType: "STORY",
      entityId: story.id,
      payload: { content: preview.story.content },
      createdBy: "AI",
      prompt: versionPrompt,
      modelId,
    });
    await prisma.story.update({
      where: { projectId },
      data: {
        topic: preview.story.topic ?? null,
        premise: preview.story.premise ?? null,
        genre: preview.story.genre ?? null,
        tone: preview.story.tone ?? null,
        language: preview.story.language ?? null,
        duration: preview.story.duration ?? null,
        narrationStyle: preview.story.narrationStyle ?? null,
        openingStyle: preview.story.openingStyle ?? null,
        closingStyle: preview.story.closingStyle ?? null,
        content: preview.story.content,
      },
    });
  } else {
    if (!preview.storyBible || !preview.blueprint) {
      throw new OpenRouterError("AI response didn't include Story Bible/Blueprint fields for this series project.");
    }
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
  }

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
