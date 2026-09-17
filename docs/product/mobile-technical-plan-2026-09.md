# Narrata — Mobile App Technical Plan

**Owner:** `technical-architect`
**Created:** 2026-09-15
**Status:** v1. Decisions, not options. This document exists to unblock Phase M0.
**Companion:** [`./mobile-app-ux-plan-2026-09.md`](./mobile-app-ux-plan-2026-09.md)
(`ui-ux-engineer`) — the product/UX definition. This document answers its §10
asks 1–6 and nothing else.

Everything below was verified by reading the repo today: `apps/web/src/proxy.ts`,
`apps/web/src/lib/auth.ts`, `apps/web/src/lib/storage.ts`,
`apps/web/src/lib/generation-claims.ts`, `apps/web/src/lib/generation-events.ts`,
`apps/web/src/lib/project-status.ts`, `apps/web/src/lib/video-takes.ts`,
`apps/web/src/app/api/**` (110 route files), `packages/db/prisma/schema.prisma`,
`packages/db/prisma/migrations/`, the root `Dockerfile`, `pnpm-workspace.yaml`, and
the already-scaffolded `apps/mobile`.

---

## 0. Summary of decisions

| # | Ask | Decision |
|---|---|---|
| 1 | Read API | **Screen-shaped BFF at `/api/mobile/v1/*`, backed by a new shared read layer at `apps/web/src/lib/read/*`.** Not per-entity `GET`s. Web Server Components call the same functions directly; nothing about web changes. |
| 2 | Auth transport | **Bearer variant of the existing `Session` row.** New `POST /api/auth/token`; `proxy.ts` widens *credential extraction* only — the default-deny gate, the resolvers and the `x-user-id` injection are untouched. Zero schema change. |
| 3 | Media delivery | **One required change before M0.4: stream + `Range` + `ETag` in `GET /api/storage/[...key]`.** Signed URLs specced now, implemented at M5.1 (prefetch) or first non-trusted user. No CDN. |
| 4 | Schema gaps | `Asset.keptAt`, new `CaptureItem` + `Asset.captureItemId`, **plus `Asset.reviewedAt`, which the queue cannot exist without** (§5.2 — this is a finding, not a request), plus 8 missing indexes on `assets`. |
| 5 | Push trigger | **Hook the existing terminal-state path — but hang it off `recordGenerationEvent`, not `release*()`.** No queue. In-process 90s coalescing window + a 20-minute per-device floor. |
| 6 | Stack | **Confirmed** (Expo/Expo Router/TS at `apps/mobile`), with three corrections: SDK **57** not 54; "zero config change" is **false** for Metro and for the Dockerfile; **sharing Prisma types is rejected** in favour of a tiny `packages/contract`. |

**Two things the UX plan did not know, found while answering these.** Both change
Phase M2, so read §5.2 and §4.2 before scheduling.

1. **The review queue as specified cannot be built.** The queue is defined as "slots
   with unselected takes," but every generator in this codebase sets
   `isSelected: true` on the new asset inside the same transaction that deselects the
   old one. A freshly generated slot is *always* already selected. There is no
   durable record anywhere that a human agreed with a selection. §5.2 adds one
   nullable column to fix this.
2. **`assets` has no indexes at all.** Prisma does not create foreign-key indexes on
   PostgreSQL, and `grep -r "CREATE INDEX" packages/db/prisma/migrations` returns
   nothing touching `assets`. Every review-queue query is a sequential scan today.
   Harmless at current row counts, not harmless once the queue is polled from a
   phone.

---

## 1. Decision 1 — the read API

### 1.1 Understanding

110 `route.ts` files, 22 of them `GET`. 15 of 17 `page.tsx` files import `@/lib/db`
and query Prisma inline in a Server Component. Zero `"use client"` pages. The web
client never needed a read API because the server rendered the reads. A native
client cannot do that. Every mobile screen needs JSON that does not exist.

### 1.2 Options considered

| Option | Verdict |
|---|---|
| **Add `GET` to the ~110 existing per-entity routes** | **Rejected.** It is the largest of the three options (dozens of handlers), and it produces the worst client: the Review screen alone would need project + scene + shot + assets + validation + previous-shot-image, i.e. 5–6 sequential round trips over a cellular RTT, per card. Entity-shaped APIs push the join work onto the slowest link in the system. |
| **GraphQL / tRPC** | **Rejected.** Both solve "many clients, unknown query shapes." Narrata has one known client with ~7 known screens. Section 17 of the architect charter applies directly: a new runtime, a new build step and a new failure mode bought with a hypothetical requirement. |
| **Screen-shaped BFF at `/api/mobile/v1/*`** | **Chosen.** One request per screen, payload sized for cellular, versioned independently of the app-store release cycle, and free to change shape without touching a single web route. |

### 1.3 The part that makes the BFF safe: a shared read layer

A BFF's real risk is that it becomes a second, drifting copy of the read logic. The
mitigation is structural, and it is the actual deliverable here:

```
apps/web/src/lib/read/           ← NEW. Server-only. The one source of read truth.
  project-summaries.ts   getProjectSummaries(userId)      → Projects list
  project-detail.ts      getProjectDetail(projectId)      → Project detail
  review-queue.ts        getReviewQueue({userId, projectId?, limit, offset})
  activity.ts            getActivity({userId, projectId?})
  renders.ts             getRenders(projectId)
  media.ts               mediaRef(asset) → MediaRef        (the one place URLs are minted)

apps/web/src/app/api/mobile/v1/  ← NEW. Thin. ~10 lines per handler.
```

**Three rules, enforced in review:**

1. **No Prisma import in any `/api/mobile/v1/**` handler.** A handler parses params,
   calls one `lib/read/*` function, returns `NextResponse.json`. If a handler grows a
   query, the query is in the wrong file.
2. **The BFF owns no mutations**, with exactly two exceptions that are genuinely new
   concepts and have no web equivalent: `keep` (§5.1) and `inbox` (§5.3). Everything
   else — select a take, retake, upload a reference image — POSTs to the *existing*
   web route, which already has its authorization, its claim/409 logic and its
   provider dispatch. The BFF tells the client which path to call (§1.5,
   `actions`).
3. **Web keeps rendering on the server.** This is explicitly *not* a plan to convert
   `page.tsx` files into client components that fetch the BFF. Server Components may
   call `lib/read/*` directly — same function, no HTTP hop. The only refactor asked
   for is moving the body of `app/api/projects/[id]/jobs/route.ts` into
   `lib/read/activity.ts` and having the existing route call it, so the job tray and
   the Activity screen cannot diverge.

### 1.4 Versioning and the app-store constraint

`/v1` is in the path because an app-store client cannot be force-updated. Rules:
additive fields only within a version; a removed or retyped field means `/v2`, served
alongside `/v1` until telemetry says `/v1` is dead. `GET /api/mobile/v1/me` returns
`minClientVersion` as a cheap kill-switch for a build that must be replaced.

### 1.5 Concrete API shapes

Shared types live in `packages/contract` (§7.3) and are imported by both sides.

```ts
type Iso = string;                       // ISO-8601, UTC, always a string over JSON

interface MediaRef {
  url: string;                           // "/api/storage/<key>", app-relative
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;                  // from Asset.metadata when present
  height: number | null;
  durationSeconds: number | null;
}
```

