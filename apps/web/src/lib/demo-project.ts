import { prisma } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";
import { makePlaceholderPng, makePlaceholderWav } from "@/lib/placeholder-media";

interface DemoScene {
  description: string;
  narration: string;
  shotDescription: string;
  color: [number, number, number];
}

// Three ILLUSTRATION scenes, deliberately small — this exists to show a new
// user what a *complete* scene looks like (shot image selected, narration
// audio selected) so the pipeline reads as concrete rather than abstract,
// not to be a compelling story. Placeholder media is generated on the fly
// (see lib/placeholder-media.ts) rather than bundling real sample files.
const DEMO_SCENES: DemoScene[] = [
  {
    description: "A lighthouse keeper climbs the spiral stairs at dawn, lamp oil in hand.",
    narration: "Every morning, before the gulls woke, Mara climbed the two hundred steps to trim the light.",
    shotDescription: "Wide shot of a lighthouse against a pink dawn sky.",
    color: [232, 178, 145],
  },
  {
    description: "The lamp catches, and its beam sweeps out over a calm, fog-covered sea.",
    narration: "The beam swept out over water that hadn't seen a ship in thirteen years.",
    shotDescription: "Close shot of the lighthouse lamp igniting, beam cutting through fog.",
    color: [140, 168, 196],
  },
  {
    description: "Far below, a small boat finally appears on the horizon, heading for shore.",
    narration: "And then, for the first time in thirteen years, something answered back.",
    shotDescription: "Wide shot of a small boat silhouette on the horizon, dawn light.",
    color: [96, 82, 122],
  },
];

export async function createDemoProject(ownerId: string): Promise<{ id: string }> {
  const project = await prisma.project.create({
    data: {
      name: "Demo: The Lighthouse Keeper",
      type: "SINGLE",
      ownerId,
      story: {
        create: {
          topic: "A lighthouse keeper's long wait for a ship",
          premise: "A lighthouse keeper's thirteen-year wait ends the morning a boat finally appears.",
          genre: "Quiet drama",
        },
      },
    },
    include: { story: true },
  });
  const storyId = project.story!.id;

  for (const [i, demoScene] of DEMO_SCENES.entries()) {
    const scene = await prisma.scene.create({
      data: {
        storyId,
        order: i + 1,
        description: demoScene.description,
        narration: demoScene.narration,
      },
    });

    const shot = await prisma.shot.create({
      data: { sceneId: scene.id, order: 1, description: demoScene.shotDescription },
    });

    const imageBuffer = makePlaceholderPng(768, 432, demoScene.color);
    const imageKey = buildStorageKey("shots", shot.id, "placeholder.png");
    await storage.put(imageKey, imageBuffer);
    await prisma.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: imageKey,
        fileName: "placeholder.png",
        mimeType: "image/png",
        sizeBytes: imageBuffer.byteLength,
        shotId: shot.id,
        isSelected: true,
        createdBy: "AI",
      },
    });

    const audioBuffer = makePlaceholderWav(3);
    const audioKey = buildStorageKey("scenes", scene.id, "placeholder.wav");
    await storage.put(audioKey, audioBuffer);
    await prisma.asset.create({
      data: {
        type: "AUDIO_NARRATION",
        storageKey: audioKey,
        fileName: "placeholder.wav",
        mimeType: "audio/wav",
        sizeBytes: audioBuffer.byteLength,
        narrationSceneId: scene.id,
        isSelected: true,
        createdBy: "AI",
      },
    });
  }

  return { id: project.id };
}
