import type { CaptureKind, CaptureFileTarget, InboxItem } from "contract";
import { prisma } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";
import { mediaRef } from "@/lib/read/media";

// The mobile Inbox — mobile-app-ux-plan §5.4, mobile-technical-plan §5.3.
// One of exactly two mutations the BFF owns directly (the other is
// takes/:id/keep) rather than delegating to an existing web route, because
// neither concept has one. CaptureItem is owned by User, not Project (a
// capture can arrive with no project chosen yet — "which project" is
// exactly the question that hasn't been answered), so every function here
// takes userId and checks it itself; proxy.ts's RESOLVERS structurally
// cannot gate this the way project-scoped routes are gated.

const MAX_CAPTURE_BYTES = 25 * 1024 * 1024;

function toInboxItem(item: {
  id: string;
  kind: CaptureKind;
  text: string | null;
  transcript: string | null;
  sourceApp: string | null;
  projectId: string | null;
  createdAt: Date;
  media: { storageKey: string; mimeType: string | null; sizeBytes: number | null; metadata: unknown }[];
}): InboxItem {
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    transcript: item.transcript,
    sourceApp: item.sourceApp,
    media: item.media[0] ? mediaRef(item.media[0]) : null,
    projectId: item.projectId,
    createdAt: item.createdAt.toISOString(),
  };
}

const inboxSelect = {
  id: true,
  kind: true,
  text: true,
  transcript: true,
  sourceApp: true,
  projectId: true,
  createdAt: true,
  media: { select: { storageKey: true, mimeType: true, sizeBytes: true, metadata: true }, take: 1 },
} as const;

/** GET /api/mobile/v1/inbox — captured-but-unfiled items only (filedAt IS NULL). */
export async function getInboxItems(userId: string): Promise<InboxItem[]> {
  const items = await prisma.captureItem.findMany({
    where: { userId, filedAt: null },
    orderBy: { createdAt: "desc" },
    select: inboxSelect,
  });
  return items.map(toInboxItem);
}

/** POST /api/mobile/v1/inbox — LINK/TEXT branch: no bytes, no Asset. */
export async function createTextCapture(
  userId: string,
  input: { kind: "LINK" | "TEXT"; text: string; sourceApp?: string; projectId?: string }
): Promise<InboxItem> {
  const item = await prisma.captureItem.create({
    data: { userId, kind: input.kind, text: input.text, sourceApp: input.sourceApp, projectId: input.projectId },
    select: inboxSelect,
  });
  return toInboxItem(item);
}

/** POST /api/mobile/v1/inbox — IMAGE/AUDIO_NOTE branch: stores bytes and creates the CAPTURE-type Asset in the same transaction as the CaptureItem row. */
export async function createMediaCapture(
  userId: string,
  input: { kind: "IMAGE" | "AUDIO_NOTE"; buffer: Buffer; fileName: string; mimeType: string; text?: string; sourceApp?: string; projectId?: string }
): Promise<InboxItem> {
  if (input.buffer.byteLength > MAX_CAPTURE_BYTES) {
    throw new CaptureError("File must be under 25MB.");
  }

  const key = buildStorageKey("captures", userId, input.fileName);
  await storage.put(key, input.buffer);

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.captureItem.create({
      data: { userId, kind: input.kind, text: input.text, sourceApp: input.sourceApp, projectId: input.projectId },
    });
    await tx.asset.create({
      data: {
        type: "CAPTURE",
        storageKey: key,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.byteLength,
        captureItemId: created.id,
        createdBy: "USER",
      },
    });
    return tx.captureItem.findUniqueOrThrow({ where: { id: created.id }, select: inboxSelect });
  });

  return toInboxItem(item);
}

export class CaptureError extends Error {}

