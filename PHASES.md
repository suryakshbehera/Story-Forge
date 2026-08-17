# Narrata — Development Phases

Narrata is a **manual-first AI story/video production studio**: a human-in-the-loop
tool where AI drafts content on request, but the human always writes, edits,
locks, and selects the final version. No step auto-runs the next step.

This document tracks what each phase built, grounded in the code and commit
history in this repo. **Phase 0 through Phase 6 are complete and describe
what exists today.** Everything from Phase 7 onward is a **proposed
roadmap**, inferred from schema/enum scaffolding and code comments already in
the repo (see "Evidence" under each phase) — it has not been built and has
not been confirmed by the project owner as the committed plan. Treat it as a
draft to edit, not a spec to build against.

---

## Phase 0 — Project Foundation ✅ Complete

**Goal:** stand up the monorepo and local infrastructure with nothing
product-specific in it yet.

- pnpm workspace monorepo: `apps/web` (Next.js/TypeScript), `packages/db`
  (Prisma/PostgreSQL), `workers/` (reserved, empty), `storage/` (local asset
  root)
- Next.js 16 App Router app scaffolded via `create-next-app`, TypeScript,
  Tailwind, shadcn/ui component primitives (`button`, `card`, `dialog`,
  `dropdown-menu`, `input`, `label`, `select`, `separator`, `switch`,
  `sonner` toast)
- PostgreSQL 16 via Docker Compose (`docker-compose.yml`), bound to
  `127.0.0.1:5555`, trust auth for local dev only
- Prisma configured against `DATABASE_URL`; `pnpm db:migrate` / `db:generate`
  / `db:seed` / `db:studio` scripts wired at the repo root
- `.env.example` documents `DATABASE_URL`, `OPENROUTER_API_KEY`,
  `STORAGE_ROOT`
- `LocalDiskStorageProvider` (`apps/web/src/lib/storage.ts`) — a
  `StorageProvider` interface backing local-disk storage under
  `STORAGE_ROOT`, served via `/api/storage/[...key]`. Swapping to S3/R2 later
  means adding a new class behind the same interface; no call sites change.

**Evidence:** [`pnpm-workspace.yaml`](pnpm-workspace.yaml),
[`docker-compose.yml`](docker-compose.yml), [`.env.example`](.env.example),
[`apps/web/src/lib/storage.ts`](apps/web/src/lib/storage.ts)

---

## Phase 1 — Story Engine + Context Engine ✅ Complete

**Goal:** the first working vertical slice — create a project, write/generate
a story with AI, and keep characters/locations consistent across
generations.

### Data model (`packages/db/prisma/schema.prisma`)

- `Project` — `SINGLE` (one-off video) or `SERIES`, root of everything else
- `Story` — single-video projects: topic, premise, genre, tone, language,
  duration, narration/opening/closing style, plus denormalized `content`
- `StoryBible` — series projects: premise, genre, tone, language, world
  rules, visual style, timeline notes, plus denormalized `content`
- `Season` → `Episode` — series structure; episodes carry a manually-written
  `summary` used by the Context Engine
- `Character` — identity, appearance, personality, clothing, background,
  character arc, and an `isLocked` flag
- `Location` — description, architecture, environment, time/weather, visual
  style
- `Asset` — typed media (`REFERENCE_IMAGE`, `GENERATED_IMAGE`, `VIDEO_CLIP`,
  `AUDIO_NARRATION`, `AUDIO_DIALOGUE`, `SFX`, `MUSIC`); **only
  `REFERENCE_IMAGE` is actually produced/consumed this phase** — the rest of
  the enum is reserved for later generation pipelines
- `Version` — generic version history keyed by `entityType` + `entityId`
  (currently `STORY` and `STORY_BIBLE`), so one table serves every
  versionable entity instead of one table per kind; tracks `payload`,
  `prompt`, `modelId`, `generationSettings`, `createdBy` (`USER` | `AI`), and
  `isSelected`
- `AiModelOption` — the model registry, keyed by `AiJobType`
  (`MASTER_AI`, `STORY_WRITING`, `SCENE_PLANNING`, `IMAGE_PROMPTS`,
  `IMAGE_GENERATION`, `IMAGE_VALIDATION`, `VOICE`, `VIDEO`)

### Features

- **Project creation** — Single Video or Series, via `new-project-dialog.tsx`
- **Story editor** (`story-editor.tsx`) — manual editing plus AI generation
  through OpenRouter; every generation call creates a new `Version` and lets
  the user browse/select prior versions
- **Story Bible editor** (`story-bible-editor.tsx`) — same pattern for
  series-level world-building; **Seasons/Episodes management**
  (`seasons-manager.tsx`, `episode-editor.tsx`) for structuring a series and
  writing manual episode summaries
- **Character system** (`character-detail-form.tsx`,
  `reference-image-gallery.tsx`) — full profile fields, reference image
  upload, and a **lock** toggle
- **Location system** (`location-detail-form.tsx`) — same pattern, no lock
  concept (locations aren't "cast", so nothing analogous to character
  continuity-locking applies)
- **AI Model Registry + Settings UI** (`ai-models-manager.tsx`,
  `/settings/ai-models`) — every model dropdown in the app reads from
  `AiModelOption`; **nothing in application code hardcodes a model id**
  (enforced convention, see `apps/web/src/lib/ai/models.ts`)

### Context Engine (`apps/web/src/lib/context/assemble.ts`)

Rule-based context assembly — **no vector search or embeddings this
phase**. For a given project (and optionally an episode), it deterministically
pulls:

1. Story or Story Bible core fields
2. **All locked characters** (locking is what puts a character in every
   future generation call, regardless of scene relevance)
3. All locations
4. For series: prior episode summaries (only episodes before the current one
   in season/episode order) plus the current episode's own summary

Everything is joined into a single prompt block and trimmed to a 24,000
character budget (truncated with a marker if exceeded). This is what feeds
every "Generate" action — see `assembleContext()` called from
[`story/generate/route.ts`](apps/web/src/app/api/projects/[id]/story/generate/route.ts)
and the equivalent Story Bible route.

