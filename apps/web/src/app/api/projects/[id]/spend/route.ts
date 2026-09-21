import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Per-episode spend rollup for the Seasons page's "Show spend" toggle.
//
// GenerationEvent only stores projectId (see the model comment in
// schema.prisma for why it deliberately has no relations), so an episode
// total has to be reconstructed by walking each event's entity back up to
// its scene:
//   SCENE         → scenes.episodeId
//   SHOT          → shots.sceneId       → scenes.episodeId
//   DIALOGUE_LINE → dialogue_lines.sceneId → scenes.episodeId
//   (no entityType) → the two ffmpeg assembly steps, which record the
//                     parent's own id as entityId (see generateSilentAssembly
//                     / assembleVideo) — for an Episode parent that id IS the
//                     episode, for a Story parent it matches no episode and
//                     drops out of the join.
// Scenes belonging to a Story rather than an Episode have a null episodeId
// and are excluded here; they're still counted in the project total below.
//
// costUsd is null for every provider that doesn't hand back a price —
// ElevenLabs and Sarvam don't, and OpenRouter's /audio/speech returns raw
// audio bytes with no cost header at all (checked live 2026-09-20), so VOICE
// spend can't be captured at call time the way the JSON image/chat endpoints
// allow — and for the local ffmpeg steps, which genuinely cost nothing. A bare
// dollar figure would understate real spend — `uncostedCalls` is returned
// alongside it so the UI can say how much of the work carries no price,
// rather than implying the total is complete.

interface EpisodeSpendRow {
  episodeId: string;
  usd: number;
  calls: number;
  uncostedCalls: number;
  failedCalls: number;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const episodes = await prisma.$queryRaw<EpisodeSpendRow[]>`
    WITH ev AS (
      SELECT "entityType", "entityId", "costUsd", success
      FROM generation_events
      WHERE "projectId" = ${projectId} AND "entityId" IS NOT NULL
    ),
    attributed AS (
      SELECT s."episodeId" AS episode_id, ev."costUsd", ev.success
        FROM ev JOIN scenes s ON s.id = ev."entityId"
        WHERE ev."entityType" = 'SCENE'
      UNION ALL
      SELECT s."episodeId", ev."costUsd", ev.success
        FROM ev JOIN shots sh ON sh.id = ev."entityId" JOIN scenes s ON s.id = sh."sceneId"
        WHERE ev."entityType" = 'SHOT'
      UNION ALL
      SELECT s."episodeId", ev."costUsd", ev.success
        FROM ev JOIN dialogue_lines d ON d.id = ev."entityId" JOIN scenes s ON s.id = d."sceneId"
        WHERE ev."entityType" = 'DIALOGUE_LINE'
      UNION ALL
      SELECT e.id, ev."costUsd", ev.success
        FROM ev JOIN episodes e ON e.id = ev."entityId"
        WHERE ev."entityType" IS NULL
    )
    SELECT episode_id AS "episodeId",
           COALESCE(SUM("costUsd"), 0)::float8 AS usd,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE "costUsd" IS NULL)::int AS "uncostedCalls",
           COUNT(*) FILTER (WHERE NOT success)::int AS "failedCalls"
    FROM attributed
    WHERE episode_id IS NOT NULL
    GROUP BY episode_id
  `;

  // Whole-project totals, including work that no episode rollup can claim
  // (story-parent scenes, and the text-planning job types that record no
  // entity at all) — so the page can show a project figure that doesn't
  // silently lose spend the per-episode rows don't cover.
  const [project] = await prisma.$queryRaw<
    { usd: number; calls: number; uncostedCalls: number; failedCalls: number }[]
  >`
    SELECT COALESCE(SUM("costUsd"), 0)::float8 AS usd,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE "costUsd" IS NULL)::int AS "uncostedCalls",
           COUNT(*) FILTER (WHERE NOT success)::int AS "failedCalls"
    FROM generation_events
    WHERE "projectId" = ${projectId}
  `;

  return NextResponse.json({ episodes, project });
}
