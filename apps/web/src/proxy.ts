import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, getUserFromToken } from "@/lib/auth";

// Central authorization gate for the whole app. Next.js 16 renamed
// middleware.ts to proxy.ts and — new in 16 — Proxy now defaults to the
// Node.js runtime (previously Edge-only), which is what makes this file
// viable at all: it can import Prisma directly and do real per-request
// authorization instead of a token-shape check alone.
//
// Default-deny: anything not explicitly listed in PUBLIC_PATHS requires a
// valid session, so a route nobody remembered to add to RESOLVERS below is
// still at minimum gated behind login rather than silently wide open.
//
// One caveat from Next's own docs: Server Actions ("use server" functions)
// can sometimes bypass Proxy's matcher, so Proxy alone isn't a substitute
// for checking auth at the resource for anything using that directive. This
// app has zero Server Action usage today (every mutation is a fetch() call
// from a "use client" component to an /api/* Route Handler), so it doesn't
// apply yet — but it will if that ever changes.

const PUBLIC_PATHS = ["/login", "/signup", "/api/auth/login", "/api/auth/signup"];

const ADMIN_ONLY_PREFIXES = ["/settings", "/api/admin"];

// AI model reads power every ModelSelect dropdown across the app (scene
// generation, video, voice, ...) — every authenticated user needs those so
// they see the admin's configured defaults, not an empty "not configured"
// state. Only mutating the registry (POST/PATCH/DELETE) is admin-only.
const ADMIN_WRITE_ONLY_PREFIXES = ["/api/ai-models"];

// Routes intentionally NOT in RESOLVERS below (login-only gate, no
// per-project ownership check):
//   - POST /api/projects — ownership is assigned at creation time in the
//     route itself (ownerId: user.id), nothing to check beforehand.
//   - GET /api/projects and "/" — list endpoints; proxy can't do row-level
//     filtering, the route/page itself adds `WHERE ownerId` unless admin.
//   - GET /api/storage/[...key] — Asset has 13 different optional parent
//     FKs (characterId, locationId, shotId, narrationSceneId,
//     dialogueLineId, videoSceneId, musicSceneId, sfxSceneId,
//     sourceImageId, storyVideoId, episodeVideoId, projectStyleId,
//     projectSourceId, projectCoverId), so generically resolving "which
//     project owns this file" is expensive for what's just serving image/
//     audio/video bytes. Deliberate, flagged trade-off: storage reads are
//     login-gated only (any authenticated user can fetch any key), not
//     per-owner — keys are unguessable, timestamp-prefixed, and never
//     surfaced in another user's UI, so the realistic exposure is low.

type Resolver = (id: string) => Promise<string | null>;

async function resolveScene(sceneId: string): Promise<string | null> {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    select: {
      story: { select: { projectId: true } },
      episode: { select: { season: { select: { projectId: true } } } },
    },
  });
  if (!scene) return null;
  return scene.story?.projectId ?? scene.episode?.season.projectId ?? null;
}

const RESOLVERS: Array<{ prefix: RegExp; resolve: Resolver }> = [
  // Project itself, and every /api/projects/[id]/... or /projects/[id]/...
  // sub-resource (story, story-bible, seasons, characters, locations,
  // style-reference, ingest, blueprint, cover-image, story-chat, ...) — the
  // id right after "projects/" IS the project id, so one entry covers all
  // ~20 nested routes at once.
  { prefix: /^\/(?:api\/)?projects\/([^/]+)/, resolve: (id) => Promise.resolve(id) },

  // Season, Character, Location each have projectId directly.
  {
    prefix: /^\/api\/seasons\/([^/]+)/,
    resolve: async (id) => (await prisma.season.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  },
  {
    prefix: /^\/api\/characters\/([^/]+)/,
    resolve: async (id) => (await prisma.character.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  },
  {
    prefix: /^\/api\/locations\/([^/]+)/,
    resolve: async (id) => (await prisma.location.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  },

  // Episode — one hop via its Season's projectId.
  {
    prefix: /^\/api\/episodes\/([^/]+)/,
    resolve: async (id) => {
      const episode = await prisma.episode.findUnique({
        where: { id },
        select: { season: { select: { projectId: true } } },
      });
      return episode?.season.projectId ?? null;
    },
  },

  // Story-by-own-id (/api/stories/[id]/*) — distinct from
  // /api/projects/[id]/story above: this id is the Story row's OWN id, and
  // Story has projectId directly.
  {
    prefix: /^\/api\/stories\/([^/]+)/,
    resolve: async (id) => (await prisma.story.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  },

  // Scene — dual-optional storyId/episodeId, resolve via whichever is set.
  { prefix: /^\/api\/scenes\/([^/]+)/, resolve: resolveScene },

  // Shot, DialogueLine — via their sceneId, reusing the Scene resolver.
  {
    prefix: /^\/api\/shots\/([^/]+)/,
    resolve: async (id) => {
      const shot = await prisma.shot.findUnique({ where: { id }, select: { sceneId: true } });
      return shot ? resolveScene(shot.sceneId) : null;
    },
  },
  {
    prefix: /^\/api\/dialogue-lines\/([^/]+)/,
    resolve: async (id) => {
      const line = await prisma.dialogueLine.findUnique({ where: { id }, select: { sceneId: true } });
      return line ? resolveScene(line.sceneId) : null;
    },
  },
];

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function deny(request: NextRequest, pathname: string, status: 401 | 403): NextResponse {
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
  }
  if (status === 401) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = rawToken ? await getUserFromToken(rawToken) : null;

  if (!user) {
    return deny(request, pathname, 401);
  }

  const isAdminOnlyPath = ADMIN_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAdminWriteOnlyPath =
    request.method !== "GET" && ADMIN_WRITE_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if ((isAdminOnlyPath || isAdminWriteOnlyPath) && user.role !== "ADMIN") {
    return deny(request, pathname, 403);
  }

  if (user.role !== "ADMIN") {
    const match = RESOLVERS.find((r) => r.prefix.test(pathname));
    if (match) {
      const resourceId = pathname.match(match.prefix)![1];
      const projectId = await match.resolve(resourceId);
      const project = projectId
        ? await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } })
        : null;
      if (!project || project.ownerId !== user.id) {
        return deny(request, pathname, 403);
      }
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);
  requestHeaders.set("x-user-role", user.role);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