// A capture image can be filed into a real reference-image slot (a genuine
// Asset FK exists); a capture with no image (LINK/TEXT/AUDIO_NOTE) or a
// "scene" target has nowhere to re-point an Asset to — Scene has no generic
// "attached reference/note" FK in this schema — so those only stamp the
// CaptureItem's own filing metadata. Deliberately not inventing a new Scene
// FK here: that's a real schema decision for whoever builds the scene-notes
// feature this might become, not something to improvise inside a filing
// endpoint.
const IMAGE_TARGET_FIELD: Record<"character" | "location" | "projectStyle", string> = {
  character: "characterId",
  location: "locationId",
  projectStyle: "projectStyleId",
};

async function resolveTargetProjectId(target: { type: CaptureFileTarget; id: string }): Promise<string | null> {
  if (target.type === "projectStyle") return target.id;
  if (target.type === "character") {
    return (await prisma.character.findUnique({ where: { id: target.id }, select: { projectId: true } }))?.projectId ?? null;
  }
  if (target.type === "location") {
    return (await prisma.location.findUnique({ where: { id: target.id }, select: { projectId: true } }))?.projectId ?? null;
  }
  // scene
  const scene = await prisma.scene.findUnique({
    where: { id: target.id },
    select: { story: { select: { projectId: true } }, episode: { select: { season: { select: { projectId: true } } } } },
  });
  return scene?.story?.projectId ?? scene?.episode?.season.projectId ?? null;
}

/**
 * POST /api/mobile/v1/inbox/:id/file. Re-points the media Asset's FK (no
 * byte copy, no second asset row) when the capture has an image and the
 * target supports one; always stamps filedAt/filedIntoType/filedIntoId.
 * Manual-first is preserved literally — filing is a human action.
 */
export async function fileCaptureItem(
  userId: string,
  captureItemId: string,
  target: { type: CaptureFileTarget; id: string },
  role: "ADMIN" | "USER"
): Promise<void> {
  const item = await prisma.captureItem.findUnique({
    where: { id: captureItemId },
    select: { userId: true, kind: true, media: { select: { id: true }, take: 1 } },
  });
  if (!item || item.userId !== userId) throw new CaptureError("Capture not found.");

  const targetProjectId = await resolveTargetProjectId(target);
  if (!targetProjectId) throw new CaptureError("Target not found.");
  if (role !== "ADMIN") {
    const project = await prisma.project.findUnique({ where: { id: targetProjectId }, select: { ownerId: true } });
    if (!project || project.ownerId !== userId) throw new CaptureError("Target not found.");
  }

  const mediaAssetId = item.media[0]?.id;
  const fkField = target.type === "scene" ? null : IMAGE_TARGET_FIELD[target.type];

  if (mediaAssetId && fkField) {
    await prisma.asset.update({
      where: { id: mediaAssetId },
      data: { captureItemId: null, type: "REFERENCE_IMAGE", [fkField]: target.id },
    });
  } else if (mediaAssetId && !fkField) {
    throw new CaptureError('A "scene" target has no reference-image slot to file an image into — pick a character, location, or the project style instead.');
  }

  await prisma.captureItem.update({
    where: { id: captureItemId },
    data: { filedAt: new Date(), filedIntoType: target.type, filedIntoId: target.id },
  });
}

/** DELETE /api/mobile/v1/inbox/:id — deletes the row, its media Asset, and the stored bytes. */
export async function deleteCaptureItem(userId: string, captureItemId: string): Promise<void> {
  const item = await prisma.captureItem.findUnique({
    where: { id: captureItemId },
    select: { userId: true, media: { select: { id: true, storageKey: true } } },
  });
  if (!item || item.userId !== userId) throw new CaptureError("Capture not found.");

  for (const asset of item.media) {
    await storage.remove(asset.storageKey);
  }
  // onDelete: Cascade on Asset.captureItem (see schema.prisma) removes the
  // Asset rows automatically; deleting the CaptureItem is enough.
  await prisma.captureItem.delete({ where: { id: captureItemId } });
}