### AI integration (`apps/web/src/lib/ai/openrouter.ts`)

One reusable primitive, `callChatModel()`, routes every text-generation job
through OpenRouter's chat completions API with a model id resolved from the
registry (`getModelOrDefault(jobType, modelId)`). Only `STORY_WRITING` and
the Story Bible equivalent are actually wired to a UI action this phase.

### Explicitly reserved, not built this phase

The code says so directly, in-line:

- Per-scene character/location tagging beyond the "locked" heuristic —
  arrives with the **Scene Engine**, called out in code as **Phase 2**
  (`assemble.ts:62`)
- `Asset` types beyond `REFERENCE_IMAGE` — "more types land in later phases
  once generation pipelines exist" (`schema.prisma`)
- `AiJobType.MASTER_AI` exists in the registry/enum and Settings UI but has
  no generation route calling it yet — reserved for a future orchestrating
  agent

**Evidence:** commit `07a51f3` ("Narrata V1 Phase 0+1: project foundation,
story engine, context engine"),
[`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma),
[`apps/web/src/lib/context/assemble.ts`](apps/web/src/lib/context/assemble.ts),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts),
[`apps/web/src/lib/ai/models.ts`](apps/web/src/lib/ai/models.ts),
[`packages/db/src/seed.ts`](packages/db/src/seed.ts)

---

## Phase 2 — Scene Engine ✅ Complete

**Goal:** turn a written Story (single video) or Episode summary (series)
into an ordered list of discrete, producible scenes — with per-scene
character/location tagging and a first-class `visualMode`, so Phase 3 (image
generation) has something to attach generated images to.

### Data model (`packages/db/prisma/schema.prisma`)

- `Scene` — dual-optional FK (`storyId`, `episodeId`, mirroring `Asset`'s
  `characterId`/`locationId` pattern), `order`, `title`, `description`,
  `visualMode` (`SceneVisualMode`: `ILLUSTRATION` | `IMAGE_TO_VIDEO`),
  `visualModeReason` (AI's stated reasoning, user-editable), many-to-many
  `characters`/`locations`. **Plain-CRUD, not versioned** — deliberately, so
  that Phase 3's future `Asset.sceneId` attachments never get orphaned by a
  version-restore deleting/recreating scene rows (Character/Episode follow
  the same unversioned pattern).

### Features

- **AI scene planning** (`SCENE_PLANNING` job, `/api/stories/[id]/scenes/generate`
  and `/api/episodes/[id]/scenes/generate`) — breaks the Story's full written
  content (or, for series, the episode's `summary` plus Context Engine
  output) into an ordered scene list via strict JSON model output
  (`openrouter.ts`'s new `jsonMode`). Only works fresh (empty parent) unless
  `regenerateAll` is explicitly passed — regenerating is a user-confirmed
  destructive action, never automatic. AI can only tag characters/locations
  that already exist (case-insensitive name match); unmatched names are
  reported back and surfaced in the UI rather than silently dropped or
  invented.
- **Manual scene management** (`scene-manager.tsx`) — add, edit (title,
  description, visual mode, AI reasoning, character/location tag toggles),
  reorder (up/down, swaps `order` transactionally), delete (resequences
  remaining scenes so `order` stays contiguous). SINGLE-video projects get a
  "Scenes" tab (`/projects/[id]/story/scenes`); SERIES projects get a Scenes
  card on each episode's detail page, since scenes are per-episode there.
- **Context Engine change** (`assemble.ts`) — now includes the full
  `Story.content` / `StoryBible.content` (previously omitted, setup-fields
  only), appended last so short structural context survives truncation
  first. `MAX_CHARS` raised from 24,000 to 60,000 to fit full-length written
  content alongside metadata.

**Evidence:** `packages/db/prisma/schema.prisma` (`Scene`,
`SceneVisualMode`), [`apps/web/src/lib/scenes.ts`](apps/web/src/lib/scenes.ts),
[`apps/web/src/components/scene-manager.tsx`](apps/web/src/components/scene-manager.tsx),
[`apps/web/src/lib/context/assemble.ts`](apps/web/src/lib/context/assemble.ts),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts).

---

## Phase 3 — Image Pipeline ✅ Complete

**Goal:** generate an image per scene (both `visualMode`s need a base image —
`IMAGE_TO_VIDEO` scenes will feed theirs into video generation in a later
phase), check it against locked character/location reference images, and let
the user pick which attempt is the scene's image. Same "AI prepares, user
approves" pattern as Story versions and Scene planning.

### Data model (`packages/db/prisma/schema.prisma`)

- `Asset` extended (previously only used for `REFERENCE_IMAGE`) rather than a
  parallel table: `sceneId` (dual-optional-FK pattern continues), `isSelected`
  (mirrors `Version.isSelected` — newest generation always becomes selected,
  older attempts stay browsable/selectable), `prompt`/`modelId` (what was
  actually sent to the image model), `createdBy` (defaults `USER` so existing
  reference-image uploads are unaffected), and advisory-only
  `validationPassed`/`validationNotes`/`validationModelId` (`null` = not
  validated, never treated as a failure).

### Features

- **Three-step generation pipeline** (`apps/web/src/lib/scene-images.ts`):
  `IMAGE_PROMPTS` turns the scene description plus its own tagged
  characters'/locations' visual fields into a polished image prompt (scoped to
  the scene's tagged roster, not `assembleContext()` — same reasoning as Scene
  planning); `IMAGE_GENERATION` calls OpenRouter's dedicated Image API
  (`POST /api/v1/images`, separate from chat completions) and stores the
  result via the existing `StorageProvider`; `IMAGE_VALIDATION` sends the
  generated image plus each tagged **locked** character's/tagged location's
  first reference image to a vision-capable model for an advisory
  pass/fail + reasoning (locations have no lock concept, so all tagged
  locations participate; characters must be locked, mirroring
  `assemble.ts`'s rule). A missing reference image never blocks
  generation — it's surfaced in the UI instead.
- **AI primitives** (`apps/web/src/lib/ai/openrouter.ts`): `generateImage()`
  (the Image API primitive) and an `images?: string[]` param added to
  `callChatModel()` (data-URI attachments as `image_url` content parts, for
  the validation step's vision call).
- **Manual image management** (`scene-manager.tsx`): an "Image Generation"
  settings card (Image Prompt / Image Generation / Validation model pickers +
  shared instructions, applied to whichever scene's button is clicked) above
  the scene list; each scene gets a thumbnail strip of every attempt
  (click to select, hover to delete), a validation badge per thumbnail, and a
  "Generate Image" / "Generate Another" button.
- **New API routes**: `POST /api/scenes/[id]/images/generate`,
  `POST /api/scenes/[id]/images/[assetId]/select`,
  `DELETE /api/scenes/[id]/images/[assetId]`.

**Evidence:** `packages/db/prisma/schema.prisma` (`Asset` fields, `Scene.images`),
[`apps/web/src/lib/scene-images.ts`](apps/web/src/lib/scene-images.ts),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts),
[`apps/web/src/components/scene-manager.tsx`](apps/web/src/components/scene-manager.tsx).

---

## Phase 4 — Voice ✅ Complete

**Goal:** per-scene narration and per-character dialogue audio, with voice
identity resolved server-side (never per-call) so a narrator/character
sounds the same across an entire story.

### Data model (`packages/db/prisma/schema.prisma`)

- `Scene.narration` — the narrator's spoken script, manually written (no
  AI-drafting step, only text-to-speech)
- `Character.voiceName` — free-text TTS voice id, user-entered (the set of
  valid voices is provider/model-specific, same reasoning as `AiModelOption`
  not hardcoding model ids)
- `Project.narratorVoiceName` — one narrator voice per project, read
  server-side by the generation route rather than accepted from the client
- `DialogueLine` — ordered, per-Character spoken lines within a Scene
- `Asset` extended: `narrationSceneId` and `dialogueLineId` FKs, kept
  separate from `sceneId` so audio never shows up in the image gallery

### Features

- **Narration audio** (`apps/web/src/lib/voice.ts`, `AiJobType.VOICE`) —
  generates from `Scene.narration` using `Project.narratorVoiceName`
- **Dialogue audio** — per-`DialogueLine`, using `Character.voiceName`; no
  fallback voice, so two unassigned characters never silently share one
- **`generateSpeech()`** (`apps/web/src/lib/ai/openrouter.ts`) — OpenRouter's
  TTS endpoint (`POST /api/v1/audio/speech`), always requests `pcm` (the
  lowest-common-denominator format every provider on this endpoint accepts),
  wrapped in a WAV header before storage
- **UI** (`scene-voice-panel.tsx`) — narration script + take management,
  dialogue line CRUD/reorder + take management, both with select/delete per
  take (same pattern as Phase 3's image gallery)

**Evidence:** commits `7846f4c`, `459cc54`, `3a6b9a0`,
[`apps/web/src/lib/voice.ts`](apps/web/src/lib/voice.ts),
[`apps/web/src/components/scene-voice-panel.tsx`](apps/web/src/components/scene-voice-panel.tsx).

---

## Phase 5 — Image→Video Generation ✅ Complete

**Goal:** for scenes with `visualMode: IMAGE_TO_VIDEO`, turn the scene's
selected image into an actual AI-generated video clip. Distinct from
Phase 6 (local ffmpeg assembly of the final output from all clips/audio) —
this phase produces the individual `VIDEO_CLIP` assets that Phase 6 later
stitches together.

### Data model (`packages/db/prisma/schema.prisma`)

- `Scene.motionPrompt` — user-written camera/motion direction, same
  manual-only pattern as `narration` (no AI-drafting step); falls back to
  `Scene.description` at generation time when unset
- `Scene.videoDurationSeconds` — desired clip length, user-set
- `Scene.videoClips` / `Asset.videoSceneId` — generated clips, kept on their
  own relation for the same reason `narrationAudio` is (mixing into `images`
  would break the image gallery's `<img>`-only assumption)
- `Asset.sourceImageId` — self-relation recording which selected
  `GENERATED_IMAGE` a clip was generated from, for traceability if the
  scene's image is later regenerated/reselected
- `AiJobType.VIDEO_GENERATION` — kept distinct from `AiJobType.VIDEO`, which
  stays reserved for Phase 6's local ffmpeg assembly

### Features

- **`generateVideo()`** (`apps/web/src/lib/ai/openrouter.ts`) — OpenRouter's
  video generation endpoint (`POST /api/v1/videos`, launched April 2026),
  a third dedicated-endpoint primitive alongside `generateImage()`/
  `generateSpeech()`. Unlike those two, generation is asynchronous: submit
  returns a job id, and the primitive polls `GET /api/v1/videos/{id}` (5s
  interval, 5 min timeout) until the job completes, then downloads the clip.
  The scene's selected image is sent as `frame_images[0]` — a base64 data
  URI, not a public URL, since OpenRouter passes image inputs through
  verbatim the same way its image/vision endpoints do
- **`generateSceneVideo()`** (`apps/web/src/lib/scene-video.ts`) — requires
  `visualMode === IMAGE_TO_VIDEO` and an existing selected scene image
  (errors clearly otherwise); builds the prompt from `motionPrompt` (falling
  back to `description`); stores the result via the existing
  `StorageProvider`; select-newest pattern mirrors Phase 3's image attempts
- **New API routes**: `POST /api/scenes/[id]/video/generate`,
  `POST /api/scenes/[id]/video/[assetId]/select`,
  `DELETE /api/scenes/[id]/video/[assetId]`
- **UI** (`scene-video-panel.tsx`) — motion prompt + duration fields, a clip
  attempt strip (`<video>` previews, select/delete), shown only for
  `IMAGE_TO_VIDEO` scenes and disabled until the scene has a selected image

**Evidence:** `packages/db/prisma/schema.prisma` (`Scene.motionPrompt`,
`Scene.videoDurationSeconds`, `Scene.videoClips`, `Asset.videoSceneId`,
`Asset.sourceImageId`, `AiJobType.VIDEO_GENERATION`),
[`apps/web/src/lib/scene-video.ts`](apps/web/src/lib/scene-video.ts),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts),
[`apps/web/src/components/scene-video-panel.tsx`](apps/web/src/components/scene-video-panel.tsx).

---

## Phase 6 — Video Assembly ✅ Complete

**Goal:** for a Story (single video) or Episode (series), stitch every
scene's selected visual (image or Phase 5 clip) and audio (narration +
dialogue) into one ordered, final rendered video — locally, via ffmpeg,
matching the seeded `AiJobType.VIDEO` (`provider: "local"`, `modelId:
"ffmpeg"`) rather than a hosted API. No music/SFX bed track this phase —
`AssetType.SFX`/`MUSIC` stay reserved.

### Data model (`packages/db/prisma/schema.prisma`)

- `AssetType.FINAL_VIDEO` — a fully assembled render.
- `Story.finalVideos` / `Asset.storyVideoId` and `Episode.finalVideos` /
  `Asset.episodeVideoId` — own relation/FK pair each, same reasoning as
  `Scene.videoClips`/`Asset.videoSceneId`; dual-optional like `Scene`'s
  `storyId`/`episodeId`, enforced at the API layer. Reuses `isSelected` for
  the same take-selection pattern as every prior generation pipeline.

### Features

- **`apps/web/src/lib/ffmpeg.ts`** — thin `child_process.execFile` wrapper
  (`runFfmpeg`, `probeDuration`) with no shell interpolation; `FfmpegError`
  gives a clear message when the binary is missing from PATH, mirroring
  `OpenRouterError`'s role for the hosted primitives.
- **`assembleVideo()`** (`apps/web/src/lib/video-assembly.ts`) — reuses
  `scenes.ts`'s `parentWhere`/`ScenesParentType` to load a Story's or
  Episode's ordered scenes. Validates every scene has a selected visual first
  (missing audio is fine — a silent scene), reporting *all* unready scenes at
  once rather than stopping at the first. Per scene: concatenates selected
  narration + dialogue-line takes into one audio track, then builds a silent
  visual segment normalized to a canonical 1920×1080/30fps/yuv420p format —
  a static image held for the audio's duration (falls back to a 5s default
  if the scene has no audio at all), or the scene's video clip **reconciled**
  to that duration (freeze-pad via `tpad` if short, trimmed if long) — muxes
  visual+audio per scene, then concatenates every scene via ffmpeg's concat
  demuxer into the final file. All work happens in an `os.tmpdir()` scratch
  dir, never `STORAGE_ROOT`.
- **New API routes**: `POST /api/stories/[id]/video/generate`,
  `POST /api/stories/[id]/video/[assetId]/select`,
  `DELETE /api/stories/[id]/video/[assetId]`, and the same trio under
  `/api/episodes/[id]/video/...`. Validation failures (unready scenes) return
  400; `FfmpegError` (missing binary, encode failure) returns 500.
- **UI** (`video-assembly-panel.tsx`) — a "Final Assembly" card below the
  Scenes card on both the single-video Scenes page and the Episode page:
  `VIDEO`-job model picker, "Assemble Final Video" button, and a take list
  (`<video>` previews, select/delete) identical in shape to
  `SceneVideoPanel`'s clip list.

### Setup

Requires `ffmpeg`/`ffprobe` on PATH — a new local prerequisite, same tier as
Postgres-via-Docker (see `.env.example`), not a hosted API key.

**Evidence:** `packages/db/prisma/schema.prisma` (`AssetType.FINAL_VIDEO`,
`Story.finalVideos`, `Episode.finalVideos`, `Asset.storyVideoId`,
`Asset.episodeVideoId`), [`apps/web/src/lib/ffmpeg.ts`](apps/web/src/lib/ffmpeg.ts),
[`apps/web/src/lib/video-assembly.ts`](apps/web/src/lib/video-assembly.ts),
[`apps/web/src/components/video-assembly-panel.tsx`](apps/web/src/components/video-assembly-panel.tsx).

---

## Phase 7 — Background Music & SFX ✅ Complete

**Goal:** per-scene background music and sound effects, AI-generated or
user-uploaded, mixed under narration/dialogue at Phase 6 assembly time.

### Data model (`packages/db/prisma/schema.prisma`)

- `Scene.musicPrompt` / `Scene.sfxPrompt` — the "Audio Plan": AI-drafted by
  `AUDIO_PLANNING`, then user-editable before the actual generation call,
  same pattern as `visualModeReason`. An empty prompt blocks generation for
  that track, same idiom as `Scene.narration`.
- `Scene.musicVolume` / `Scene.sfxVolume` — mix levels (0-1) applied at
  assembly time, relative to the voice track at full volume. Defaults 0.25 /
  0.8.
- `Scene.music` / `Scene.sfx` — one selected take at a time each (same
  take-history/`isSelected` pattern as `narrationAudio`), via their own
  `Asset.musicSceneId` / `Asset.sfxSceneId` FKs.
- `AiJobType.AUDIO_PLANNING`, `MUSIC_GENERATION`, `SFX_GENERATION` — kept as
  three distinct job types (planning is a chat model; music and sfx
  generation are independent calls, since a provider suited to one isn't
  necessarily suited to the other).

### Features

- **Audio Plan** (`generateAudioPlan` in
  [`apps/web/src/lib/scene-audio.ts`](apps/web/src/lib/scene-audio.ts)) —
  one `AUDIO_PLANNING` chat call per scene (never a whole-episode pass)
  drafts both `musicPrompt` and `sfxPrompt` from the scene's description plus
  a light genre/tone/visualStyle hint, strict JSON output. Either field can
  come back empty if the AI judges that track unnecessary for that scene.
- **Music / SFX generation** (`generateSceneMusic`/`generateSceneSfx`) — each
  reads its (possibly hand-edited) prompt and calls
  [`generateAudio()`](apps/web/src/lib/ai/openrouter.ts). Unlike
  `generateImage`/`generateSpeech`/`generateVideo`, OpenRouter has no
  dedicated endpoint for music/SFX — confirmed against its docs, the only
  dedicated audio endpoints are `/audio/speech` (TTS) and
  `/audio/transcriptions` (STT). Music/audio-generation-capable models
  (Google Lyria, OpenAI GPT Audio) are invoked through
  `/chat/completions` with an audio output modality instead, per
  OpenRouter's own description of every other modality "running on
  /chat/completions, differing only by content type." This is the
  least-confirmed primitive in `openrouter.ts` — no dedicated-endpoint doc
  page to point at, unlike its three siblings — flagged in code as the first
  place to adjust if a provider expects a different request shape.
- **Manual upload** (`uploadSceneMusic`/`uploadSceneSfx`) — same dual path as
  `GENERATED_IMAGE`: AI generation or direct upload, either becomes the
  selected take.
- **UI** (`scene-audio-panel.tsx`) — one "Generate Audio Plan" action per
  scene populates both prompt fields; independent Music/SFX sections below
  each have their own prompt textarea, volume slider, model picker,
  Generate/Upload buttons, and take list (`<audio>` previews, select/delete).
- **New API routes**: `POST /api/scenes/[id]/audio-plan/generate`, and per
  track (`music`, `sfx`): `generate`, `upload`,
  `[assetId]/select`, `DELETE [assetId]`.

### Assembly (`apps/web/src/lib/video-assembly.ts`)

Music loops (via `-stream_loop -1`) and sfx pads with silence (`apad`) to
match the scene's final visual duration, each with its own `volume` filter
applied first; all present layers (voice/music/sfx) are combined with
ffmpeg's `amix` filter (`normalize=0` so voice keeps its natural level
instead of being auto-divided by input count, `alimiter` afterward as a
clipping safety net). Scenes with neither music nor sfx are byte-for-byte
unaffected — the single-layer and no-layer paths skip the mix step entirely.

**Evidence:** `packages/db/prisma/schema.prisma` (`Scene.musicPrompt`,
`sfxPrompt`, `musicVolume`, `sfxVolume`, `music`, `sfx`; `Asset.musicSceneId`,
`sfxSceneId`; `AiJobType.AUDIO_PLANNING`/`MUSIC_GENERATION`/`SFX_GENERATION`),
[`apps/web/src/lib/scene-audio.ts`](apps/web/src/lib/scene-audio.ts),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts)
(`generateAudio`),
[`apps/web/src/lib/video-assembly.ts`](apps/web/src/lib/video-assembly.ts),
[`apps/web/src/components/scene-audio-panel.tsx`](apps/web/src/components/scene-audio-panel.tsx).

---

## Phase 8 — Shot Engine & Dialogue Direction ✅ Complete

**Goal:** replace "one image per Scene" with an ordered sequence of Shots
(distinct continuity frames, not alternate takes) so illustration scenes get
visual variety instead of one static image held for the whole scene, and
Image→Video scenes get first/last-frame continuity input instead of a single
starting frame. Alongside it, per-`DialogueLine` delivery direction (style +
pace) so a scene's conversation doesn't all sound the same.

### Data model (`packages/db/prisma/schema.prisma`)

- `Shot` — new model, child of `Scene`: `order`, `description` (the specific
  framing/action for that shot — AI-drafted or hand-written), `cameraMovement`
  (moved off `Scene`; the `SceneCameraMovement` enum was renamed to
  `CameraMovement` since it's no longer scene-scoped), `durationSeconds`
  (optional override — shots left unset evenly split whatever remains of the
  scene's audio duration), and its own `images: Asset[]` gallery via
  `Asset.shotId` (same take-history/`isSelected` pattern `Scene.images` had).
  Plain-CRUD, not versioned — same reasoning as `Scene`.
- `Scene.images`/`Asset.sceneId` (the old `SceneImages` relation) and
  `Scene.cameraMovement` were **removed** — this is the first data-migrating
  change in the repo, not just an additive one. Sequence: an additive
  migration added `Shot`/`Asset.shotId` alongside the old fields; a one-time
  script (`packages/db/src/backfill-shots.ts`, deleted after running)
  created a "Shot 1" per existing Scene carrying its current
  description/cameraMovement and reassigned every existing image `Asset`
  from `sceneId` to that Shot's `shotId`; a verification query confirmed
  zero orphaned images before a second, destructive migration dropped the
  old columns. On this repo's dev data: 37 scenes → 37 shots, 23 images
  moved, 0 orphans.
- `DialogueLine.deliveryNotes`/`speed` — AI-drafted (via `DIALOGUE_DIRECTION`)
  then user-editable, same pattern as `visualModeReason`. Both map to real,
  documented OpenAI-compatible TTS params (`instructions`, `speed` on
  `/audio/speech`) — lower-risk than Phase 7's `generateAudio()`, which has
  no equivalent dedicated-endpoint documentation to point at.
- `AiJobType.SHOT_PLANNING` (chat, mirrors `SCENE_PLANNING` one level down)
  and `AiJobType.DIALOGUE_DIRECTION` (chat, one call per scene directs every
  line at once so a conversation's emotional arc stays coherent).

### Features

- **Shot planning** (`generateShots` in
  [`apps/web/src/lib/shots.ts`](apps/web/src/lib/shots.ts)) — one
  `SHOT_PLANNING` call per scene (never a whole-episode pass) proposes an
  ordered shot list with a stated count/reasoning, strict JSON output.
  Existing `regenerateAll`-requires-confirmation pattern from Scene Planning
  reused for re-running it against a scene that already has shots.
- **Shot images** (`apps/web/src/lib/shot-images.ts`, replacing the deleted
  `scene-images.ts`) — the same three-step `IMAGE_PROMPTS` →
  `IMAGE_GENERATION` → `IMAGE_VALIDATION` pipeline from Phase 3, retargeted:
  the prompt is now built from `Shot.description` (primary framing) plus the
  parent Scene's description/characters/locations/style as context.
  Validation still checks against the scene's tagged locked
  characters/locations (tags stay scene-level — shots share their scene's
  roster). Manual upload available too, same dual path as before.
- **Image→Video continuity** (`generateSceneVideo` in
  `apps/web/src/lib/scene-video.ts`) — for `IMAGE_TO_VIDEO` scenes, shots are
  continuity input for **one** scene-level video generation, not one clip
  per shot: the first shot's image is sent as `frame_images[].frame_type:
  "first_frame"` and (when the scene has more than one shot) the last shot's
  image as `"last_frame"`, confirmed real via OpenRouter's video-generation
  docs (`google/veo-3.1`, the seeded default, supports both). `generateVideo()`
  in `openrouter.ts` gained a `lastFrameDataUri` param for this. Assembly
  itself (`video-assembly.ts`) is unchanged for `IMAGE_TO_VIDEO`/
  `TEXT_TO_VIDEO` scenes — still one clip per scene either way.
- **Per-shot assembly for `ILLUSTRATION` scenes** (`video-assembly.ts`) — the
  scene's visual segment is now built as one Ken Burns clip per shot (each
  shot's own `cameraMovement`), concatenated in order. Duration splits: a
  shot with an explicit `durationSeconds` keeps it, the rest evenly divide
  whatever remains of the scene's total audio duration (floored at 0.5s so a
  pathological over-committed config can't produce a zero-length segment).
  Scenes with a single shot (everything pre-Phase-8) produce byte-for-byte
  equivalent output to before.
- **Dialogue direction** (`generateDialogueDirection` in `lib/voice.ts`) —
  one `DIALOGUE_DIRECTION` call per scene drafts `deliveryNotes`/`speed` for
  every line at once; `generateDialogueAudio()` passes them through to
  `generateSpeech()`'s new `instructions`/`speed` params. Editable per-line
  regardless of source (AI-drafted or hand-written), same as text/character.
- **UI**: `shot-manager.tsx` (new) — per-scene shot list, each with its own
  description/camera-movement/duration fields and image gallery, reusing the
  scene editor's existing shared Image Generation settings card (now
  labelled "Shots & Image Generation", with an added Shot Planning model
  picker) rather than per-shot model pickers, to keep the UI from getting
  more cluttered than the one it replaced. `scene-voice-panel.tsx` gained a
  "Direct Dialogue" button and, per line, a delivery-notes textarea and pace
  number input.
- **New API routes**: `POST /api/scenes/[id]/shots(/generate)`,
  `PATCH|DELETE /api/shots/[id]`, `POST /api/shots/[id]/move`, the same
  `generate`/`upload`/`[assetId]/select`/`DELETE [assetId]` quartet under
  `/api/shots/[id]/images/...` that scene images used to have, and
  `POST /api/scenes/[id]/dialogue-direction/generate`.

**Evidence:** `packages/db/prisma/schema.prisma` (`Shot`, `CameraMovement`,
`DialogueLine.deliveryNotes`/`speed`, `AiJobType.SHOT_PLANNING`/
`DIALOGUE_DIRECTION`), migrations `20260815043933_phase8_shots_add` and
`20260815050250_phase8_shots_cleanup`,
[`apps/web/src/lib/shots.ts`](apps/web/src/lib/shots.ts),
[`apps/web/src/lib/shot-images.ts`](apps/web/src/lib/shot-images.ts),
[`apps/web/src/lib/scene-video.ts`](apps/web/src/lib/scene-video.ts),
[`apps/web/src/lib/video-assembly.ts`](apps/web/src/lib/video-assembly.ts),
[`apps/web/src/lib/voice.ts`](apps/web/src/lib/voice.ts),
[`apps/web/src/components/shot-manager.tsx`](apps/web/src/components/shot-manager.tsx).

---

## Proposed roadmap (Phase 9+) — 🚧 not built, not confirmed

Everything below is **inferred**, not decided. The evidence is real (an enum
value, a seed row, a code comment) but none of it is a commitment — no phase
past Phase 6 has a written scope. Treat this as a reading order, not
a promise — the actual next phase is whatever the project owner decides next.

Everything from here down came out of a 2026-08-16 planning conversation
about scaling to **hundreds of episodes across multiple series**, framed
around one constraint: stay simpler and more efficient, not more
elaborate. Ordered as the sequence to build in, not by importance — each
phase assumes the ones above it exist.

### Phase 9 — One-Time Story Ingestion & Blueprint (proposed)

**Goal:** kill per-episode setup repetition, the actual bottleneck at
hundreds-of-episodes scale — not any single generation step.

- PDF/doc upload parses into Story Bible + Characters + Locations **once
  per series**, not once per episode.
- Series Blueprint: format shape (act structure, typical scene/shot count,
  runtime, tone) defined once per series, so a new episode is drafted
  against it instead of a blank page.
- Tiered approval: split actions into cheap/reversible (draft text —
  scripts, shot plans, cue sheets) which can auto-proceed, vs
  costly/irreversible (actual image/video/audio renders) which still need
  a manual click. Same spend-control principle as today, fewer gates to
  click through.

### Phase 10 — ElevenLabs Audio Provider (proposed)

**Goal:** replace Phase 7's unconfirmed `generateAudio()` (a workaround on
OpenRouter's shared chat-completions audio modality) with ElevenLabs'
purpose-built endpoints for narration, dialogue, music, and SFX.

- `Character.voiceName` / `Project.narratorVoiceName` store ElevenLabs
  voice IDs instead of free-text OpenRouter voice names.
- New `elevenlabs.ts` client alongside `openrouter.ts`: TTS, Sound
  Effects, Music.
- No schema or pipeline reshape — this is a provider swap inside
  `generateSpeech()`/`generateAudio()` call sites only. Image/video
  generation stays on OpenRouter.

**Why first, before Phase 11:** lowest risk of the audio changes, and an
immediate quality/consistency win on its own — native voice IDs fit the
"voice never re-picked per call" rule already in place
([[voice-consistency-design]]) better than a hacked-together endpoint.

### Phase 11 — Post-Assembly Audio Cue Plan (proposed)

**Goal:** move audio planning from per-scene (blind to pacing) to one pass
over the fully assembled silent video — how real post-production scores
to a locked picture, and the fix for "audio review takes too long, once
per scene."

- **Reorder:** silent visual assembly (Phase 6, minus narration/dialogue/
  music/sfx) now happens *before* audio planning, not after.
- New job type (e.g. `AUDIO_CUE_PLANNING`): one AI pass reviews the
  assembled episode video and outputs a single cue sheet — which shot/time
  range gets narration, dialogue, music, SFX. Replaces today's per-scene
  `musicPrompt`/`sfxPrompt` planning step.
- **Video-input model — confirmed, not a risk.** OpenRouter has a
  documented Video Inputs API (base64 data URL or public URL, same pattern
  `generateVideo()` already uses for image inputs), routed to models that
  support video understanding — Gemini 2.5 Flash/Pro and Gemini 3
  Flash/Pro Preview all qualify, with enough context window (Gemini 3 Pro:
  1M tokens) for a full episode's assembled cut. Verified 2026-08-16 via
  OpenRouter's docs; build directly against `POST /api/v1/chat/completions`
  with a video content part, same call shape used elsewhere in
  `openrouter.ts`.
- Generation stays **per-segment** (per shot/scene, matched to its known
  duration, via ElevenLabs) — avoids per-call audio-length limits and
  timing drift that one continuous blind-generated track would hit.
- New final mix step: composite the generated segments onto the locked
  picture per the cue sheet's timestamps. This is what Phase 6 originally
  was, now split into "assemble picture" (early) + "mix sound onto locked
  picture" (late).

### Phase 12 — Master AI Orchestrator (proposed)

**Goal:** the thin tool-calling layer over Scene/Shot/Image/Voice/Music/
SFX that was deliberately deferred until those pipelines existed (see
[[master-ai-sequencing]]) — they now do.

- One review page per episode: Master AI drafts the whole episode (scenes
  → shots → cue plan) in one pass; the producer reviews/edits once and
  approves as a batch, instead of moving through separate pages per asset
  type.
- Parallel job queue — generate independent scenes/shots concurrently
  (`workers/` is already reserved for this) instead of one at a time.
- Still never spends past the approval gate — same "AI prepares, user
  approves" rule, just fewer screens between drafting and approving.
- Retention/hook-writing instructions (3-second hook, emotional triggers)
  fold in here as system-prompt content on the scene/dialogue-writing
  step — no separate build needed. The full Showrunner→Producer→
  specialized-role hierarchy floated in an earlier conversation is *not*
  in scope here — that's a bigger, separate build if ever pursued, kept
  out to stay on the "simpler" side of the goal.

### Phase 13 — Embeddings-Based Continuity Memory (proposed)

**Goal:** let continuity hold up across hundreds of episodes without
hand-locking everything — the rule-based Context Engine
([[narrata-project-overview]]) doesn't scale past a handful of episodes on
its own.

- Embed Story Bible + character/location notes + past episode summaries
  via OpenRouter's confirmed `/embeddings` endpoint (e.g.
  `text-embedding-3-small`, `Qwen3-Embedding`).
- Context Engine retrieves the top-K semantically relevant items per scene,
  alongside (not instead of) today's locked-character/all-location/
  prior-summary pull.
- Auto-summarization: on episode finalize, auto-generate a short "what
  changed" note (plot/character state), fed into the embedding store for
  future episodes.

### Phase 14 — Producer Controls at Scale (proposed)

**Goal:** quality and cost control that doesn't require a full manual
review of every scene of every episode.

- Budget dashboard: running spend per episode/series — both OpenRouter and
  ElevenLabs bill by usage, a real risk once generating hundreds of
  episodes unattended.
- Reuse, don't regenerate: locked character/location images and voices get
  referenced across every episode of a series instead of recreated per
  episode.
- Spot-check review: full review on every Nth episode of a batch, a
  lighter pass on the rest.
- Batch assembly: once a season's episodes are approved, run final
  assembly across all of them in one action, not one at a time.

### Iterative Chunk-Based Scene Generation — 🚧 proposed, not built (2026-08-17)

**Goal:** stop planning a whole episode's scenes in one upfront pass against
a static written script — at ~8-second video-model clip lengths, generation
is non-deterministic enough that scene 4's plan drifts from what scenes 1–3
actually rendered. Plan and generate one chunk at a time instead, each one
grounded in what the previous chunk's clip actually turned out to be.

- Episode duration is divided into `~duration / 8s` chunks up front, but only
  at a coarse beat level (what should happen at the start, roughly where it
  should land by the end) — not full per-scene descriptions the way today's
  one-shot `SCENE_PLANNING` (Phase 2) works.
- Detailed planning happens one scene at a time: scene *N*'s description/
  shots aren't drafted until scene *N-1*'s video clip is generated and
  selected. Scene *N*'s planning call is grounded in what scene *N-1*'s clip
  actually shows and says — the same video-understanding read (visual +
  audio together) built for **AI-drafted Motion Prompt** above, generalized
  from "draft one field" to "draft the whole next scene."
- Not a new primitive: reuses `callChatModel()`'s `videos` param
  (`apps/web/src/lib/ai/openrouter.ts`) added for `MOTION_PROMPT_DRAFTING`,
  just called from a scene-planning-shaped prompt instead of a motion-prompt
  one. Likely lands as `SCENE_PLANNING` gaining a per-chunk mode rather than
  a new `AiJobType`, but that's an implementation detail to settle when this
  is actually scoped.
- Natural fit for Phase 12's Master AI Orchestrator, which already plans to
  draft "scenes → shots → cue plan" per episode in one pass — the
  orchestrator would run this chunk-by-chunk loop internally rather than one
  flat upfront call, once it exists.
- Real tradeoff, not free: one video-read call per scene chunk adds latency
  and cost to the critical path (previous clip must finish generating before
  the next scene can even be planned) in exchange for continuity. Today's
  flat, all-upfront Scene Planning stays the default — this is an
  alternative mode to opt into, not a replacement, until proven out.
- **Not built.** No schema, enum, or code trace yet — this section exists so
  the direction survives to the next design/implementation conversation.

### Character/visual style consistency ✅ Resolved (2026-08-17)

Both candidate fixes from the earlier note are now implemented:

- **Image generation now conditions on locked reference images, not just
  validates against them after the fact.** `generateImage()`
  (`apps/web/src/lib/ai/openrouter.ts`) gained an `inputReferences` param,
  sent as OpenRouter's confirmed `input_references` field
  (`{ type: "image_url", image_url: { url } }`, base64 data URIs — verified
  against `OpenRouterTeam/skills`' `openrouter-images` reference
  implementation). `generateShotImage()` (`shot-images.ts`) now loads the
  same locked-character/tagged-location reference images used for
  `IMAGE_VALIDATION` and passes them into the generation call itself.
- **Project-level style anchor.** New `Project.styleReferences` Asset
  relation (`Asset.projectStyleId` FK, migration
  `20260817010035_add_project_style_reference`) — one locked reference
  image per project (first-uploaded convention, same as Character/Location
  reference images), uploaded via a new "Visual Style Anchor" card
  (`style-anchor-card.tsx`) on both the Story and Story Bible pages, routes
  at `POST /api/projects/[id]/style-reference` and
  `DELETE /api/projects/[id]/style-reference/[assetId]`. Included in every
  shot image generation call's `inputReferences` alongside character/
  location refs — not in `IMAGE_VALIDATION`, since it anchors overall look
  rather than a named character/location's likeness.

**Evidence:** `packages/db/prisma/schema.prisma` (`Project.styleReferences`,
`Asset.projectStyleId`), [`apps/web/src/lib/shot-images.ts`](apps/web/src/lib/shot-images.ts),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts),
[`apps/web/src/components/style-anchor-card.tsx`](apps/web/src/components/style-anchor-card.tsx).

### AI-drafted Motion Prompt ✅ Resolved (2026-08-17)

**Goal:** stop the motion prompt for an `IMAGE_TO_VIDEO` scene from being
written blind — ground it in what the previous scene's clip *actually* shows
and sounds like, not just what was planned, and in what the current scene's
selected image actually contains.

- New `AiJobType.MOTION_PROMPT_DRAFTING` (migration
  `20260817032603_add_motion_prompt_drafting_job_type`), seeded to
  `google/gemini-2.5-pro` — the model needs video-understanding support
  (visual + audio together), same requirement noted for Phase 11's proposed
  `AUDIO_CUE_PLANNING`. Gemini 2.5 Flash is a cheaper fallback swappable via
  Settings → AI Models, same registry pattern as every other job.
- **`callChatModel()`** (`apps/web/src/lib/ai/openrouter.ts`) gained a
  `videos?: string[]` param — data URIs attached as `video_url` content
  parts, mirroring the existing `images`/`image_url` handling. This is the
  first real caller of the OpenRouter Video Inputs API that Phase 11's
  planning note confirmed but never built against.
- **`draftMotionPrompt()`** (`apps/web/src/lib/scene-video.ts`) — one
  multimodal chat call combining two inputs: the current scene's selected
  first-shot image (`image_url`) and the immediately preceding scene's
  selected video clip (`video_url`, visual + audio together) if one exists;
  falls back to the previous scene's plain-text `description` when no clip
  has been generated yet (first scene, or video step not run). Returns a
  draft string only — nothing is saved automatically, matching the
  "AI drafts, user approves" rule every other drafting job follows here.
- **New route**: `POST /api/scenes/[id]/motion-prompt/draft`.
- **UI** (`scene-video-panel.tsx`) — a "Draft with AI" button + its own
  `MOTION_PROMPT_DRAFTING` model picker directly under the Motion Prompt
  textarea (`IMAGE_TO_VIDEO` scenes only, disabled until the scene has a
  selected image); the draft lands in the textarea for review/edit, then
  goes through the panel's existing Save button like a hand-written prompt.

**Evidence:** `packages/db/prisma/schema.prisma` (`AiJobType.MOTION_PROMPT_DRAFTING`),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts),
[`apps/web/src/lib/scene-video.ts`](apps/web/src/lib/scene-video.ts),
[`apps/web/src/app/api/scenes/[id]/motion-prompt/draft/route.ts`](apps/web/src/app/api/scenes/[id]/motion-prompt/draft/route.ts),
[`apps/web/src/components/scene-video-panel.tsx`](apps/web/src/components/scene-video-panel.tsx).

### Story chat AI ✅ Resolved (2026-08-17)

Implemented as described: a chat surface scoped to the current Story
(Single Video) or Episode (Series), using `assembleContext()` as system
context — same Context Engine every other generation call uses, now
serving a conversational surface instead of a one-shot draft. No schema
change beyond a new `AiJobType.STORY_CHAT` registry entry; chat history
lives only in the client component's state and is resent each turn
(`story-chat-panel.tsx`), never persisted server-side. Each assistant
reply has an "Add to Story"/"Add to Episode Summary" button that appends
it through the *existing* save routes (`PATCH /api/projects/[id]/story/content`,
`PATCH /api/episodes/[id]`) — not a new write path, and not a diff/merge
UI, just append-and-save, matching the "keep it simple" direction this
round of fixes was scoped to.

`callChatModel()` (`openrouter.ts`) gained an optional `history` param
(prior turns inserted between the system prompt and the final user
message) — every other job in that file stays single-shot and unaffected.

**Evidence:** `packages/db/prisma/schema.prisma` (`AiJobType.STORY_CHAT`),
[`apps/web/src/app/api/projects/[id]/story-chat/route.ts`](apps/web/src/app/api/projects/[id]/story-chat/route.ts),
[`apps/web/src/components/story-chat-panel.tsx`](apps/web/src/components/story-chat-panel.tsx),
[`apps/web/src/lib/ai/openrouter.ts`](apps/web/src/lib/ai/openrouter.ts).

### Not evidenced at all

Publishing/export, translation, multi-format output, and anything about
distribution have **no trace** in the schema, enums, or code comments.
Unlike the sibling `StoryOS` project (a separate, earlier Go/Next.js attempt
at a related idea, kept for reference in `../StoryOS`), which explicitly
names publishing as Phase 2 scope, this codebase makes no such claim — if
that's part of the plan for Narrata, it hasn't been scaffolded anywhere yet.
