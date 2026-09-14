import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { assembleContext } from "@/lib/context/assemble";
import { SCENE_INCLUDE, mapScenesShots } from "@/lib/scenes";
import { mapSceneVoiceData } from "@/lib/voice";
import { mapSceneVideoData } from "@/lib/scene-video";
import { mapSceneAudioData } from "@/lib/scene-audio";
import { mapFinalVideos, mapSilentVideos } from "@/lib/video-assembly";
import { getActiveFailures, failuresByEntity, sceneVideoFailure, assemblyFailure, toErrorInfo } from "@/lib/generation-events";
import { EpisodeEditor } from "@/components/episode-editor";
import { SceneManager } from "@/components/scene-manager";
import { SilentAssemblyPanel } from "@/components/silent-assembly-panel";
import { AudioCuePlanPanel } from "@/components/audio-cue-plan-panel";
import { VideoAssemblyPanel } from "@/components/video-assembly-panel";
import { StoryChatPanel } from "@/components/story-chat-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TermHint } from "@/components/term-hint";
import { ArrowLeft } from "lucide-react";

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

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
}) {
  const { id: projectId, seasonId, episodeId } = await params;
  const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
  if (!episode || episode.seasonId !== seasonId) notFound();

  const [project, context, scenes, characters, locations, episodeVideo, failures] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    assembleContext({ projectId, episodeId }),
    prisma.scene.findMany({
      where: { episodeId },
      orderBy: { order: "asc" },
      include: { ...SCENE_INCLUDE, ...VOICE_INCLUDE, ...VIDEO_INCLUDE, ...AUDIO_INCLUDE },
    }),
    prisma.character.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: {
        finalVideos: { orderBy: { createdAt: "desc" } },
        silentVideos: { orderBy: { createdAt: "desc" } },
      },
    }),
    getActiveFailures(projectId),
  ]);

  const { silentVideos } = mapSilentVideos(episodeVideo);
  const hasSelectedSilentVideo = silentVideos.some((v) => v.isSelected);

  // Merge durable failure state onto the initial scene tree — see
  // story/scenes/page.tsx's identical block and generation-events.ts's
  // getActiveFailures for why this is a one-shot seed, not polling.
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
      <Link
        href={`/projects/${projectId}/seasons`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All seasons
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Episode</CardTitle>
          </CardHeader>
          <CardContent>
            <EpisodeEditor
              episodeId={episode.id}
              initialNumber={episode.number}
              initialTitle={episode.title ?? ""}
              initialSummary={episode.summary ?? ""}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Context Engine Preview</CardTitle>
            <p className="text-xs text-muted-foreground">
              Exactly what gets sent as Project Context for generation actions scoped to this episode —
              Story Bible, locked characters, locations, and prior episode summaries only.
            </p>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {context}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Story Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <StoryChatPanel
            projectId={projectId}
            episodeId={episodeId}
            applyTarget={{ kind: "episode", episodeId }}
            applyLabel="Episode Summary"
            initialContent={episode.summary ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scenes</CardTitle>
        </CardHeader>
        <CardContent>
          <SceneManager
            parentType="episode"
            parentId={episode.id}
            projectId={projectId}
            initialScenes={mapScenesShots(scenes).map(mapSceneVoiceData).map(mapSceneVideoData).map(mapSceneAudioData).map(withFailures)}
            characters={characters}
            locations={locations}
            initialNarratorVoiceName={project.narratorVoiceName}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Step 1 of 4 — Assemble without Audio
            <TermHint text="Stitches every scene's selected image/clip, in order, with no narration/dialogue/music/sfx — a picture-only preview to review before drafting an Audio Cue Plan below." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SilentAssemblyPanel
            parentType="episode"
            parentId={episodeId}
            projectId={projectId}
            initialSilentVideos={silentVideos}
            initialSilentVideoGenerationStartedAt={episodeVideo.silentVideoGenerationStartedAt?.toISOString() ?? null}
            initialError={toErrorInfo(assemblyFailure(failures, "ffmpeg-silent-assembly", episodeId))}
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
          <AudioCuePlanPanel parentType="episode" parentId={episodeId} hasSelectedSilentVideo={hasSelectedSilentVideo} />
        </CardContent>
      </Card>

      <VideoAssemblyPanel
        parentType="episode"
        parentId={episodeId}
        projectId={projectId}
        initialFinalVideos={mapFinalVideos(episodeVideo).finalVideos}
        initialFinalVideoGenerationStartedAt={episodeVideo.finalVideoGenerationStartedAt?.toISOString() ?? null}
        hasSelectedSilentVideo={hasSelectedSilentVideo}
        initialError={toErrorInfo(assemblyFailure(failures, "ffmpeg-final-assembly", episodeId))}
      />
    </div>
  );
}