**Slot identity — the load-bearing new concept.** There is no `GenerationJob` row and
no generic take container in this schema; a "thing that holds takes" is an implicit
(parent FK, asset type) pair. The BFF gives it a name, and deliberately reuses the
vocabulary that already exists in `lib/generation-claims.ts` so a slot maps 1:1 to a
claim, a `STALE_MS` threshold and a `STAGE_LABELS` string:

```ts
// === lib/generation-claims.ts already defines exactly these eight ===
type SlotKind =
  | "shotImage"       // entityId = Shot.id              → assets.shotId
  | "video"           // entityId = Scene.id             → assets.videoSceneId
  | "narration"       // entityId = Scene.id             → assets.narrationSceneId
  | "dialogueAudio"   // entityId = DialogueLine.id      → assets.dialogueLineId
  | "music"           // entityId = Scene.id             → assets.musicSceneId
  | "sfx"             // entityId = Scene.id             → assets.sfxSceneId
  | "silentAssembly"  // entityId = Story.id | Episode.id → assets.story/episodeSilentVideoId
  | "finalAssembly";  // entityId = Story.id | Episode.id → assets.story/episodeVideoId

type SlotId = `${SlotKind}:${string}`;   // "shotImage:clx9a…"
```

Add the FK mapping to `lib/generation-claims.ts` next to `STALE_MS` — one table, so
the slot vocabulary has exactly one home.

---

#### `GET /api/mobile/v1/me`

```json
{
  "user": { "id": "clx…", "email": "…", "role": "ADMIN" },
  "queue": { "waiting": 14 },
  "serverTime": "2026-09-15T10:04:00.000Z",
  "minClientVersion": "1.0.0"
}
```

#### `GET /api/mobile/v1/projects`

```json
{ "projects": [{
  "id": "clx…",
  "name": "Moonlit Crossing",
  "type": "SINGLE",
  "cover": { "url": "/api/storage/projects/…", "mimeType": "image/png", "sizeBytes": 91233, "width": 1024, "height": 1024, "durationSeconds": null },
  "updatedAt": "2026-09-15T09:12:00.000Z",
  "progress": {
    "storyDone": true,
    "characters": { "total": 3, "locked": 2 },
    "locations": { "total": 2 },
    "scenes":    { "total": 12 },
    "shots":     { "total": 24, "withImage": 18 },
    "voice":     { "narratedScenes": 4, "dialogueLinesVoiced": 11, "dialogueLinesTotal": 19 },
    "finalRenderCount": 0,
    "headline": "Scenes · 8 of 12 done"
  },
  "waitingCount": 6,
  "runningCount": 2,
  "webHref": "/projects/clx…"
}]}
```

**Implementation constraint, not optional:** do **not** loop `getProjectStatus()` over
the list. It issues ~10 queries per project (`cache()` dedupes within one request for
one project, not across projects) — 20 projects would be 200 queries for one screen.
`getProjectSummaries(userId)` must use `groupBy`/`count` over the whole owned set:
target ≤8 queries total regardless of project count. `getProjectStatus()` stays as-is
and remains what the *detail* screen uses.

#### `GET /api/mobile/v1/projects/:id`

```json
{
  "id": "clx…", "name": "Moonlit Crossing", "type": "SINGLE",
  "progress": { "…same shape as above…" },
  "hero": {
    "assetId": "clx…", "kind": "finalAssembly",
    "media": { "url": "/api/storage/…", "mimeType": "video/mp4", "sizeBytes": 39812734, "width": 1920, "height": 1080, "durationSeconds": 134 },
    "renderedAt": "2026-09-15T08:02:00.000Z"
  },
  "waitingCount": 6,
  "runningCount": 2,
  "rendersCount": 3,
  "nextStep": { "label": "Review 6 takes", "kind": "review" },
  "webHref": "/projects/clx…"
}
```

`hero` = newest `isSelected` `FINAL_VIDEO`, else newest `isSelected` `SILENT_VIDEO`,
else `null`. `nextStep.kind` ∈ `"review" | "web"`; when `"web"`, `label` names the
step and the client renders the honest handoff instead of a fake button.

#### `GET /api/mobile/v1/review` — the core screen

Query: `projectId?`, `limit` (default 20, max 50), `offset` (default 0).

```ts
interface ReviewSlot {
  slotId: SlotId;
  kind: SlotKind;
  entityId: string;
  media: "image" | "video" | "audio";
  project: { id: string; name: string };
  context: {                       // region A of the review card
    sceneId: string | null;
    sceneOrder: number | null;
    sceneTitle: string | null;
    shotOrder: number | null;
    shotCount: number | null;
    visualMode: "ILLUSTRATION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO" | null;
    label: string;                 // "Shot 2 of 6 · Image-to-Video"
  };
  takes: ReviewTake[];             // newest-first, capped at 8
  selectedTakeId: string | null;
  reviewedAt: Iso | null;          // null ⇒ this slot is why the item is in the queue
  compare: {                       // powers long-press compare (UX §5.1 / M2.3)
    selectedUrl: string | null;
    previousShotUrl: string | null;  // shot N−1's selected image, same scene
  };
  actions: {
    selectPath: string;            // "/api/shots/clx…/images/{assetId}/select"
    retakePath: string | null;     // "/api/shots/clx…/images/generate", null ⇒ not retakeable from mobile
    keepPath: string;              // "/api/mobile/v1/takes/{assetId}/keep"
    estimateJobType: "IMAGE_GENERATION" | "VIDEO_GENERATION" | "VOICE" | "MUSIC_GENERATION" | "SFX_GENERATION" | "VIDEO" | null;
  };
}

interface ReviewTake {
  id: string;                      // Asset.id
  media: MediaRef;
  isSelected: boolean;
  keptAt: Iso | null;
  createdAt: Iso;
  createdBy: "USER" | "AI";
  modelId: string | null;
  validationPassed: boolean | null;   // the critic verdict — UX §4.2 region C
  validationNotes: string | null;
  qcPassed: boolean | null;           // ffmpeg freeze check, video only
  qcNotes: string | null;
  clips: { url: string; segmentOrder: number | null; pairIndex: number | null }[] | null;
}
```

```json
{ "items": [ /* ReviewSlot[] */ ], "total": 14, "nextOffset": 20,
  "counts": { "waiting": 14, "byProject": [{ "projectId": "clx…", "waiting": 6 }] } }
```

Notes that matter for implementation:

- `actions.*Path` contain the literal placeholder `{assetId}`, substituted by the
  client. This is what keeps eight URL shapes out of the mobile codebase and keeps
  mutations on the existing, already-authorized web routes.
- `kind: "video"` takes are **multi-clip batches**, not single files (a scene's clip
  set is grouped by `Asset.videoBatchId` and ordered by `videoSegmentOrder`).
  Reuse `groupIntoTakes()` from `apps/web/src/lib/video-takes.ts` — do not re-derive
  it. `clips` is null for every non-video kind.
- **Offset pagination, not a cursor.** The queue is finite, ordered and typically tens
  of items; a cursor would be ceremony. Revisit if a queue ever exceeds ~200.
- **Language scoping:** v1 filters `Asset.language = null` (primary language only).
  Dubs are not reviewed on mobile v1 — the take history of a dub is deliberately
  independent (see `lib/localization.ts`), and mixing them into one queue would
  present two different films as one.

**Queue membership rule** (see §5.2 for why the column exists):

```
A slot is in the queue iff
  it has ≥1 Asset (language = null)                     AND
  its currently-selected Asset has reviewedAt IS NULL   AND
  its project is owned by the requesting user (or the user is ADMIN)
```

