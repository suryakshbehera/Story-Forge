import { prisma, type Asset } from "@/lib/db";
import { generateSpeech, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";

export interface SerializedAudioTake {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
}

export function serializeAudioTake(asset: Asset): SerializedAudioTake {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
  };
}

// A Scene's project is reached via Story or Episode→Season — resolving it
// here (rather than accepting a voice string from the client) is what makes
// narratorVoiceName actually authoritative: the caller can't override it.
async function resolveSceneProjectId(sceneId: string): Promise<string> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: { story: true, episode: { include: { season: true } } },
  });
  const projectId = scene.story?.projectId ?? scene.episode?.season.projectId;
  if (!projectId) throw new Error(`Scene ${sceneId} has neither a story nor an episode parent.`);
  return projectId;
}

// ── Narration — one voiceover script per Scene (Scene.narration, manually
// written, mirroring Episode.summary), with generated audio takes attached
// via Asset.narrationSceneId. Voice is always the project's narratorVoiceName
// — never a per-call override — so the narrator sounds the same in every
// scene of a story; see Project.narratorVoiceName in schema.prisma. ──────

export async function generateNarrationAudio({
  sceneId,
  modelId,
}: {
  sceneId: string;
  modelId: string;
}): Promise<SerializedAudioTake> {
  const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  if (!scene.narration?.trim()) {
    throw new OpenRouterError("Write a narration script for this scene before generating audio.");
  }

  const projectId = await resolveSceneProjectId(sceneId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.narratorVoiceName?.trim()) {
    throw new OpenRouterError(
      "Set a Narrator Voice in the Voice Settings panel above before generating narration audio."
    );
  }

  const generated = await generateSpeech({ modelId, text: scene.narration, voice: project.narratorVoiceName });
  const buffer = Buffer.from(generated.base64, "base64");
  const key = buildStorageKey("scenes", sceneId, "narration.wav");
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: { narrationSceneId: sceneId, isSelected: true },
      data: { isSelected: false },
    });
    return tx.asset.create({
      data: {
        type: "AUDIO_NARRATION",
        storageKey: key,
        fileName: "narration.wav",
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        narrationSceneId: sceneId,
        isSelected: true,
        prompt: scene.narration,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeAudioTake(asset);
}

export async function getSceneNarrationAudio(sceneId: string): Promise<SerializedAudioTake[]> {
  const assets = await prisma.asset.findMany({
    where: { narrationSceneId: sceneId },
    orderBy: { createdAt: "desc" },
  });
  return assets.map(serializeAudioTake);
}

export async function selectNarrationAudio(sceneId: string, assetId: string): Promise<SerializedAudioTake> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.narrationSceneId !== sceneId) {
      throw new Error("Audio take does not belong to this scene's narration.");
    }
    await tx.asset.updateMany({
      where: { narrationSceneId: sceneId, isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeAudioTake(updated);
  });
}

export async function deleteNarrationAudio(sceneId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.narrationSceneId !== sceneId) {
    throw new Error("Audio take does not belong to this scene's narration.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// ── Dialogue lines — ordered, per-Character spoken lines within a Scene,
// each with its own audio takes via Asset.dialogueLineId. ────────────────

const DIALOGUE_LINE_INCLUDE = {
  character: { select: { id: true, name: true, voiceName: true } },
  audio: { orderBy: { createdAt: "desc" as const } },
};

interface DialogueLineRow {
  id: string;
  sceneId: string;
  order: number;
  text: string;
  character: { id: string; name: string; voiceName: string | null };
  audio: Asset[];
}

export interface SerializedDialogueLine {
  id: string;
  sceneId: string;
  order: number;
  text: string;
  character: { id: string; name: string; voiceName: string | null };
  audio: SerializedAudioTake[];
}

export function serializeDialogueLine(line: DialogueLineRow): SerializedDialogueLine {
  return {
    id: line.id,
    sceneId: line.sceneId,
    order: line.order,
    text: line.text,
    character: line.character,
    audio: line.audio.map(serializeAudioTake),
  };
}

export async function getSceneDialogueLines(sceneId: string): Promise<SerializedDialogueLine[]> {
  const lines = await prisma.dialogueLine.findMany({
    where: { sceneId },
    orderBy: { order: "asc" },
    include: DIALOGUE_LINE_INCLUDE,
  });
  return lines.map(serializeDialogueLine);
}

export async function createDialogueLine({
  sceneId,
  characterId,
  text,
}: {
  sceneId: string;
  characterId: string;
  text: string;
}): Promise<SerializedDialogueLine> {
  const count = await prisma.dialogueLine.count({ where: { sceneId } });
  const line = await prisma.dialogueLine.create({
    data: { sceneId, characterId, text, order: count + 1 },
    include: DIALOGUE_LINE_INCLUDE,
  });
  return serializeDialogueLine(line);
}

export async function updateDialogueLine(
  id: string,
  fields: { characterId?: string; text?: string }
): Promise<SerializedDialogueLine> {
  const line = await prisma.dialogueLine.update({
    where: { id },
    data: fields,
    include: DIALOGUE_LINE_INCLUDE,
  });
  return serializeDialogueLine(line);
}

export async function deleteDialogueLine(id: string): Promise<void> {
  const assets = await prisma.asset.findMany({ where: { dialogueLineId: id } });

  await prisma.$transaction(async (tx) => {
    const line = await tx.dialogueLine.findUniqueOrThrow({ where: { id } });
    // Asset.dialogueLineId cascades in the DB — the rows above are gone once
    // this delete completes. Filesystem cleanup happens after the tx below.
    await tx.dialogueLine.delete({ where: { id } });

    const remaining = await tx.dialogueLine.findMany({
      where: { sceneId: line.sceneId },
      orderBy: { order: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      const expectedOrder = i + 1;
      if (remaining[i].order !== expectedOrder) {
        await tx.dialogueLine.update({ where: { id: remaining[i].id }, data: { order: expectedOrder } });
      }
    }
  });

  for (const asset of assets) {
    await storage.remove(asset.storageKey);
  }
}

export async function moveDialogueLine(id: string, direction: "up" | "down"): Promise<SerializedDialogueLine[]> {
  return prisma.$transaction(async (tx) => {
    const line = await tx.dialogueLine.findUniqueOrThrow({ where: { id } });
    const neighborOrder = direction === "up" ? line.order - 1 : line.order + 1;
    const neighbor = await tx.dialogueLine.findFirst({ where: { sceneId: line.sceneId, order: neighborOrder } });

    if (!neighbor) {
      const current = await tx.dialogueLine.findUniqueOrThrow({ where: { id }, include: DIALOGUE_LINE_INCLUDE });
      return [serializeDialogueLine(current)];
    }

    // Per-statement unique constraint isn't deferred — swap through a
    // sentinel order to avoid a transient collision on (sceneId, order).
    await tx.dialogueLine.update({ where: { id: line.id }, data: { order: -1 } });
    await tx.dialogueLine.update({ where: { id: neighbor.id }, data: { order: line.order } });
    const updatedLine = await tx.dialogueLine.update({
      where: { id: line.id },
      data: { order: neighbor.order },
      include: DIALOGUE_LINE_INCLUDE,
    });
    const updatedNeighbor = await tx.dialogueLine.findUniqueOrThrow({
      where: { id: neighbor.id },
      include: DIALOGUE_LINE_INCLUDE,
    });

    return [serializeDialogueLine(updatedLine), serializeDialogueLine(updatedNeighbor)];
  });
}

export async function generateDialogueAudio({
  dialogueLineId,
  modelId,
}: {
  dialogueLineId: string;
  modelId: string;
}): Promise<SerializedAudioTake> {
  const line = await prisma.dialogueLine.findUniqueOrThrow({
    where: { id: dialogueLineId },
    include: { character: true },
  });

  // Always the character's assigned voice — never a per-call override — so
  // one character sounds the same in every scene of a story. No fallback
  // default: an unset voice blocks generation rather than silently reusing
  // a generic voice that two different unassigned characters would share.
  if (!line.character.voiceName?.trim()) {
    throw new OpenRouterError(
      `Set a voice for ${line.character.name} in their Character profile before generating dialogue audio.`
    );
  }

  const generated = await generateSpeech({
    modelId,
    text: line.text,
    voice: line.character.voiceName,
  });
  const buffer = Buffer.from(generated.base64, "base64");
  const key = buildStorageKey("dialogue-lines", dialogueLineId, "line.wav");
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: { dialogueLineId, isSelected: true },
      data: { isSelected: false },
    });
    return tx.asset.create({
      data: {
        type: "AUDIO_DIALOGUE",
        storageKey: key,
        fileName: "line.wav",
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        dialogueLineId,
        isSelected: true,
        prompt: line.text,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeAudioTake(asset);
}

export async function selectDialogueAudio(dialogueLineId: string, assetId: string): Promise<SerializedAudioTake> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.dialogueLineId !== dialogueLineId) {
      throw new Error("Audio take does not belong to this dialogue line.");
    }
    await tx.asset.updateMany({ where: { dialogueLineId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeAudioTake(updated);
  });
}

export async function deleteDialogueAudio(dialogueLineId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.dialogueLineId !== dialogueLineId) {
    throw new Error("Audio take does not belong to this dialogue line.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// For the scene pages' initial SSR load — takes a scene queried with
// { narrationAudio: {...}, dialogueLines: { include: { character, audio } } }
// added to SCENE_INCLUDE and serializes those two relations the same way the
// API routes above do, so the client always gets the same shape regardless
// of whether the data arrived via initial page load or a fetch() call.
export function mapSceneVoiceData<
  T extends {
    narration: string | null;
    narrationAudio: Asset[];
    dialogueLines: DialogueLineRow[];
  },
>(scene: T) {
  return {
    ...scene,
    narrationAudio: scene.narrationAudio.map(serializeAudioTake),
    dialogueLines: scene.dialogueLines.map(serializeDialogueLine),
  };
}
