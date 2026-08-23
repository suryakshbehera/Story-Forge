# Narrata — What We've Built So Far

A plain-language snapshot of everything that exists in this codebase today.
For the detailed, evidence-cited phase-by-phase history (schema fields, file
paths, commit hashes), see [`PHASES.md`](PHASES.md) — this doc is the
readable summary, including the work done *after* PHASES.md was last
updated (Phase 11).

**What Narrata is:** a manual-first AI story/video production studio. AI
drafts content on request — a scene list, an image, a video clip, a voice
line — but a human always reviews, edits, and approves before anything is
saved or the next step runs. Nothing expensive generates automatically.

---

## 1. Core Production Pipeline (Phases 0–8)

The full path from a blank project to a finished video:

1. **Project setup** — create a Single Video or a Series (Seasons →
   Episodes). Write or AI-generate the Story / Story Bible, with full
   version history so every AI draft and manual edit is browsable and
   restorable.
2. **Characters & Locations** — profile fields, reference image uploads, and
   a per-character **Lock** toggle. Locked characters are automatically
   pulled into every downstream AI call for continuity.
3. **Context Engine** — a rule-based (not embeddings-based) assembler that
   feeds locked characters, all locations, and prior episode summaries into
   every generation prompt, so the AI never forgets established facts.
4. **Scene Engine** — AI breaks a story/episode into an ordered scene list,
   each tagged with its characters/locations and a `visualMode`
   (Illustration vs. Image→Video). Fully editable: add, reorder, delete,
   retag.
5. **Shot Engine** — each scene breaks further into an ordered sequence of
   Shots (distinct camera framings), each with its own image gallery. This
   is what gives illustration scenes visual variety instead of one static
   frame held for the whole scene.
6. **Image Pipeline** — three-step AI pipeline per shot: draft an image
   prompt → generate the image → validate it against locked reference
   images (advisory, never blocking). Every attempt is kept and browsable;
   the user picks which one is "selected."
7. **Image→Video Generation** — turns a shot's selected image into an
   actual video clip via a generative video model, using the first/last
   shot images as continuity anchors.
8. **Voice** — narration audio (per scene) and dialogue audio (per
   character line), with voice identity resolved **server-side** from the
   Character/Project record — never picked ad hoc — so a character always
   sounds the same across the whole story. AI can also draft per-line
   delivery direction (style + pace).
9. **Background Music & SFX** — per-scene music and sound-effect
   generation or manual upload, each with its own volume control, mixed
   under the voice track at assembly time.
10. **Final Assembly (ffmpeg, local)** — stitches every scene's selected
    visual + audio into one rendered video. Handles Ken-Burns motion for
    illustration shots, duration reconciliation between clips and voice
    length, multi-layer audio mixing (voice/music/sfx), and — as of the
    most recent work — **crossfade transitions** between scenes instead of
    hard cuts.

**Underlying principle enforced everywhere:** no AI model id is ever
hardcoded. Every generation step reads its model from an editable
`AiModelOption` registry (Settings → AI Models), so models can be swapped
without a code change.

---

## 2. Post-Assembly Audio Direction (Phase 11)

Instead of planning music/narration blind, scene-by-scene, Narrata can
render the **fully assembled silent picture** and have an AI watch it
start-to-finish, then propose narration text, dialogue, music, and SFX
prompts grounded in what the video actually shows — the same way a real
post-production audio pass works. Reviewed and applied per scene before
anything is saved.

---

## 3. Voice Providers — ElevenLabs + Sarvam + OpenRouter fallback

- **ElevenLabs** is the default provider for narration, dialogue, music,
  and sound effects (purpose-built TTS/audio endpoints, not a chat-model
  workaround).
- **Sarvam AI** was added as a second Voice provider specifically because
  ElevenLabs doesn't support Odia (and several other Indic languages) —
  resolved automatically from the story's language field.
- **OpenRouter** was added as a third Voice fallback path (`openrouter
  added for voice`), so narration/dialogue can still generate on a model
  from OpenRouter's catalog if needed.
- Every job type (Voice, Music, SFX) properly dispatches on the model's
  actual selected provider now — earlier builds had these three hardcoded
  to always call ElevenLabs regardless of what was picked in Settings; that
  bug is fixed.
- Stored audio takes now correctly track their real file extension (`.mp3`
  vs `.wav`) instead of always assuming `.mp3`.

---

## 4. Longer, Smarter Video Generation

- **Multi-segment clips** — when a scene's target duration is longer than
  what a video model can produce in one call, Narrata now automatically
  splits it into multiple frame-chained segments (each seeded from the
  previous segment's last frame) and stitches them into one continuous
  clip. Capped at 6 segments today (~48–60s per scene) — see
  [`TODO-long-form-video.md`](TODO-long-form-video.md) for the plan to push
  this to full 10–20+ minute continuous scenes (resumable background jobs,
  periodic re-anchoring to fight visual drift, per-segment retry).
- **Per-model video config** — admins can now enter a video model's real
  duration constraints (fixed steps like Veo's [4, 6, 8]s, or a min/max
  range) and available resolutions in Settings → AI Models, so segment
  planning and the resolution picker are grounded in what the model
  actually supports instead of guessing.
- **AI-suggested scene duration** — a new "Suggest Duration" action reads
  the scene and recommends a target video length automatically.
- **Optional native audio** — a per-scene toggle to request a video model's
  own generated audio track alongside the picture, off by default since
  narration/music/sfx are always layered in separately at assembly.

---

## 5. Authentication & Multi-User Access

Previously a single-user, no-login tool; now has real accounts:

- Email/password login, two roles — **Admin** and **User**.
- Admins can see and manage every project; regular users only their own.
- Admin-only **Settings → People** page: create invite links (one-time,
  shareable signup URLs), reset a user's password.
- Signup via a static admin code or a redeemed invite link — no public
  open signup.
- Sessions are server-side records (hashed tokens, 30-day expiry) backing
  an httpOnly cookie, not a client-trusted JWT.
- The bootstrap admin account is created at boot time from
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars, never through the app itself.

This was added specifically to support deploying Narrata somewhere reachable
beyond the owner's own machine.

---

## 6. Deployment

- Dockerized and deployed to **Railway** (`Dockerfile`, `.dockerignore`),
  moving off local-only dev.
- Node version and dev/start port configuration adjusted for the hosting
  environment; LAN dev origins allowed for local network testing.
- A central `proxy.ts` layer enforces auth/ownership checks across API
  routes in one place rather than duplicating the check in every route
  handler.

---

## 7. What's Not Built Yet

- **Master AI Orchestrator** — a tool-calling layer that would draft a
  whole episode (scenes → shots → cue plan) in one pass. Deliberately
  deferred until the pipelines above existed to call — they now do, so this
  is the natural next phase, but it hasn't been started.
- **Embeddings-based continuity memory** — today's Context Engine is
  rule-based (locked characters + all locations + prior summaries); doesn't
  yet scale gracefully past a handful of episodes.
- **Producer controls at scale** — budget/spend dashboard, spot-check
  review instead of full manual review, batch assembly across a season.
- **True long-form (10–60 min) continuous video** — see
  [`TODO-long-form-video.md`](TODO-long-form-video.md); today capped at
  ~48–60s per scene via the 6-segment limit.
- **Story Ingestion & Blueprint** (Phase 9) — PDF/doc upload → auto-drafted
  Story Bible/Characters/Locations, and a reusable per-series "format
  blueprint." Some scaffolding exists in the code but was never confirmed
  complete.
- **Publishing/export, translation, multi-format output** — no trace in the
  code at all yet.