**Ordering** — `pipelineRank`, ascending, so judging in queue order walks the story
forward: `project.updatedAt desc` → `scene.order asc` → `shot.order asc` →
kind rank (`shotImage` 0, `video` 1, `narration` 2, `dialogueAudio` 3, `music` 4,
`sfx` 5, `silentAssembly` 6, `finalAssembly` 7).

#### `GET /api/mobile/v1/activity`

Query: `projectId?`.

```json
{
  "running":  [ { "jobType": "video", "stage": "Video generation", "label": "Scene 4 video",
                  "startedAt": "…", "etaSeconds": 118, "projectId": "clx…", "slotId": "video:clx…" } ],
  "needsYou": [ { "jobType": "MUSIC_GENERATION", "entityType": "SCENE", "entityId": "clx…",
                  "provider": "elevenlabs", "modelId": "…", "errorMessage": "rate limited",
                  "occurredAt": "…", "projectId": "clx…", "label": "Scene 2 music",
                  "retryPath": "/api/scenes/clx…/music/generate" } ],
  "doneToday":[ { "jobType": "IMAGE_GENERATION", "label": "Scene 3 · 6 images", "count": 6,
                  "at": "…", "projectId": "clx…", "deepLink": "/review?project=clx…" } ]
}
```

`running` is exactly `InFlightJob` from `lib/generation-claims.ts` plus `projectId`
and `slotId`. `needsYou` is `getActiveFailures()` plus a label and a retry path.
`doneToday` is a `groupBy` over successful `GenerationEvent` rows in the last 24h.
All three data sources already exist — this endpoint is assembly, not new logic.

#### `GET /api/mobile/v1/projects/:id/renders`

```json
{ "renders": [ { "assetId": "clx…", "kind": "finalAssembly", "isSelected": true,
                 "media": { "url": "…", "mimeType": "video/mp4", "sizeBytes": 39812734,
                            "width": 1920, "height": 1080, "durationSeconds": 134 },
                 "language": null, "createdAt": "…",
                 "downloadUrl": "/api/storage/…?download=1" } ] }
```

Dimensions/duration come from `Asset.metadata` where the assembly step wrote them and
are `null` otherwise — the client must render a render with no metadata, not crash.

#### Errors

`{ "error": "human-readable message" }` with the existing status conventions
(`400` bad input, `401` no session, `403` not yours, `404`, `409` already generating,
`502` provider failed). This matches every existing route; do not invent a new
envelope.

### 1.6 The authorization hole this opens, and its fix

`proxy.ts`'s `RESOLVERS` match `/^\/(?:api\/)?projects\/([^/]+)/`. **`/api/mobile/v1/projects/<id>`
does not match that regex.** Without a change, any logged-in user could read any
project through the BFF. Required, in the same commit as the first BFF route:

```ts
// proxy.ts — RESOLVERS, alongside the existing project entry
{ prefix: /^\/api\/mobile\/v1\/projects\/([^/]+)/, resolve: (id) => Promise.resolve(id) },
```

And the cross-project endpoints (`/me`, `/review`, `/activity`, `/inbox`, `/push/*`)
must filter by `ownerId` **inside the handler**, exactly as `GET /api/projects` and
`/` already do. Add them to the existing "Routes intentionally NOT in RESOLVERS"
comment block in `proxy.ts` — that block is how this codebase records this class of
decision, and an undocumented exception is how one gets lost.

### 1.7 Trade-offs

**Gained:** one round trip per screen; payloads sized for cellular; a read layer that
is testable without a browser; freedom to reshape mobile responses without touching
web; no rewrite of web.

**Sacrificed:** a second read surface exists. The mitigation is rule 1 of §1.3 —
handlers hold no queries — but it is a real, permanent maintenance obligation. The
BFF will also over-fetch for some screens relative to a perfectly-tuned query; that is
the price of screen-shaped endpoints and it is the right price on a phone.

**Effort:** ~4–6 dev-days for the read layer + 7 endpoints, of which the review queue
is roughly half. This is the number missing from the UX plan's §8 headline.

---

## 2. Decision 2 — mobile auth transport

### 2.1 Decision

**A bearer variant of the existing `Session` row. No new credential type, no JWT, no
schema change.**

The credential is already bearer-shaped: `createSession()` returns a raw
`randomBytes(32)` hex token and persists only its sha256 hash. What is
browser-specific is the *transport*, not the secret. So mobile gets the same row,
handed back in a response body instead of a `Set-Cookie`.

Rejected: a native cookie jar. It works, but it makes every later decision worse —
`sameSite`/`secure` semantics that mean nothing off-browser, cookie persistence that
differs across iOS/Android networking stacks, and no clean way to bind a session to a
device for push deregistration.

### 2.2 Endpoints

```
POST /api/auth/token                    ← PUBLIC (add to PUBLIC_PATHS, exact match)
  body: { email, password,
          device?: { platform: "ios" | "android", installId: string, name?: string } }
  200:  { token: "<64 hex chars>", expiresAt: Iso,
          user: { id, email, role } }
  401:  { error: "Invalid email or password" }
  429:  { error: "Too many attempts" }                  ← see §2.5

POST /api/auth/token/refresh            ← authed (bearer)
  200:  { token, expiresAt }            ← rotates: new Session row created, old deleted

POST /api/auth/token/revoke             ← authed (bearer)
  200:  { ok: true }                    ← destroys this session + deletes its PushDevice
```

`POST /api/auth/token` reuses `verifyPassword` + `createSession` verbatim and simply
does **not** call `setSessionCookie`. Roughly 25 lines.

**Why a separate endpoint rather than a flag on `/api/auth/login`:** returning a
session token in a JSON body is exactly the thing cookie `httpOnly` exists to prevent.
Keeping it on its own path means the web login route can never accidentally acquire
that behaviour through a mis-set request flag, and it gives mobile auth its own
rate-limit bucket and its own logs. Explicit beats conditional.

**Why revoke is `POST /api/auth/token/revoke` and not `DELETE /api/auth/token`:**
`PUBLIC_PATHS` is matched by exact pathname and is method-agnostic, so a `DELETE` on
the public login path would itself be public. A distinct path keeps it behind the
gate.

### 2.3 `proxy.ts` — the entire diff

```ts
function extractToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

// in proxy():
const rawToken = extractToken(request);
const user = rawToken ? await getUserFromToken(rawToken) : null;
```

Plus one line in `deny()`: if the request carried an `Authorization` header, always
return the JSON 401/403 branch rather than the redirect branch — a native client that
receives a 307 to `/login` and follows it gets an HTML page and a confusing parse
error instead of a clean "log in again."

**What is explicitly unchanged:** default-deny, `PUBLIC_PATHS`,
`ADMIN_ONLY_PREFIXES`, `ADMIN_WRITE_ONLY_PREFIXES`, every entry in `RESOLVERS`, the
per-project ownership check, and the trusted `x-user-id` / `x-user-role` injection.
Only credential *extraction* widens. This satisfies the UX plan's stated constraint
exactly: mobile flows through `proxy.ts` and cannot bypass the ownership resolvers,
because it reaches the same `user` object by the same function (`getUserFromToken`)
before any of that code runs.

**CSRF posture improves, it does not weaken.** A bearer token is only sent when the
client sets the header; unlike a cookie it is never attached automatically by a
browser to a cross-site request.

### 2.4 Session lifetime

