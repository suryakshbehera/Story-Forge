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

## Proposed roadmap (Phase 8+) — 🚧 not built, not confirmed

Everything below is **inferred**, not decided. The evidence is real (an enum
value, a seed row, a code comment) but none of it is a commitment — no phase
past Phase 6 has a written scope. Treat this as a reading order, not
a promise — the actual next phase is whatever the project owner decides next.

### Unplaced — Master AI orchestrator (proposed)

`AiJobType.MASTER_AI` is registered in the model registry and Settings UI
today but never called. It reads as a reserved slot for an orchestrating
agent that could sit across several of the phases above (e.g. driving
scene → image → voice → video as one pipeline) rather than a phase of its
own — but that's a guess, not something the code states.

### Discussed, not evidenced — design notes from 2026-08-15 conversation

The items below have no trace in the schema/code yet. They came out of a
design discussion with the project owner, not from reading the codebase —
recorded here as candidate scope for Phase 8+, not a commitment.

**Shot-level visuals.** Replace "one image per Scene" with an ordered
`Shot` sub-entity under `Scene` (numbered, each with its own generated
image, user can add/remove/reorder/regenerate) — Scene becomes a container
rather than the image unit. Master AI would propose a shot count/split
per scene (heuristic: one shot per dialogue-speaker-change or ~2-3 lines,
plus one per major action beat, floor set by minimum shot duration), user
can always override. This changes where image generation attaches
(Shot, not Scene) — a real schema/pipeline change, not a small tweak.

**Dialogue delivery / voice rhythm.** Extend `DialogueLine` with delivery
metadata (emotion, pace, emphasis/pause markers) that Master AI fills in
during dialogue generation and that feeds into the TTS call params
alongside the existing per-character `voiceName` — see
`apps/web/src/lib/voice.ts` (Phase 4). Style/rhythm should be informed by
Story Bible tone + character profile via the existing Context Engine path.

**Character/visual style consistency.** Two candidate fixes, not yet
confirmed as implemented: (a) verify every image-generation call
conditions on the tagged character's locked reference image, not just a
text description — check `apps/web/src/lib/scene-images.ts`'s
`IMAGE_PROMPTS` step; (b) add a project-level style prompt/seed anchor so
every image call shares one style reference instead of drifting per
generation.

**Story chat AI.** A chat interface scoped to the current Story/Episode
context (reusing the Context Engine), where the user can converse, paste
in scene dialogue for feedback/rewrite, and apply each AI-proposed change
via an explicit "Add to Story" button rather than auto-writing — fits the
existing "AI prepares, user approves" pattern with no schema change,
just a new chat surface + diff/apply action.

**Master AI as a studio hierarchy.** Two separable pieces of the
Showrunner/Producer/Creative-Director org-chart the owner sketched:
(a) retention/hook-writing instructions (3-second hook, strong emotional
triggers) are just system-prompt content for the dialogue/scene-writing
step — cheap to add now; (b) the full role hierarchy (Showrunner →
Creative Head/Producer → Story/Visual/Audio → specialized roles like Art
Director, Character Designer, Continuity Editor) maps onto the "Unplaced —
Master AI orchestrator" entry above as a set of distinct
prompt-plus-tool-scoped agents with a top-level orchestrator delegating
between them. This is a large, multi-role build — needs its own plan
(per-role prompts/tool scope, delegation logic, how a Continuity Editor
role would enforce the character/visual consistency item above) before
implementation starts.

### Not evidenced at all

Publishing/export, translation, multi-format output, and anything about
distribution have **no trace** in the schema, enums, or code comments.
Unlike the sibling `StoryOS` project (a separate, earlier Go/Next.js attempt
at a related idea, kept for reference in `../StoryOS`), which explicitly
names publishing as Phase 2 scope, this codebase makes no such claim — if
that's part of the plan for Narrata, it hasn't been scaffolded anywhere yet.
