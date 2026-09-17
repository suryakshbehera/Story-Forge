import { z } from "zod";
import { prisma, type Asset } from "@/lib/db";
import {
  SHOT_SIZE_LABELS,
  CAMERA_ANGLE_LABELS,
  SHOT_FRAMING_LABELS,
  DEPTH_OF_FIELD_LABELS,
  LIGHTING_STYLE_LABELS,
  SHOT_COMPOSITION_LABELS,
  hasCameraDirection,
  type ShotCinematography,
} from "@/lib/cinematography";
import { EMOTION_LABELS, EMOTION_INTENSITY_LABELS, type ShotEmotion } from "@/lib/emotion";
import { callChatModel, generateImage, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";
import { IMAGE_GENERATION_STALE_MS } from "@/lib/shot-image-generation";
import { recordGenerationEvent } from "@/lib/generation-events";
import { findLastShotOfPreviousScene, parseContinuitySnapshot } from "@/lib/scene-continuity";

// Atomically claims a shot for image generation by stamping
// Shot.imageGenerationStartedAt — an existing, non-stale stamp means a
// generation is genuinely still in flight (this tab, another tab, or a
// reload of either), so the caller should reject the request rather than
// starting a second paid job on top of it. Stale stamps (older than
// IMAGE_GENERATION_STALE_MS) are treated as abandoned and reclaimed, so a
// crashed request can't block generation forever.
export async function claimShotForImageGeneration(shotId: string): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - IMAGE_GENERATION_STALE_MS);
  const result = await prisma.shot.updateMany({
    where: {
      id: shotId,
      OR: [{ imageGenerationStartedAt: null }, { imageGenerationStartedAt: { lt: staleThreshold } }],
    },
    data: { imageGenerationStartedAt: new Date() },
  });
  return result.count > 0;
}

// Always called from a finally in the route handler so the claim is released
// on both success and failure — an unreleased claim just self-heals once
// stale, but releasing promptly means the next click doesn't have to wait
// out the full stale window.
export async function releaseShotImageGeneration(shotId: string): Promise<void> {
  await prisma.shot.update({ where: { id: shotId }, data: { imageGenerationStartedAt: null } });
}

export interface SerializedShotImage {
  id: string;
  url: string;
  isSelected: boolean;
  validationPassed: boolean | null;
  validationNotes: string | null;
  createdAt: Date;
}

export function serializeShotImage(asset: Asset): SerializedShotImage {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    validationPassed: asset.validationPassed,
    validationNotes: asset.validationNotes,
    createdAt: asset.createdAt,
  };
}

const SHOT_CONTEXT_INCLUDE = {
  scene: {
    include: {
      characters: { include: { referenceImages: true } },
      locations: { include: { referenceImages: true } },
      story: { include: { project: { include: { styleReferences: true } } } },
      episode: {
        include: { season: { include: { project: { include: { storyBible: true, styleReferences: true } } } } },
      },
    },
  },
} as const;

async function loadShotContext(shotId: string) {
  return prisma.shot.findUniqueOrThrow({
    where: { id: shotId },
    include: SHOT_CONTEXT_INCLUDE,
  });
}

type ShotContext = Awaited<ReturnType<typeof loadShotContext>>;

// Continuity carry-forward — same-scene adjacency (order - 1) when it
// exists; otherwise falls back to the last shot of whatever scene precedes
// this one (chasing episode/season boundaries — see scene-continuity.ts).
// Feeds both a generation reference image and a text note into the NEXT
// shot's prompt so state established in one shot (a prop picked up, a
// wardrobe change) actually shows up in the one after it, instead of every
// shot being generated from the static bibles alone.
async function loadPreviousShot(shot: {
  sceneId: string;
  order: number;
  scene: { order: number; storyId: string | null; episodeId: string | null };
}) {
  const inScene = await prisma.shot.findFirst({
    where: { sceneId: shot.sceneId, order: shot.order - 1 },
    include: { images: { where: { isSelected: true }, take: 1 } },
  });
  if (inScene) return { shot: inScene, crossScene: false as const };

  const prevSceneShot = await findLastShotOfPreviousScene(shot.scene);
  return prevSceneShot ? { shot: prevSceneShot, crossScene: true as const } : null;
}