Current: fixed 30 days, no sliding renewal. On a phone that is a silent logout every
30 days with no warning — acceptable on web (the user is at a keyboard), user-hostile
on mobile.

**Recommended, same commit, benefits web too:** lazy sliding renewal in
`getUserFromToken` — if `expiresAt` is less than 15 days away, extend it to
`now + 30 days`. That is at most one extra write per session per 15 days, and no
schema change. If you prefer not to touch the shared path, the mobile client can call
`POST /api/auth/token/refresh` on cold start instead; either is fine, but pick one
before M0.2 ships, because "logged out after a month for no visible reason" is the
kind of bug that gets filed as "the app is broken."

### 2.5 Two security items that become blocking with mobile

1. **Rate limiting.** There is none anywhere in this app, and `POST /api/auth/token`
   adds a *second* unauthenticated credential endpoint. This was already the flagged
   deploy blocker (static `SIGNUP_CODE` + no rate limits); mobile makes it worse, not
   differently-bad. **Required before mobile ships:** a shared in-memory
   fixed-window limiter applied to `/api/auth/login`, `/api/auth/signup` and
   `/api/auth/token` — e.g. 10 attempts per IP per 15 min, 5 per email per 15 min.
   In-memory is correct at one process on one VPS; it moves to Redis when there is a
   second process, not before.
2. **Token storage on device.** `expo-secure-store` (Keychain / Android Keystore).
   **Not** `AsyncStorage`, which is plaintext on disk. Non-negotiable, and it is one
   import.

### 2.6 One thing to know before the M0.2 spike

A React Native app has no `Origin`, so no CORS configuration is needed. But
`expo start --web` (react-native-web) *does* send one, and every BFF request from it
will fail CORS against the Next server. Run the M0.2 spike on a device or simulator,
not the web target — or add a dev-only `Access-Control-Allow-Origin` for
`http://localhost:8081`, guarded by `NODE_ENV !== "production"`.

---

## 3. Decision 3 — media delivery

### 3.1 What `GET /api/storage/[...key]` does today

```ts
const data = await storage.get(key);          // fs.readFile → whole file into the Node heap
return new NextResponse(new Uint8Array(data), {
  headers: { "Content-Type": …, "Cache-Control": "private, max-age=31536000, immutable" },
});
```

No `Range`, no `ETag`, no `Last-Modified`, no `Content-Length`, no streaming.

### 3.2 Decision: one required change, one deferred change, no CDN

**Required before M0.4 (the media spike) — stream, range, revalidate.** This is not a
mobile nicety:

- **Native players require `Range`.** iOS `AVPlayer` (behind `expo-video`) opens a
  media URL with a byte-range probe and relies on 206 responses to seek. Without
  range support the "watch the cut" screen (M3.4) cannot scrub, the audio scrubber
  (M2.4) cannot seek, and a 38 MB final render must download completely before the
  first frame. That is the difference between the core screens working and not.
- **`fs.readFile` is a server problem today, independent of mobile.** Each in-flight
  request for a final render holds the entire file in the Node heap. Two phones and a
  browser fetching one 40 MB render is ~120 MB of transient heap on a single small
  VPS, and the process has ffmpeg jobs running beside it.

```ts
// apps/web/src/app/api/storage/[...key]/route.ts — shape of the change
// 1. StorageProvider gains: stat(key) → { size, mtimeMs } | null
//                           stream(key, range?) → ReadableStream | null
//    (LocalDiskStorageProvider: fs.stat + createReadStream + Readable.toWeb —
//     the S3/R2 swap later maps onto the same two methods.)
// 2. ETag: `"${size}-${mtimeMs}"`; honour If-None-Match → 304 (empty body).
// 3. Range: parse "bytes=start-end" → 206 + Content-Range + Content-Length,
//    Accept-Ranges: bytes on every response; 416 on an unsatisfiable range.
// 4. Keep Cache-Control: private, max-age=31536000, immutable — correct, since
//    storage keys are timestamp-prefixed and never rewritten. "private" does not
//    block an on-device cache; it blocks shared proxies, which is what we want
//    while the route is session-gated.
```

Roughly 60 lines plus two methods on `StorageProvider`. Half a day.

