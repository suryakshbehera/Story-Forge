import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, mapScenesShots } from "@/lib/scenes";
import { mapSceneVoiceData } from "@/lib/voice";
import { mapSceneVideoData } from "@/lib/scene-video";
import { mapSceneAudioData } from "@/lib/scene-audio";
import { mapFinalVideos, mapSilentVideos } from "@/lib/video-assembly";
import { getActiveFailures, failuresByEntity, sceneVideoFailure, assemblyFailure, toErrorInfo } from "@/lib/generation-events";
import { SceneManager } from "@/components/scene-manager";
import { SilentAssemblyPanel } from "@/components/silent-assembly-panel";
import { AudioCuePlanPanel } from "@/components/audio-cue-plan-panel";
import { VideoAssemblyPanel } from "@/components/video-assembly-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TermHint } from "@/components/term-hint";

const VOICE_INCLUDE = {
  narrationAudio: { orderBy: { createdAt: "desc" as const } },
  dialogueLines: {
    orderBy: { order: "asc" as const },
    include: {
      character: { select: { id: true, name: true, voiceName: true } },
      audio: { orderBy: { createdAt: "desc" as const } },
    },
  },
};

const VIDEO_INCLUDE = {
  videoClips: { orderBy: { createdAt: "desc" as const } },
};

const AUDIO_INCLUDE = {
  music: { orderBy: { createdAt: "desc" as const } },
  sfx: { orderBy: { createdAt: "desc" as const } },
};

export default async function StoryScenesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { story: true } });
  if (!project) notFound();
  if (project.type !== "SINGLE" || !project.story) redirect(`/projects/${id}/story`);

  const [scenes, characters, locations, story, failures] = await Promise.all([
    prisma.scene.findMany({
      where: { storyId: project.story.id },
      orderBy: { order: "asc" },
      include: { ...SCENE_INCLUDE, ...VOICE_INCLUDE, ...VIDEO_INCLUDE, ...AUDIO_INCLUDE },
    }),
    prisma.character.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
    prisma.story.findUniqueOrThrow({
      where: { id: project.story.id },
      include: {
        finalVideos: { orderBy: { createdAt: "desc" } },
        silentVideos: { orderBy: { createdAt: "desc" } },
      },
    }),
    getActiveFailures(id),
  ]);

  const { silentVideos } = mapSilentVideos(story);
  const hasSelectedSilentVideo = silentVideos.some((v) => v.isSelected);

  // Merge durable failure state (audit 2.2's gap) onto the initial scene
  // tree — see generation-events.ts's getActiveFailures for what "active"
  // means and shot-manager.tsx's ShotItem.lastImageError for why this is a
  // one-shot seed, not something the panels poll for.
  const shotFailures = failuresByEntity(failures, "IMAGE_GENERATION", "SHOT");
  const narrationFailures = failuresByEntity(failures, "VOICE", "SCENE");
  const dialogueFailures = failuresByEntity(failures, "VOICE", "DIALOGUE_LINE");
  const musicFailures = failuresByEntity(failures, "MUSIC_GENERATION", "SCENE");
  const sfxFailures = failuresByEntity(failures, "SFX_GENERATION", "SCENE");
  function withFailures<T extends { id: string; shots: { id: string }[]; dialogueLines: { id: string }[] }>(scene: T) {
    return {
      ...scene,
      shots: scene.shots.map((shot) => ({ ...shot, lastImageError: toErrorInfo(shotFailures.get(shot.id)) })),
      dialogueLines: scene.dialogueLines.map((line) => ({ ...line, lastAudioError: toErrorInfo(dialogueFailures.get(line.id)) })),
      lastNarrationError: toErrorInfo(narrationFailures.get(scene.id)),
      lastVideoError: toErrorInfo(sceneVideoFailure(failures, scene.id, scene.shots.map((s) => s.id))),
      lastMusicError: toErrorInfo(musicFailures.get(scene.id)),
      lastSfxError: toErrorInfo(sfxFailures.get(scene.id)),
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <SceneManager
        parentType="story"
        parentId={project.story.id}
        projectId={id}
        initialScenes={mapScenesShots(scenes).map(mapSceneVoiceData).map(mapSceneVideoData).map(mapSceneAudioData).map(withFailures)}
        characters={characters}
        locations={locations}
        initialNarratorVoiceName={project.narratorVoiceName}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Step 1 of 4 — Assemble without Audio
            <TermHint text="Stitches every scene's selected image/clip, in order, with no narration/dialogue/music/sfx — a picture-only preview to review before drafting an Audio Cue Plan below." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SilentAssemblyPanel
            parentType="story"
            parentId={project.story.id}
            projectId={id}
            initialSilentVideos={silentVideos}
            initialSilentVideoGenerationStartedAt={story.silentVideoGenerationStartedAt?.toISOString() ?? null}
            initialError={toErrorInfo(assemblyFailure(failures, "ffmpeg-silent-assembly", project.story.id))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Step 2 of 4 — Audio Cue Plan
            <TermHint text="Watches the selected silent picture above and proposes narration, dialogue, music, and sfx per scene, grounded in what actually happens on screen — review and edit, then apply." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AudioCuePlanPanel parentType="story" parentId={project.story.id} hasSelectedSilentVideo={hasSelectedSilentVideo} />
        </CardContent>
      </Card>

      <VideoAssemblyPanel
        parentType="story"
        parentId={project.story.id}
        projectId={id}
        initialFinalVideos={mapFinalVideos(story).finalVideos}
        initialFinalVideoGenerationStartedAt={story.finalVideoGenerationStartedAt?.toISOString() ?? null}
        hasSelectedSilentVideo={hasSelectedSilentVideo}
        initialError={toErrorInfo(assemblyFailure(failures, "ffmpeg-final-assembly", project.story.id))}
      />
    </div>
  );
}