interface PreviousShotContext {
  description: string;
  continuityNotes: string | null;
  continuity: { subject: string; state: string }[];
  hasImage: boolean;
  // True when this is the closing shot of the previous scene rather than the
  // previous shot within this same scene — changes how the prompt/validation
  // wording treats it (identity/wardrobe/prop continuity still applies, but
  // lighting/geography/framing likely don't, since the setting may differ).
  crossScene: boolean;
}

// The project's visual-style anchor (see Project.styleReferences) — first
// uploaded image, same convention as Character/Location reference images.
// Works for both Single Video (via Story.project) and Series (via
// Episode.season.project).
function getProjectStyleReference(scene: ShotContext["scene"]): Asset | null {
  const refs = scene.story?.project.styleReferences ?? scene.episode?.season.project.styleReferences ?? [];
  return refs[0] ?? null;
}

// Loose visual-style hint pulled from whichever parent exists — Story (Single
// Video) has no dedicated visualStyle field, only StoryBible (Series) does,
// so this falls back to genre/tone for Single Video projects.
function buildStyleContext(scene: ShotContext["scene"]): string | null {
  if (scene.story) {
    const parts = [scene.story.genre && `Genre: ${scene.story.genre}`, scene.story.tone && `Tone: ${scene.story.tone}`].filter(
      Boolean
    );
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const bible = scene.episode?.season.project.storyBible;
  if (!bible) return null;
  const parts = [
    bible.genre && `Genre: ${bible.genre}`,
    bible.tone && `Tone: ${bible.tone}`,
    bible.visualStyle && `Visual style: ${bible.visualStyle}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

// ── Director AI cinematography → image prompt ────────────────────────────
// Renders the resolved per-shot camera fields (Shot.shotSize/cameraAngle/…,
// drafted by SHOT_PLANNING or directExistingShots in lib/shots.ts) into the
// image prompt. The vocabulary itself lives in lib/cinematography.ts, shared
// with the Image→Video pair prompt so a still and the clip generated from it
// are directed in the same words.

function buildCameraDirectionBlock(shot: ShotCinematography): string | false {
  const lines = [
    shot.shotSize && `Shot size: ${SHOT_SIZE_LABELS[shot.shotSize]}`,
    shot.lensMm !== null && `Lens: ${shot.lensMm}mm`,
    shot.cameraAngle && `Camera angle: ${CAMERA_ANGLE_LABELS[shot.cameraAngle]}`,
    shot.framing && `Framing: ${SHOT_FRAMING_LABELS[shot.framing]}`,
    shot.depthOfField && `Depth of field: ${DEPTH_OF_FIELD_LABELS[shot.depthOfField]}`,
    shot.focusPoint && `Focus point: ${shot.focusPoint}`,
    shot.lightingStyle && `Lighting: ${LIGHTING_STYLE_LABELS[shot.lightingStyle]}`,
    shot.composition && `Composition: ${SHOT_COMPOSITION_LABELS[shot.composition]}`,
    shot.subjectMovement && `Subject movement: ${shot.subjectMovement}`,
  ].filter(Boolean);
  if (lines.length === 0) return false;
  return `# Camera direction (binding — the Director resolved these for this shot)\n${lines.join("\n")}`;
}

// ── Director AI emotion → image prompt ────────────────────────────────────
// Same contract as buildCameraDirectionBlock one axis over: emotion/
// emotionIntensity are categorical (restated verbatim, never paraphrased
// away — see the tail below), facialExpression/bodyLanguage are prose the
// prompt model should weave into the shot's description rather than bolt on.
function buildEmotionDirectionBlock(shot: ShotEmotion): string | false {
  const lines = [
    shot.emotion && `Emotion: ${EMOTION_LABELS[shot.emotion]}`,
    shot.emotionIntensity && `Intensity: ${EMOTION_INTENSITY_LABELS[shot.emotionIntensity]}`,
    shot.facialExpression && `Facial expression: ${shot.facialExpression}`,
    shot.bodyLanguage && `Body language: ${shot.bodyLanguage}`,
  ].filter(Boolean);
  if (lines.length === 0) return false;
  return `# Performance direction (binding — the Director resolved these for this shot)\n${lines.join("\n")}`;
}

// Appended verbatim to whatever the prompt-writing model returns, rather
// than trusted to it: the camera direction is a resolved decision, and a
// prompt model that paraphrases "low angle" into nothing silently loses it.
// Deterministic, so the same shot always ends with the same technical tail.
// subjectMovement is deliberately NOT here — it's action the prompt model
// should weave into the scene's prose, not a lens spec to bolt on the end.
function cinematographyTail(shot: ShotCinematography): string {
  const parts = [
    shot.shotSize && SHOT_SIZE_LABELS[shot.shotSize],
    shot.cameraAngle && CAMERA_ANGLE_LABELS[shot.cameraAngle],
    shot.framing && SHOT_FRAMING_LABELS[shot.framing],
    shot.lensMm !== null && `shot on a ${shot.lensMm}mm lens`,
    shot.depthOfField && DEPTH_OF_FIELD_LABELS[shot.depthOfField],
    shot.lightingStyle && LIGHTING_STYLE_LABELS[shot.lightingStyle],
    shot.composition && SHOT_COMPOSITION_LABELS[shot.composition],
    shot.focusPoint && `focus on ${shot.focusPoint}`,
  ].filter(Boolean);
  return parts.length === 0 ? "" : `${parts.join(", ")}.`;
}

// Same contract as cinematographyTail, for the two categorical emotion
// fields — facialExpression/bodyLanguage are prose the prompt model should
// already have woven in via the binding block above, so they don't repeat
// here.
function emotionTail(shot: ShotEmotion): string {
  const parts = [
    shot.emotion && shot.emotionIntensity
      ? `${EMOTION_INTENSITY_LABELS[shot.emotionIntensity]} ${EMOTION_LABELS[shot.emotion]}`
      : shot.emotion && EMOTION_LABELS[shot.emotion],
  ].filter(Boolean);
  return parts.length === 0 ? "" : `Emotional performance: ${parts.join(", ")}.`;
}

const IMAGE_PROMPT_SYSTEM_PROMPT = `You are the Image Prompt step of Narrata's Image pipeline. Turn the shot description below — plus the broader scene it belongs to and any tagged character/location details — into a single polished, concrete image-generation prompt for a text-to-image model.

The shot description is the primary framing (what's actually on screen); the scene description is context for continuity, not the subject to draw literally. Describe composition, subjects, setting, lighting, and mood in one paragraph. Output only the prompt text itself — no meta-commentary, no markdown, no explanations.

When a "# Camera direction" section is present, it is binding: those values were resolved by the Director for this specific shot, as part of directing the whole scene. Express every one of them in your prompt — shot size, lens, angle, depth of field, lighting and composition as written, and the subject movement as what the subjects are doing in frame. Never contradict them, never substitute your own framing or lighting for them, and never drop one because the shot description implies something else. Axes the section doesn't mention are yours to choose freely.

When a "# Performance direction" section is present, it is equally binding: express the named emotion and intensity through the facial expression and body language given (or, if either is blank, through your own concrete physical detail consistent with the emotion) — never name the emotion abstractly ("a sad expression") when a physical detail can show it instead.

When a "# Continuity from previous shot" section is present, it describes state to preserve, not a moment to re-stage: reflect the carried state (props held, wardrobe, position) in your prompt, and compose a distinct moment rather than repeating the previous shot. If a "# Camera direction" section is also present, that section decides the framing — the two are not in conflict: hold the directed framing and let the moment/action be what moves the scene on.

A "# Continuity from the previous scene" section is the same idea but crosses a scene break: only identity/wardrobe/prop/emotional state should carry over, never lighting or geography, since the new scene is likely a different setting.

When a "# Attached reference images, in order" section is present, each attached image corresponds positionally to that numbered list — reference image N is only for the entity named in list item N. Never apply one character's or location's reference image to a different named entity, and never assume an image exists for an entity not listed there — an entity marked "[no reference image attached]" must be rendered from its text description alone.`;

// `directed` = this shot has resolved camera fields (see hasCameraDirection).
// It flips the previous-shot image's role: without direction the image is
// the only thing stopping shot 2 from duplicating shot 1's framing, so the
// instruction pushes *away* from it. With direction, framing is already
// decided upstream by a Director that saw the whole scene — telling the
// prompt model to "compose a new framing" there would have it fight the
// resolved cameraAngle/shotSize, so the image narrows to what it's actually
// good for: lighting, props, wardrobe continuity.
function buildContinuityBlock(previousShot: PreviousShotContext | null, directed: boolean): string | false {
  if (!previousShot) return false;
  const resolvedState =
    previousShot.continuity.length > 0
      ? `Resolved state: ${previousShot.continuity.map((e) => `${e.subject} — ${e.state}`).join("; ")}`
      : null;
  const previousImageNote = previousShot.crossScene
    ? "An attached reference image shows the closing shot of the previous scene — use it only for character/prop identity and any wardrobe or physical state that should still be true. The new scene likely has a different setting: do not carry over its lighting, geography, or framing."
    : directed
      ? "An attached reference image shows this previous shot — use it only to carry over lighting, props held, wardrobe and physical continuity. It does NOT decide this shot's framing: the '# Camera direction' section above does."
      : "An attached reference image shows this previous shot — use it only to keep physical continuity (props held, wardrobe, position, lighting) consistent; compose a new camera framing, do not reproduce its shot.";
  const lines = [
    previousShot.crossScene &&
      "A scene break may mean time has passed or the setting has changed — carry forward only what would plausibly still be true, not everything by default.",
    `${previousShot.crossScene ? "Closing state of the previous scene" : "Previous shot"}: ${previousShot.description}`,
    resolvedState,
    previousShot.continuityNotes && `Carried state: ${previousShot.continuityNotes}`,
    previousShot.hasImage && previousImageNote,
  ].filter(Boolean);
  const heading = previousShot.crossScene ? "# Continuity from the previous scene" : "# Continuity from previous shot";
  return `${heading}\n${lines.join("\n")}`;
}

async function buildImagePrompt(
  shot: ShotContext,
  styleContext: string | null,
  instructions: string | undefined,
  modelId: string,
  previousShot: PreviousShotContext | null,
  referenceManifest: string[],
  referencedEntityNames: Set<string>
): Promise<string> {
  const scene = shot.scene;
  // An entity absent from referencedEntityNames has no attached reference
  // image (unlocked character, or locked with none uploaded) — flagged
  // explicitly so the model can't borrow a different entity's reference
  // image for it. This, plus the numbered manifest below, is the fix for
  // the "wrong character's face" bug: the reference array was positional
  // and unlabeled while the text described every character regardless of
  // whether an image backed them.
  const characterBlocks = scene.characters
    .map((c) => {
      const desc = [`${c.name}:`, c.age && `Age: ${c.age}.`, c.appearance, c.personality, c.clothing]
        .filter(Boolean)
        .join(" ");
      return referencedEntityNames.has(c.name) ? desc : `${desc} [no reference image attached — appearance from this text only]`;
    })
    .join("\n");
  const locationBlocks = scene.locations
    .map((l) => {
      const desc = [`${l.name}:`, l.description, l.architecture, l.environment, l.timeWeather].filter(Boolean).join(" ");
      return referencedEntityNames.has(l.name) ? desc : `${desc} [no reference image attached — appearance from this text only]`;
    })
    .join("\n");
  const referenceBlock =
    referenceManifest.length > 0
      ? `# Attached reference images, in order\n${referenceManifest.map((label, i) => `${i + 1}. ${label}`).join("\n")}`
      : null;

  const userPrompt = [
    `# Shot\n${shot.description}`,
    `# Scene context\n${scene.description}`,
    scene.visualMode === "IMAGE_TO_VIDEO" && "This image will feed a video generation call as a continuity frame.",
    // Before the continuity block on purpose — the continuity block refers
    // back to this section ("the '# Camera direction' section above").
    buildCameraDirectionBlock(shot),
    buildEmotionDirectionBlock(shot),
    buildContinuityBlock(previousShot, hasCameraDirection(shot)),
    referenceBlock,
    characterBlocks && `# Characters in this scene\n${characterBlocks}`,
    locationBlocks && `# Locations in this scene\n${locationBlocks}`,
    styleContext && `# Style\n${styleContext}`,
    instructions?.trim() && `# Additional instructions\n${instructions.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = await callChatModel({
    modelId,
    systemPrompt: IMAGE_PROMPT_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.7,
  });

  // Belt and braces: the resolved camera/emotion spec is restated
  // deterministically at the end of the prompt so it survives a prompt model
  // that paraphrased it away. Empty string when the shot has no direction at
  // all on that axis.
  const tail = [cinematographyTail(shot), emotionTail(shot)].filter(Boolean).join(" ");
  return tail ? `${prompt.trim()} ${tail}` : prompt.trim();
}

// Exported for scene-video.ts's runVideoValidation — same {passed, notes}
// shape, reused rather than redefined so the two validation steps can never
// silently drift apart on response contract.
export const validationResponseSchema = z.object({
  passed: z.boolean(),
  notes: z.string(),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const IMAGE_VALIDATION_SYSTEM_PROMPT = `You are the Image Validation step of Narrata's Image pipeline. The first image provided is a newly generated shot image. If a previous-shot image is included, it comes immediately next — use it only to check continuity (props held, wardrobe, position), never to judge style or framing. Any remaining images are locked reference images for named characters/locations, given in the order listed in the user prompt.

Judge whether the newly generated image stays visually consistent with those references (character appearance/clothing, location architecture/environment) — minor stylistic differences are fine, but a different-looking character or place is not.

When continuity facts are listed in the user prompt, also judge whether the image honors them — a shot that silently drops or contradicts carried state (a prop that should still be held, a wardrobe or physical change that should show) counts as a failure the same way a mismatched reference does.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{ "passed": true or false, "notes": "one or two sentences explaining the judgment, covering reference consistency and continuity whenever both were checked" }`;

export interface ValidationEntity {
  name: string;
  referenceImages: Asset[];
}

// Exported for scene-video.ts's optional cast/location reference wiring
// (Seedance Studio) — same "first reference image per locked character / all
// tagged locations" convention used here for image-generation consistency.
export async function loadReferenceDataUris(entities: ValidationEntity[]): Promise<string[]> {
  return Promise.all(
    entities.map(async (e) => {
      const ref = e.referenceImages[0];
      const bytes = await storage.get(ref.storageKey);
      if (!bytes) throw new OpenRouterError(`Reference image for ${e.name} is missing from storage.`);
      return `data:${ref.mimeType ?? "image/png"};base64,${bytes.toString("base64")}`;
    })
  );
}

async function loadAssetDataUri(asset: Asset): Promise<string | null> {
  const bytes = await storage.get(asset.storageKey);
  if (!bytes) return null;
  return `data:${asset.mimeType ?? "image/png"};base64,${bytes.toString("base64")}`;
}

async function runValidation(
  generatedImageDataUri: string,
  entities: ValidationEntity[],
  referenceDataUris: string[],
  modelId: string,
  // Continuity assertions folded into this existing vision call rather than
  // a separate critic — see continuity-engine-gap-2026-09 memory: ~$0.04/image
  // here vs ~$0.50/video clip for a dedicated one, and this call already
  // exists for every validated shot.
  previousShotImageDataUri: string | null,
  continuitySnapshot: { subject: string; state: string }[],
  continuityNotes: string | null,
  crossScene: boolean
): Promise<{ passed: boolean; notes: string }> {
  const continuityFacts = [...continuitySnapshot.map((e) => `${e.subject} — ${e.state}`), continuityNotes].filter(
    (v): v is string => Boolean(v)
  );
  const continuitySource = crossScene ? "the previous scene" : "the previous shot";
  const continuityLine =
    continuityFacts.length > 0 ? `\n\nContinuity to preserve from ${continuitySource}: ${continuityFacts.join("; ")}` : "";
  const previousShotLine = previousShotImageDataUri
    ? crossScene
      ? "\n\nThe image immediately after the generated shot image is the closing shot of the previous scene, included for identity/wardrobe/prop continuity comparison only — not lighting or setting, which may have changed."
      : "\n\nThe image immediately after the generated shot image is the previous shot, included for continuity comparison only."
    : "";
  const referenceLine =
    entities.length > 0
      ? `Reference images, in order after any previous-shot image: ${entities.map((e) => e.name).join(", ")}.`
      : "No locked reference images for this shot.";

  const userPrompt = `${referenceLine}${previousShotLine}${continuityLine}\n\nDoes the generated shot image stay consistent with the references (if any) and honor the continuity requirements (if any)? Respond with the required JSON.`;

  const raw = await callChatModel({
    modelId,
    systemPrompt: IMAGE_VALIDATION_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
    images: [generatedImageDataUri, ...(previousShotImageDataUri ? [previousShotImageDataUri] : []), ...referenceDataUris],
  });

  const parsed = validationResponseSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new OpenRouterError("Validation model returned an unexpected shape.");
  }
  return parsed.data;
}

function extFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

interface GenerateShotImageParams {
  shotId: string;
  promptModelId: string;
  imageModelId: string;
  // null when no IMAGE_VALIDATION model is configured — validation is
  // skipped entirely (advisory step only, never blocks generation).
  validationModelId: string | null;
  instructions?: string;
}

interface GenerateShotImageResult {
  image: SerializedShotImage;
  missingReferenceFor: string[];
}

export async function generateShotImage({
  shotId,
  promptModelId,
  imageModelId,
  validationModelId,
  instructions,
}: GenerateShotImageParams): Promise<GenerateShotImageResult> {
  const shot = await loadShotContext(shotId);
  const styleContext = buildStyleContext(shot.scene);

  // Same roster used for validation (locked characters + all tagged
  // locations), but now also fed into generation itself as image-to-image
  // conditioning — previously only used post-hoc to check the result,
  // which meant generation had no way to actually match a character's
  // locked look, only describe it in words.
  const validationTargets: (ValidationEntity & { kind: "character" | "location" })[] = [
    ...shot.scene.characters
      .filter((c) => c.isLocked)
      .map((c) => ({ name: c.name, referenceImages: c.referenceImages, kind: "character" as const })),
    ...shot.scene.locations.map((l) => ({ name: l.name, referenceImages: l.referenceImages, kind: "location" as const })),
  ];
  const missingReferenceFor = validationTargets.filter((t) => t.referenceImages.length === 0).map((t) => t.name);
  const validatable = validationTargets.filter((t) => t.referenceImages.length > 0);
  const referenceDataUris = validatable.length > 0 ? await loadReferenceDataUris(validatable) : [];
  // Names actually backed by an attached reference image — everyone else in
  // the scene gets flagged "[no reference image attached]" in the prompt
  // text instead of silently sharing someone else's image by position.
  const referencedEntityNames = new Set(validatable.map((t) => t.name));

  // Project-level style anchor rides along with generation (not validation —
  // it's an overall-look reference, not a named character/location to check
  // likeness against).
  const styleReferenceAsset = getProjectStyleReference(shot.scene);
  const styleReferenceDataUri = styleReferenceAsset ? await loadAssetDataUri(styleReferenceAsset) : null;

  // Previous shot (same scene, order - 1; or the closing shot of the
  // previous scene when this is a scene's first shot) rides along the same
  // way — a generation reference only, never a validation target (see
  // loadPreviousShot/buildContinuityBlock above).
  const prevShot = await loadPreviousShot(shot);
  const prevShotImageAsset = prevShot?.shot.images[0] ?? null;
  const prevShotImageDataUri = prevShotImageAsset ? await loadAssetDataUri(prevShotImageAsset) : null;
  const previousShotContext: PreviousShotContext | null = prevShot
    ? {
        description: prevShot.shot.description,
        continuityNotes: prevShot.shot.continuityNotes,
        continuity: parseContinuitySnapshot(prevShot.shot.continuity),
        hasImage: prevShotImageDataUri !== null,
        crossScene: prevShot.crossScene,
      }
    : null;

  const generationReferences = [
    ...(prevShotImageDataUri ? [prevShotImageDataUri] : []),
    ...(styleReferenceDataUri ? [styleReferenceDataUri] : []),
    ...referenceDataUris,
  ];
  // One label per entry above, same order — must stay in sync with
  // generationReferences so the numbered list in the prompt text actually
  // matches the images the model receives.
  const referenceManifest = [
    // Third of the three framing clauses (with IMAGE_PROMPT_SYSTEM_PROMPT and
    // buildContinuityBlock): "don't reuse its framing" is right only while
    // nothing else decides the framing. Once the Director has, the label must
    // not tell the model to avoid a framing it's simultaneously being told to
    // hold.
    ...(prevShotImageDataUri
      ? [
          previousShotContext?.crossScene
            ? "Previous scene's closing shot — identity/wardrobe/prop continuity reference only; the new scene likely has a different setting, so do not carry over its lighting or framing"
            : hasCameraDirection(shot)
              ? "Previous shot — continuity reference only (lighting, props, wardrobe); this shot's framing comes from the camera direction, not from this image"
              : "Previous shot — continuity reference only, do not reuse its framing",
        ]
      : []),
    ...(styleReferenceDataUri ? ["Overall visual style anchor"] : []),
    ...validatable.map(
      (t) => `${t.name} — locked ${t.kind} reference, match this ${t.kind === "character" ? "face and appearance" : "setting"} exactly`
    ),
  ];

  const prompt = await buildImagePrompt(
    shot,
    styleContext,
    instructions,
    promptModelId,
    previousShotContext,
    referenceManifest,
    referencedEntityNames
  );

  const projectId = shot.scene.story?.project.id ?? shot.scene.episode?.season.project.id;
  if (!projectId) throw new Error(`Shot ${shotId}'s scene has neither a story nor an episode parent.`);

  const startedAt = Date.now();
  let generated: { base64: string; mimeType: string; costUsd?: number };
  try {
    generated = await generateImage({ modelId: imageModelId, prompt, inputReferences: generationReferences });
  } catch (error) {
    await recordGenerationEvent({
      jobType: "IMAGE_GENERATION",
      provider: "openrouter",
      modelId: imageModelId,
      projectId,
      entityType: "SHOT",
      entityId: shotId,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await recordGenerationEvent({
    jobType: "IMAGE_GENERATION",
    provider: "openrouter",
    modelId: imageModelId,
    projectId,
    entityType: "SHOT",
    entityId: shotId,
    costUsd: generated.costUsd,
    durationMs: Date.now() - startedAt,
    success: true,
  });

  const buffer = Buffer.from(generated.base64, "base64");
  const ext = extFromMime(generated.mimeType);
  const fileName = `shot-image.${ext}`;
  const key = buildStorageKey("shots", shotId, fileName);
  await storage.put(key, buffer);

  let validation: { passed: boolean; notes: string } | null = null;
  const continuitySnapshot = previousShotContext?.continuity ?? [];
  const continuityNotesForValidation = previousShotContext?.continuityNotes ?? null;
  const hasContinuityToCheck = continuitySnapshot.length > 0 || continuityNotesForValidation !== null;
  // Runs whenever there's either a reference to check against or continuity
  // to check for — a scene with only unlocked characters but real carried
  // state (a prop picked up last shot) still gets checked, not just scenes
  // with locked reference images.
  if ((validatable.length > 0 || hasContinuityToCheck) && validationModelId) {
    try {
      const generatedDataUri = `data:${generated.mimeType};base64,${generated.base64}`;
      validation = await runValidation(
        generatedDataUri,
        validatable,
        referenceDataUris,
        validationModelId,
        prevShotImageDataUri,
        continuitySnapshot,
        continuityNotesForValidation,
        previousShotContext?.crossScene ?? false
      );
    } catch {
      // Advisory only — a broken/unconfigured validation step never blocks
      // the generated image from being saved and selected.
      validation = null;
    }
  }

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { shotId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        shotId,
        isSelected: true,
        prompt,
        modelId: imageModelId,
        createdBy: "AI",
        validationPassed: validation?.passed ?? null,
        validationNotes: validation?.notes ?? null,
        validationModelId: validation ? validationModelId : null,
      },
    });
  });

  return { image: serializeShotImage(asset), missingReferenceFor };
}

// User-uploaded shot image — same "slot" and isSelected takeover behavior
// as an AI-generated one (see generateShotImage above), just skipping the
// prompt/generation/validation steps.
export async function uploadShotImage(
  shotId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<SerializedShotImage> {
  const key = buildStorageKey("shots", shotId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { shotId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: key,
        fileName,
        mimeType,
        sizeBytes: buffer.byteLength,
        shotId,
        isSelected: true,
        createdBy: "USER",
      },
    });
  });

  return serializeShotImage(asset);
}

export async function selectShotImage(shotId: string, assetId: string): Promise<SerializedShotImage> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.shotId !== shotId) {
      throw new Error("Asset does not belong to this shot.");
    }
    await tx.asset.updateMany({ where: { shotId, isSelected: true }, data: { isSelected: false } });
    // reviewedAt: a human affirmed this take — see mobile-technical-plan-2026-09.md §5.2.
    const updated = await tx.asset.update({
      where: { id: assetId },
      data: { isSelected: true, reviewedAt: new Date() },
    });
    return serializeShotImage(updated);
  });
}

export async function deleteShotImage(shotId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.shotId !== shotId) {
    throw new Error("Asset does not belong to this shot.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}
