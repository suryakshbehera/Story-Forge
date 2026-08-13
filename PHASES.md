# Narrata — Development Phases

Narrata is a **manual-first AI story/video production studio**: a human-in-the-loop
tool where AI drafts content on request, but the human always writes, edits,
locks, and selects the final version. No step auto-runs the next step.

This document tracks what each phase built, grounded in the code and commit
history in this repo. **Phase 0, Phase 1, and Phase 2 are complete and
describe what exists today.** Everything from Phase 3 onward is a **proposed
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

## Proposed roadmap (Phase 3+) — 🚧 not built, not confirmed

Everything below is **inferred**, not decided. The evidence is real (an enum
value, a seed row, a code comment) but none of it is a commitment — no phase
past Phase 2 has a written scope. Numbering follows the order `AiJobType` is
declared in the schema and seeded in `seed.ts`, which reads like a
production pipeline: write the story → plan scenes → prompt for images →
generate images → validate images → voice → video. Treat the numbering as a
reading order, not a promise — the actual next phase is whatever the project
owner decides next.

### Phase 3 — Image pipeline (proposed)

Two more `AiJobType`s already exist with seeded defaults: `IMAGE_PROMPTS`
and `IMAGE_GENERATION`, plus `IMAGE_VALIDATION` for checking generated
images against locked character/location references before accepting them.
The `AssetType.GENERATED_IMAGE` enum value is already reserved.

### Phase 4 — Voice (proposed)

`AiJobType.VOICE` and `AssetType.AUDIO_NARRATION` /
`AssetType.AUDIO_DIALOGUE` are reserved; seed data defaults it to an
OpenRouter TTS model.

### Phase 5 — Video assembly (proposed)

`AiJobType.VIDEO` is seeded with `provider: "local"`, `modelId: "ffmpeg"` —
the only non-OpenRouter entry in the registry, suggesting local rendering
(stitching generated images/voice/music into `AssetType.VIDEO_CLIP`) rather
than a hosted video-generation API. `AssetType.SFX` and `AssetType.MUSIC`
are also reserved but not yet tied to any job type.

### Unplaced — Master AI orchestrator (proposed)

`AiJobType.MASTER_AI` is registered in the model registry and Settings UI
today but never called. It reads as a reserved slot for an orchestrating
agent that could sit across several of the phases above (e.g. driving
scene → image → voice → video as one pipeline) rather than a phase of its
own — but that's a guess, not something the code states.

### Not evidenced at all

Publishing/export, translation, multi-format output, and anything about
distribution have **no trace** in the schema, enums, or code comments.
Unlike the sibling `StoryOS` project (a separate, earlier Go/Next.js attempt
at a related idea, kept for reference in `../StoryOS`), which explicitly
names publishing as Phase 2 scope, this codebase makes no such claim — if
that's part of the plan for Narrata, it hasn't been scaffolded anywhere yet.