**Deferred but specified now — signed URLs.** The per-owner gap (`proxy.ts`: "any
authenticated user can fetch any key") is a genuine, correctly-reasoned trade-off:
resolving "which project owns this key" from a bare storage key means checking 13
nullable FKs. But the BFF changes the economics, because it mints URLs from a context
where ownership is *already established* — `lib/read/media.ts` is called inside a
query that has already been scoped to the user's project. Signing there costs one
HMAC:

```
GET /api/storage/<key>?exp=<unixSeconds>&sig=<base64url(HMAC_SHA256(STORAGE_URL_SECRET, `${key}.${exp}`))>

proxy.ts: for /api/storage/*, a valid unexpired signature is sufficient authentication
          (no session required). Unsigned requests fall through to today's login gate.
Enabled only when STORAGE_URL_SECRET is set ⇒ zero behaviour change for web until then.
```

TTL 24h for images, 24h for video (long enough that an offline prefetch stays usable
on a train, short enough that a leaked URL dies). This also removes the need to thread
an `Authorization` header through every media consumer on the device, and it is the
precondition for ever putting a CDN in front of storage.

**When to implement it:** at **M5.1 (prefetch/offline)** or the first non-trusted user
on the system, whichever comes first. The UX plan's instinct is right — a persistent
on-device cache is exactly what changes the risk profile of "any logged-in user can
fetch any key," because the blast radius stops being a single request. Until then,
mobile sends the bearer token on media requests (`expo-image` and `expo-video` both
accept per-request headers; `expo-file-system.downloadAsync` accepts them too), which
is the same trust model as web and no weaker.

**CDN: no.** Single VPS, Stage 1, effectively zero users, and no measurement of media
egress exists yet. Adding a CDN now would be buying a solution to an unmeasured
problem. The signed-URL work above is the thing that makes a CDN a one-day change
later, which is the correct amount of future-proofing to do today.

### 3.3 What M0.4 should actually measure

Not "is it fast enough" in the abstract. Three numbers, on cellular, against the real
VPS: (1) time-to-first-frame for a full-bleed shot image (target < 400 ms warm,
< 1.5 s cold); (2) time-to-first-frame for a 720p clip with `Range` support in place;
(3) whether `expo-image`'s disk cache survives an app restart with
`Cache-Control: private, immutable`. If (3) fails, the cause will be the header, not
the network — and the fix is a client-side `expo-file-system` cache, not a CDN.

---

## 4. Decision 5 — the push trigger (answered before 4, because 4 depends on it)

### 4.1 Decision

**Hook the existing terminal-state path. Do not wait for a job queue.** The UX plan's
read is correct — but the hook goes somewhere slightly different from where it
proposes.

`release*()` (`releaseShotImageGeneration`, `releaseSceneVideoGeneration`, …) knows
only an entity id. It cannot tell success from failure, and it does not know the
project. `recordGenerationEvent()` in `lib/generation-events.ts` already receives
**`jobType`, `provider`, `modelId`, `projectId`, `entityType`, `entityId`, `success`
and `errorMessage`** — every field a notification needs — and it is already called at
exactly the terminal moment of all five metered job types plus both ffmpeg assembly
steps. It even already has the right failure posture ("deliberately swallows its own
failures … a telemetry write failing must never surface as a broken generation").

So: one new call, inside `recordGenerationEvent`, after the DB write.

```ts
// lib/generation-events.ts, end of recordGenerationEvent()
notifyGenerationFinished(input);   // fire-and-forget, never awaited, never throws
```

One call site covers every job type that exists and every job type added later. If a
future maintainer wants the two concerns visibly separate, the alternative is calling
`notifyGenerationFinished` next to each `recordGenerationEvent` call instead — same
data, seven call sites instead of one. I recommend the single call site.

### 4.2 Why not wait for a job queue

A queue solves *execution* (running work outside the request lifetime). Notification
needs *observation of a terminal state*, which this codebase already has, durably, in
`GenerationEvent`. Building a queue to get notifications would be solving a problem we
do not have in order to solve one we do. Per the architect charter's Section 17, a
queue needs its own concrete requirement — and when it arrives, `notifyGenerationFinished`
moves into the worker and **its call site does not change**.

### 4.3 Batching — Apple's ≤2–3/hour is a hard design input

A 6-shot scene is 6 separate POSTs from the web client (manual-first, per-step). Six
pushes for one batch is how notification permission gets revoked.

```
notifyGenerationFinished(input)
  └─ in-process Map<`${userId}|${projectId}|${jobType}`, { timer, count, sample, failures }>
     └─ 90s debounce window; each new event in the window resets nothing, just
        increments (the window is fixed from the first event, not sliding)
     └─ on flush: build one message, send, stamp PushDevice.lastNotifiedAt
```

Three message types only, matching the UX plan:

| Type | Body | Deep link |
|---|---|---|
| `ready` | "Moonlit Crossing · Scene 4: 6 images ready to review." | `/review?project=<id>&slot=<slotId>` |
| `failed` | "Scene 2 music failed — ElevenLabs rate limit." | `/activity?project=<id>` |
| `done` | "Final render ready · 2:14." | `/renders?project=<id>` |

Suppression rules, in order: device muted for this project → drop; inside quiet hours
(resolved with the device's stored UTC offset) → drop; `lastNotifiedAt` within 20
minutes → drop **unless** type is `failed` or `done` (rare, high-value, and the two a
user would be angry to miss). A 20-minute floor is exactly 3/hour.

**The in-process timer map dies on redeploy, and that is acceptable** — not by
hand-waving, but because the UX plan already made it a product rule: *"Notifications
are an accelerant, never the source of truth. Activity must be correct on open
regardless of what was delivered."* A dropped push costs nothing that Activity does
not immediately repair. Do not build an outbox table for this.

### 4.4 Delivery

Expo Push API directly: `POST https://exp.host/--/api/v2/push/send`, up to 100
messages per call, plain `fetch`. **Do not add `expo-server-sdk` to `apps/web`** —
the whole SDK is batching plus a receipts poller, and we need neither at this volume.
Handle exactly one ticket error: `DeviceNotRegistered` → delete the `PushDevice` row.

### 4.5 Endpoints

```
POST   /api/mobile/v1/push/register   { expoPushToken, platform, installId, name? }  → upsert by (userId, installId)
PATCH  /api/mobile/v1/push/prefs      { mutedProjectIds?, quietHoursStart?, quietHoursEnd?, timezoneOffsetMinutes? }
DELETE /api/mobile/v1/push/register   { installId }
```

Permission priming stays where the UX plan put it — after the first generation is
started, never on launch.

### 4.6 One infrastructure risk to check before M3.3

Retake is fire-and-forget: the phone POSTs `/generate`, the server runs the provider
call inline for 35 s – 10 min, and the phone stops listening. That works in Node (an
aborted client connection does not kill the handler unless the code observes
`req.signal`, and none does). **But a reverse proxy in front of the VPS will cut the
connection at its own read timeout** — nginx defaults to 60 s, and there is no proxy
config in this repo to inspect. If the proxy closes the upstream socket, Node may
abort the handler mid-generation and the user has paid for a dropped job. This already
affects web's long video renders today. Verify the deployed proxy's
`proxy_read_timeout` / equivalent is ≥ 900 s before M3.3, and write it down wherever
the deploy config lives.

---

## 5. Decision 4 — schema

One migration: `pnpm db:migrate --name add_mobile_review_capture_push`. Then
`pnpm db:generate`, then `pnpm --filter web build`.

### 5.1 `Asset.keptAt` — the ♡ Keep flag (asked for)

```prisma
model Asset {
  // …existing fields unchanged…

  // Mobile "♡ Keep" (mobile-app-ux-plan §4.2 region D). A take the human wants
  // to hold onto regardless of which one is currently selected — an unselected
  // take is otherwise indistinguishable from an abandoned one once its slot has
  // a dozen attempts. A nullable timestamp rather than a boolean, for the same
  // reason validationPassed carries information a flag cannot: "recently kept"
  // is orderable and "never kept" is distinguishable from "un-kept". Purely a
  // user annotation — nothing in generation, assembly or selection reads it.
  keptAt DateTime?
}
```

Endpoints (the BFF's first legitimate mutation — the concept has no web equivalent
yet):

```
POST   /api/mobile/v1/takes/:assetId/keep   → sets keptAt = now(), returns { keptAt }
DELETE /api/mobile/v1/takes/:assetId/keep   → sets keptAt = null
```

Ownership: `:assetId` is not project-resolvable by `proxy.ts` (that is precisely the
13-FK problem). The handler must resolve the asset's project itself via whichever of
its parent FKs is set and compare against `x-user-id`. Write that resolver **once**,
in `lib/read/asset-ownership.ts`, and reuse it — this is the one place mobile needs
key→project resolution, and it is also what §3.2's signed-URL work would build on.

### 5.2 `Asset.reviewedAt` — NOT asked for, and the review queue cannot exist without it

**The finding.** Every generator in this codebase does this, inside one transaction:

```ts
await tx.asset.updateMany({ where: { musicSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
await tx.asset.create({ data: { …, musicSceneId: sceneId, isSelected: true } });
```

(`lib/scene-audio.ts`, and the same pattern in `shot-images.ts`, `scene-video.ts`,
`voice.ts`, `video-assembly.ts`.) The newest take is **always** already selected.

The UX plan defines the Review queue as "slots across all projects that are waiting
for a human decision: a shot with unselected images, a scene with unselected video
takes…" — under the real data model, **that query returns the empty set, forever**.
Nothing anywhere records that a human agreed with a selection, so "waiting for a
decision" is currently not expressible.

```prisma
model Asset {
  // A human has explicitly affirmed this take for its slot — set by the
  // select*() helpers in lib/, which are what every "Use this take" path
  // already funnels through. Distinct from isSelected: isSelected is set by
  // the *generator* (newest take wins automatically), so on its own it cannot
  // tell "the machine picked this and nobody has looked" from "the human chose
  // this". That distinction is the entire Review queue (mobile-app-ux-plan
  // §4.2) and, later, the quality-gate signal for how often the first take is
  // the kept one. Null on a newly generated take, which is exactly what puts
  // its slot in the queue.
  reviewedAt DateTime?
}
```

**Implementation:** stamp `reviewedAt = new Date()` inside the eight `select*()`
helpers (`selectShotImage`, `selectSceneMusic`, `selectSceneSfx`, narration, dialogue,
video, silent, final). They are one-line changes in `lib/`, not in routes, so web gets
the behaviour for free and the mobile "Use this take" action — which posts to those
same existing endpoints — needs no special case. Selecting an already-selected asset
is already idempotent, so "the AI's pick was right, confirm it" works with no new
endpoint.

**Backfill, in the migration:**

```sql
UPDATE "assets" SET "reviewedAt" = "createdAt" WHERE "isSelected" = true;
```

Without this, every asset ever generated floods the queue on first launch.

**Known consequence, flagged to `ui-ux-engineer` rather than solved here:** a user who
works only on web and never clicks a select button (because the newest take was
already selected) will accumulate queue items they have de facto already accepted.
That is *mostly* the intended product loop — the phone is where you confirm — but web
should eventually grow the same affirmative "keep this take" affordance. Not a
blocker for M2.

**"Skip for now"** is client-local in v1: it advances the queue and commits nothing,
and the slot reappears next session. That matches "Skip commits nothing" exactly. If
skip should persist across devices later, it is a second nullable column
(`deferredAt`), not a redesign.

### 5.3 `CaptureItem` — the Inbox (asked for)

No existing table covers this. `Asset` requires a parent to belong to (13 FKs, all
pointing at things that exist); a capture by definition has no parent yet. `Project`
is wrong because a share-sheet capture happens before a project is chosen.

```prisma
enum CaptureKind {
  IMAGE
  AUDIO_NOTE
  LINK
  TEXT
}

// Captured-but-unfiled material from mobile (mobile-app-ux-plan §5.4): a photo,
// a 2am voice memo, a shared link, a pasted paragraph — arriving before the
// human has decided which character/location/scene it belongs to. Owned by
// User, not Project, because "which project" is exactly the question that has
// not been answered yet; projectId is an optional pre-filing hint when the
// capture started from inside a project screen.
//
// Manual-first is preserved literally: a CaptureItem is never auto-applied to
// anything. Filing is a human action, and it re-points the media Asset's FK
// (captureItemId → characterId/locationId/projectStyleId) rather than copying
// bytes, so a filed capture becomes an ordinary reference image with no
// duplicate storage and no second lineage concept.
model CaptureItem {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  projectId String?
  project   Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)

  kind CaptureKind

  // LINK: the URL. TEXT: the shared text. IMAGE/AUDIO_NOTE: an optional caption.
  text String? @db.Text
  // AUDIO_NOTE only, if/when speech-to-text is run over it. Never blocks filing;
  // a voice memo is useful to its author untranscribed.
  transcript String? @db.Text
  // Which app the share sheet says it came from, when it says. Diagnostic only.
  sourceApp String?

  // Set when the human files it. The row is KEPT, not deleted, so "where did
  // this reference image come from" stays answerable — same reasoning as
  // Project.sourceDocuments being kept after ingestion.
  filedAt       DateTime?
  filedIntoType String?   // "character" | "location" | "projectStyle" | "scene"
  filedIntoId   String?

  media Asset[] @relation("CaptureItemMedia")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, filedAt])
  @@map("capture_items")
}

// On Asset — one more named FK, following this model's existing "one nullable
// FK per slot an Asset can fill" convention rather than a generic parent.
model Asset {
  captureItemId String?
  captureItem   CaptureItem? @relation("CaptureItemMedia", fields: [captureItemId], references: [id], onDelete: Cascade)
}

enum AssetType {
  // …existing values unchanged…
  // Bytes captured on a phone that have not been filed into a slot yet. Becomes
  // REFERENCE_IMAGE (or similar) at filing time, when its FK is re-pointed.
  CAPTURE
}
```

Endpoints:

```
GET    /api/mobile/v1/inbox                  → { items: [{ id, kind, text, transcript, sourceApp,
                                                            media: MediaRef | null, projectId,
                                                            createdAt }] }   (filedAt IS NULL)
POST   /api/mobile/v1/inbox                  multipart (IMAGE/AUDIO_NOTE) or JSON (LINK/TEXT)
POST   /api/mobile/v1/inbox/:id/file         { target: { type: "character"|"location"|"projectStyle"|"scene", id } }
DELETE /api/mobile/v1/inbox/:id              deletes row + media asset + stored bytes
```

`POST /inbox/:id/file` is a single transaction: re-point `Asset.captureItemId → null`
and set the target FK, change `Asset.type`, stamp `filedAt`/`filedIntoType`/
`filedIntoId`. No byte copy, no second asset row.

**Ownership exception, must be documented in `proxy.ts`:** `CaptureItem` is owned by a
`User`, not a `Project`, so `RESOLVERS` structurally cannot gate it. Every
`/api/mobile/v1/inbox/*` handler checks `item.userId === x-user-id` itself. Add this
to the existing "Routes intentionally NOT in RESOLVERS" comment block — it is the
second exception in the codebase after `/api/storage`, and an exception that is not
written down becomes a hole.

Upload guard: cap multipart bodies at 25 MB in the handler. Next route handlers buffer
the body; a phone video shared from Photos can be far larger than any reference image
this product needs.

### 5.4 `PushDevice` (from §4)

```prisma
// One row per app install, not per session — a push token outlives a session
// and must survive token refresh/rotation. Deregistered on DeviceNotRegistered
// from Expo's push receipts, and on explicit logout.
model PushDevice {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  expoPushToken String @unique
  platform      String  // "ios" | "android"
  installId     String  // stable per install, generated client-side, kept in SecureStore
  name          String?

  // Per-project mute (mobile-app-ux-plan §5.3). A scalar array rather than a
  // join table: it is read as a whole on every send, never filtered or joined
  // on in SQL, and is bounded by how many projects one person owns — same
  // reasoning as Character.voicesByLanguage being Json.
  mutedProjectIds String[] @default([])

  // Quiet hours in the device's own local clock; the offset is stored so the
  // server can resolve "is it 2am for this user" without a timezone database.
  quietHoursStart       Int?  // 0–23
  quietHoursEnd         Int?  // 0–23
  timezoneOffsetMinutes Int?

  // Backs the ≤3/hour floor. Stamped on every successful send.
  lastNotifiedAt DateTime?
  lastSeenAt     DateTime @default(now())
  createdAt      DateTime @default(now())

  @@unique([userId, installId])
  @@map("push_devices")
}
```

### 5.5 Indexes on `assets` — not asked for, and the queue needs them

`packages/db/prisma/migrations/` contains **no `CREATE INDEX` touching `assets`**.
Prisma does not create foreign-key indexes on PostgreSQL. `assets` therefore has a
primary key and nothing else, while carrying 15 nullable FKs that every screen in the
product filters on.

```prisma
model Asset {
  // …
  // The six take "slots" the review queue and every take panel filter by. The
  // composite with isSelected matters because the overwhelmingly common query
  // is "the selected take for this slot", which these serve as an index-only
  // lookup.
  @@index([shotId, isSelected])
  @@index([narrationSceneId, isSelected])
  @@index([dialogueLineId, isSelected])
  @@index([videoSceneId, isSelected])
  @@index([musicSceneId, isSelected])
  @@index([sfxSceneId, isSelected])
  // Reference images are re-read on EVERY image and video generation call
  // (lib/shot-images.ts pulls scene.characters.referenceImages inline), so
  // these two are the hottest unindexed columns in the schema today.
  @@index([characterId])
  @@index([locationId])
}
```

Eight indexes, on a table written a handful of times per generation and read
constantly. The render/silent-video FKs (`storyVideoId`, `episodeVideoId`,
`storySilentVideoId`, `episodeSilentVideoId`) are deliberately **not** included —
those tables are small and the renders shelf is a rare query; add them when a slow
query says so, not before.

---

## 6. Data flow

```
Cold start
  SecureStore token ──► GET /api/mobile/v1/me
                          └─ proxy.ts: Authorization: Bearer → getUserFromToken → Session row
                                       → x-user-id / x-user-role injected
                             lib/read/*  → Prisma → DTO

Review
  GET /api/mobile/v1/review?limit=20
     └─ lib/read/review-queue.ts
          slots where selected take reviewedAt IS NULL, language IS NULL, owned by user
          ordered by pipelineRank
     └─ media URLs minted by lib/read/media.ts
  ── user taps "Use this take" ──►
  POST /api/shots/<id>/images/<assetId>/select      ← EXISTING web route, unchanged
     └─ selectShotImage() sets isSelected + reviewedAt
     └─ slot leaves the queue on next fetch

Retake (fire-and-forget)
  POST /api/shots/<id>/images/generate               ← EXISTING web route, unchanged
     └─ claimShotForImageGeneration() → 409 if already running
     └─ provider call (inline, 35s–10min)
     └─ recordGenerationEvent(...)  ──► notifyGenerationFinished(...)
                                          └─ 90s coalescing window
                                          └─ quiet hours / mute / 20-min floor
                                          └─ Expo Push API ──► APNs / FCM ──► device
     └─ finally: releaseShotImageGeneration()
  device wakes on push → deep link /review?project=…&slot=… → GET /api/mobile/v1/review

Media
  <Image src="/api/storage/<key>">  (+ Authorization header, or ?exp=&sig= later)
     └─ proxy.ts: login-gated (or signature-gated)
     └─ storage route: stat → ETag → 304, or Range → 206 stream
```

---

## 7. Decision 6 — the stack

### 7.1 Confirmed

**React Native via Expo, Expo Router, TypeScript, at `apps/mobile`.** Correct for this
product and this team: one engineer, two platforms, a native share extension and push
as day-one requirements, and no native module in the plan that Expo does not already
wrap.

**EAS Build from day one** — confirmed and correctly identified. Push requires a
development build (not Expo Go), and so does the iOS Share Extension (M4.1). Treat the
first successful dev build on both platforms as part of M0.3's definition of done, not
as a Phase M1 task; discovering signing/provisioning problems in week 6 is the classic
way this slips.

**Library choices to lock now** (they shape the spikes):

| Need | Package | Note |
|---|---|---|
| Token storage | `expo-secure-store` | Keychain/Keystore. Never `AsyncStorage`. |
| Images + disk cache | `expo-image` | Supports per-request headers and a persistent disk cache — both required by §3. |
| Video | `expo-video` | `expo-av` is retired as of SDK 54. Do not start on it. |
| Audio | `expo-audio` | Same; gives background playback + lock-screen transport for M2.4. |
| Push | `expo-notifications` | Client side only; the server talks to Expo's HTTP API directly (§4.4). |
| Prefetch / save | `expo-file-system` | `downloadAsync` accepts headers. |
| Save to Photos | `expo-media-library` | M3.2. |
| Share sheet | `expo-sharing` (out) + native share extension (in) | The *in* direction is M4.1 and is not an Expo module — it is a config plugin + native target. |
| Haptics | `expo-haptics` | |

### 7.2 Corrected: "zero config change" is true for pnpm, false twice elsewhere

The claim that `apps/*` already matches `apps/mobile` is correct — but two other
things do break, and both bite before M0.1 finishes.

**(a) Metro needs a monorepo config.** pnpm's isolated node-linker puts real packages
in `<root>/node_modules/.pnpm` and symlinks into `apps/mobile/node_modules`. Metro
watches only the project root by default and cannot resolve through those symlinks to
files outside it. Required:

```js
// apps/mobile/metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
module.exports = config;
```

**Correction, verified live during implementation (2026-09-15):** the
`disableHierarchicalLookup: true` originally specified here (now removed above)
**breaks the build** outright, not just a risk of duplicate React instances. pnpm's
isolated node-linker resolves a package's OWN transitive dependencies (e.g. `expo`'s
dependency on `expo-modules-core`, or `expo-router`'s on `@expo/metro-runtime`) via
hierarchical walk-up through `node_modules/.pnpm/<pkg>/node_modules`, not via a flat
top-level `node_modules` — disabling that lookup broke each of those one at a time as
`expo export -p web` hit them. The `nodeModulesPaths` entry above is additive (it's
what resolves `contract` from the workspace root) and stays; hierarchical lookup must
stay on. Also needed, found only by hitting the resolution error, not implied by
anything above: `@expo/metro-runtime` as an explicit dependency for the web target.

If that still fights (duplicate React instances is the usual symptom), the fallback is
`node-linker=hoisted` in a root `.npmrc` — but that changes the install layout for
`apps/web` too, so it must be validated against a full Docker image build before it is
committed, not after.

**(b) The production Docker build is at risk.** The `deps` stage copies only
`apps/web/package.json` and `packages/db/package.json`, then runs
`pnpm install --frozen-lockfile`. Once `apps/mobile` is in the lockfile as a workspace
importer, that install sees a lockfile describing a project that is not on disk.
Required change, and it must be verified by actually building the image:

```dockerfile
COPY apps/web/package.json    ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json   # NEW — lockfile importer must exist
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile --filter web... --filter db...   # NEW — don't install RN deps
```

Also add `apps/mobile` to `.dockerignore` (the `build` stage's `COPY . .` otherwise
drags the RN source into the web image), and do **not** add mobile to the root
`build` script — `pnpm build` must stay "build the web app."

**(c) SDK version.** The UX plan assumed "SDK 54-era"; the scaffold on disk is
**Expo SDK 57 / React Native 0.86 / React 19.2.3**. Confirm 57 — it is current, it is
what is already installed, and it is the version whose `expo-video`/`expo-audio`
guidance is written above. Note the React minor differs from `apps/web` (19.2.8);
that is fine and expected — they are separate bundles with separate `node_modules`,
and nothing is shared at runtime.

### 7.3 Rejected: sharing generated Prisma types with the mobile app

`packages/db`'s entry point is:

```ts
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
export * from "@prisma/client";
```

It **instantiates a database client at module load** and re-exports a Node-only
package containing a native query engine. Three problems: a single non-type import
anywhere in the mobile tree pulls that into a React Native bundle; Prisma enums are
runtime values, not types, so `AssetType.CAPTURE` cannot be erased; and a Prisma row
type is the wrong contract anyway — over JSON a `DateTime` is a string, an
`Asset.storageKey` has become a URL, and half the row's 15 FKs are irrelevant to the
client.

**Instead:**

```
packages/contract/
  package.json      { "name": "contract", "main": "src/index.ts", "types": "src/index.ts" }
  src/index.ts      pure types + string-literal unions. ZERO runtime dependencies.
```

Same raw-TypeScript, no-build convention `packages/db` already uses, so both Next's
transpiler and Metro's babel handle it. `apps/web` imports it to type BFF return
values (so a drifting handler fails `pnpm --filter web build`); `apps/mobile` imports
it for its client. It holds `MediaRef`, `SlotKind`, `SlotId`, `ReviewSlot`,
`ReviewTake`, the project/activity/renders DTOs, and the handful of enum unions mobile
displays (`SceneVisualMode`, `AssetType` subset). One file to start.

The cheaper alternative — hand-copying the types into `apps/mobile` — is rejected
because the whole value of one TypeScript monorepo is that a BFF response shape change
breaks the mobile build at compile time rather than at a user's fingertip.

---

## 8. Implementation order

Strictly sequenced; each step is independently shippable and leaves the tree green.

| # | Work | Unblocks | Est. | Status |
|---|---|---|---|---|
| **B0** | `packages/contract` skeleton + `metro.config.js` + Dockerfile `deps` fix + `.dockerignore` entry. Verify with `docker build .` and `pnpm --filter web build`. | everything | 0.5d | **Shipped 2026-09-15**, incl. `docker build --target deps` (real, if network-slow in this environment) and `pnpm --filter web build`'s typecheck. `metro.config.js` needed a live correction — see §7.2a. |
| **B1** | `POST /api/auth/token` + `extractToken()` in `proxy.ts` + `deny()` JSON branch + rate limiter on `/api/auth/*`. | **M0.2** | 1d | **Shipped 2026-09-15**, incl. `/token/refresh` + `/token/revoke` + sliding session renewal. Live-verified end-to-end via curl (issue/use/refresh/revoke/rate-limit-trip), not just typechecked. |
| **B2** | Migration: `Asset.keptAt`, `Asset.reviewedAt` (+ backfill), `Asset` indexes, `CaptureItem`, `Asset.captureItemId`, `AssetType.CAPTURE`, `PushDevice`. Stamp `reviewedAt` in the eight `select*()` helpers. `pnpm db:generate`. | M2, M4, M1 | 1d | **Shipped 2026-09-15.** Migration applied to the local dev DB (304 existing rows backfilled); `prisma migrate deploy` (the exact production command) verified clean against the hand-edited migration file. |
| **B3** | `lib/read/*` + `GET /api/mobile/v1/{me,projects,projects/:id}` + the `RESOLVERS` entry + the `proxy.ts` exception comments. | **M0.1** | 2d | **Shipped 2026-09-15.** Live-verified against real project data in the dev DB, including a SERIES project's cross-episode `hero`/`rendersCount`. |
| **B4** | Storage route: stream + `Range` + `ETag`/304; `StorageProvider.stat/stream`. | **M0.4** | 0.5d | **Shipped 2026-09-15.** Live-verified against a real 52MB render — full/range/suffix-range/open-range/304/416. Found and fixed a real bug: an unsatisfiable range 500'd instead of 416'ing. |
| **B5** | `GET /api/mobile/v1/review` (slot construction, the hard one) + `/takes/:id/keep`. | M2 | 2.5d | **Shipped 2026-09-15.** All 8 slot kinds implemented as separate concrete query functions (not one generic parameterized by kind — an earlier attempt at that needed unsafe casts to read Prisma's per-relation result shape back out; split instead). Live-verified against real DB rows for shotImage (+ compare.previousShotUrl), video (real 4-clip batch via `groupIntoTakes()`), and finalAssembly (episode path) — not just empty-queue smoke tests. Found+fixed a real bug: the keep endpoint's admin bypass skipped existence checking, so a bad assetId 500'd instead of 404'ing. |
| **B6** | `GET /api/mobile/v1/activity` (refactor `api/projects/[id]/jobs` onto `lib/read/activity.ts`) + `/projects/:id/renders`. | M1.3, M3.1 | 1d | **Shipped 2026-09-15.** Refactor verified two ways: the *existing* web job tray endpoint re-tested and still correct after the move, and a synthetic failure row inserted directly in the DB to prove `needsYou`'s label/retryPath resolution (`describeFailure`) actually works — `doneToday`/`running` had no real data to test against live. |
| **B7** | `lib/notify.ts` + the `recordGenerationEvent` hook + coalescing + `/push/*` endpoints. | M1.1, M1.2 | 1.5d | **Shipped 2026-09-15**, and unusually thoroughly live-verified for async/timing logic — see the mobile-app-ux-plan's M1 checklist entry for what was actually proven, not just typechecked. |
| **B8** | `/api/mobile/v1/inbox/*` + filing transaction. | M4.3, M4.4 | 1.5d | **Shipped 2026-09-15.** Live-verified: a real multipart image upload, a real filing transaction into a real character (confirmed via direct DB inspection, not just a 200), and two real rejections (an image filed into a "scene" target, which has no reference-image FK to re-point — and a bogus target id) both 400 cleanly with explanatory messages. |
| **B9** | *(deferred)* Signed storage URLs + `STORAGE_URL_SECRET` + `proxy.ts` signature branch. | M5.1 | 1d | Not started (deferred by design) |

**~11.5 dev-days of backend work, ~10.5 before M5.** This is the number the UX plan's
"~44–50 dev-days" explicitly excludes. The honest total for the minimum shippable
slice (M0+M1+M2 ≈ 28–34d) is **≈ 37–44 dev-days** once B0–B7 are counted, and it is
one engineer shared with web Phases 5–7. `product-manager` should schedule against the
larger number.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **The queue definition changed** (§5.2). M2.1's estimate assumed a query that does not exist; it now depends on B2's column and backfill. | High | B2 before B5. If B2 slips, M2 slips — do not build the queue against `isSelected` alone; it will return nothing. |
| **Docker build breaks on the next deploy** because `apps/mobile` is now a lockfile importer (§7.2b). | High | B0 first, verified with a real `docker build`, before any other mobile work lands on `master`. |
| **No rate limiting on a second public credential endpoint** (§2.5). | High | B1 ships the limiter in the same commit as the endpoint. Not a follow-up. |
| **Reverse-proxy timeout kills long fire-and-forget generations** (§4.6). | Medium | Verify `proxy_read_timeout` ≥ 900 s before M3.3. Already a latent web bug. |
| **BFF drifts into a second business-logic home.** | Medium | Rule 1 of §1.3: no Prisma in a `/api/mobile/v1` handler. Enforce in review; it is a one-line grep. |
| **Storage is still login-gated, not per-owner, while a device holds a persistent cache** (§3.2). | Medium | B9 before M5.1, or before the first non-trusted user. Specced now so it is a day's work, not a redesign. |
| **In-process notification coalescing loses pushes on redeploy** (§4.3). | Low | Accepted by product rule: Activity is the source of truth. Do not build an outbox. |
| **Two review surfaces disagree** (web selects without stamping `reviewedAt` in some path). | Low | Stamp in `lib/select*()`, not in routes — there is exactly one funnel per slot type. `qa-engineer` should test each of the eight. |

---

## 10. Future scalability

Nothing here is a Stage-1-only dead end, and that is deliberate:

- **The BFF + `lib/read` split** is what makes a future client (tablet, a partner
  integration, a mobile-shaped web build) cheap: the queries are already extracted.
- **`StorageProvider.stat/stream`** is the last piece of surface area S3/R2 needs; the
  swap remains a new class implementing one interface, as the file's own comment
  promises.
- **Signed URLs** (B9) are the precondition for a CDN. Once minted, putting Cloudflare
  in front of `/api/storage` is configuration, not code.
- **`notifyGenerationFinished`** moves into a worker unchanged when a queue arrives.
  The call site is deliberately at the terminal-state boundary, not inside a request
  handler.
- **`reviewedAt`** is more than a queue predicate: it is the first durable record of
  human agreement with a generation, i.e. the raw signal for "how often is take 1 the
  kept take" — the quality metric the continuity/quality-gate work will need.

What is deliberately **not** built: no job queue, no CDN, no `Organization`/tenancy, no
outbox table, no GraphQL, no second database, no per-request tracing stack. Each of
those needs a concrete requirement this product does not yet have.
