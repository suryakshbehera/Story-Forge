import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
const prisma = new PrismaClient();
const sceneId = "cmss46ve3000phbw4wkkajt76";
const batchId = randomUUID();
const asset = await prisma.asset.create({
  data: {
    type: "VIDEO_CLIP",
    storageKey: "test/fake-clip-for-ui-check.mp4",
    fileName: "fake-clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 12345,
    videoSceneId: sceneId,
    isSelected: true,
    createdBy: "AI",
    videoBatchId: batchId,
    videoSegmentOrder: 0,
    videoPairIndex: 0,
    modelId: "google/veo-3.1-lite",
    prompt: "A quiet street at dawn.\n\nCamera: pans left.\n\nThis is segment 1 of 1 — begin the motion described above.",
    qcPassed: false,
    qcNotes: "Looked frozen for ~4.8s of 6.0s despite requesting PAN_LEFT.",
    usedEndFrame: true,
  },
});
console.log("Created fake asset:", asset.id, "batch:", batchId);
await prisma.$disconnect();
