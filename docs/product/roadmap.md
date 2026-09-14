# Narrata — Product Roadmap (What to Build Next)

**Owner:** `product-strategist`
**Created:** 2026-09-10
**Status:** v1. Supersedes nothing — `docs/product/` did not exist before today.
**Companion:** [`./feature-priorities.md`](./feature-priorities.md) (scoring),
[`../strategy/monetization.md`](../strategy/monetization.md),
[`../strategy/economics.md`](../strategy/economics.md).

Evidence labels: `FACT` (verified in repo today) / `ASSUMPTION` / `UNKNOWN`.

> `docs/strategy/VISION.md` and `DECISION_LOG.md` still do not exist (`FACT`).
> Open positioning questions (premium vs. creator-economy pricing; India-first vs.
> global-first; North Star) belong to `company-vision` and are **not** resolved here.

---

## 1. Verified current state (2026-09-10)

**Built and real** (`FACT`, verified against routes/lib/schema, not just docs):

- Phases 0–8, 10, 11 complete: Story/Bible → Characters/Locations (lockable, with
  reference images) → Context Engine → Scenes (`SceneVisualMode` =
  `ILLUSTRATION` / `IMAGE_TO_VIDEO` / `TEXT_TO_VIDEO`) → Shots → shot images →
  image→video → voice (server-resolved identity) → music/SFX → ffmpeg assembly.
- **Phase 9 is in fact BUILT**, contrary to `PHASES.md`'s "unverified (proposed)"
  note: `lib/story-ingestion.ts`, `lib/blueprint.ts`, `lib/document-parse.ts`, and
  routes `POST /api/projects/[id]/ingest`, `/ingest/apply`, `/blueprint/generate`,
  `/blueprint/versions/...` all exist. **`PHASES.md` needs correcting.**
- **Auth is built**, contrary to the "adding auth before deploy" framing:
  `lib/auth.ts`, `/api/auth/{login,signup,logout}`, `/api/admin/invites`,
  `/api/admin/users/[id]/reset-password`, `/settings/people`.
- Phase 11 silent-assembly loop is live: `assembleSilentPicture()`, persisted
  silent-video takes (`/api/{stories,episodes}/[id]/silent-video/...`), audio cue
  plan draft/apply.
- Sarvam is wired as a second VOICE provider (`lib/ai/sarvam.ts`, seeded
  `bulbul:v3`, `isDefault: false`).
- **Cost capture shipped 2026-09-14** (roadmap item #4 below is done): a
  `GenerationEvent` table + shared `recordGenerationEvent` helper
  (`lib/generation-events.ts`), wired into the 5 metered job types
  (`IMAGE_GENERATION`, `VIDEO_GENERATION`, `VOICE`, `MUSIC_GENERATION`,
  `SFX_GENERATION`). `costUsd` populates for OpenRouter calls; ElevenLabs/Sarvam
  rows carry provider/duration/success but `costUsd: null` (those providers
  never expose per-call cost). Still open: a cost dashboard UI (Phase 14), a
  `withGenerationClaim` wrapper cleanup, and backfilling ElevenLabs/Sarvam cost
  via account-usage APIs.

**Not built** (`FACT`, absence verified):

- No billing/credits/plan/usage schema, no analytics SDK, no rate limiting, no
  quota (per `../strategy/monetization.md` §1, re-confirmed).
- **No `workers/` directory exists at all**, despite `PHASES.md` and
  `TODO-long-form-video.md` both saying "`workers/` is already reserved."
  Everything runs inline in request handlers.
- No export/download UI and no watermarking (one `watermark` match repo-wide, in
  `openrouter.ts`). The user journey currently ends at "a file exists on disk."
- `seed.ts` line 46 still seeds `google/veo-3.1` (Standard, ~8× Lite) as default.

**In flight (uncommitted):** illustration timing consolidation —
`lib/illustration-timing.ts` (new) shares `effectiveShotSeconds()` and
`illustrationTimingMismatch()` between `video-assembly.ts` and
`shot-manager.tsx`/`scene-voice-panel.tsx`, plus schema + shots/assembly edits.
This is a *good* fix (kills a real drift class) and should be finished, not parked.

---

## 2. The strategic read

Narrata has an unusually **complete pipeline and an unusually incomplete product**.
Every generation step exists; almost nothing that turns generation into a
*business or a habit* exists — no measurement, no export moment, no cost floor, no
first-run path.

The next 90 days should therefore be spent almost entirely on **closing the loop
around the pipeline**, not extending the pipeline. Specifically: get it in front of
real users, instrument what it costs, make the output leave the building, and make
the promised continuity actually hold (voice IDs). Master AI, embeddings memory,
and long-form chaining are all correctly *later* — they are amplifiers of a loop
that is not yet closed.

---

## 3. Sequenced roadmap

### NOW — Sprint 1 (weeks 1–2): close the in-flight work and deploy

**1. Finish and commit the illustration-timing work.**
Half-finished shared-constant refactors across `video-assembly.ts` / `shots.ts` /
schema are the highest-risk thing in the tree. Land it.

**2. Deploy to the VPS behind invite-only auth — with two guards first.**
`MUST BUILD NOW`. Auth exists; the blocker has moved. Before any link is shared:
- **Retire or rotate-and-restrict `SIGNUP_CODE`.** A static shared code + zero
  rate limiting + no credit ceiling = an uncapped OpenRouter bill (`FACT`;
  `../strategy/monetization.md` §9). Prefer one-time `Invite` only.
- **Per-account rate limit on `VIDEO_GENERATION` specifically.** Crude is fine
  (N/hour in Postgres). This is the only job type that can burn real money fast.

*Why now:* every remaining prioritization question — activation, pricing,
default model quality, whether manual-first fits creator velocity — is currently
answered by guesswork because there are no users. Deploy is the unblocker for the
rest of this roadmap, not a milestone at the end of it.

**3. Reseed real voice IDs; add the Sarvam/Indic voice path to the UI.**
`MUST BUILD NOW`. `Character.voiceName` / `Project.narratorVoiceName` are free-text
provider IDs; stale placeholders mean a user's *first* voice generation fails or
returns the wrong voice. Voice consistency is a designed differentiator (Phase 4:
resolved server-side, never per-call) — a stale ID makes the differentiator look
broken at exactly the moment it should be the aha. Treat as a correctness bug.
Needs `SARVAM_API_KEY` provisioned on the VPS. **Ask `ai-architect`** whether voice
IDs should stop being free text and become an `AiModelOption`-style registry —
that is the `AiModelOption` pattern's obvious next application and would end this
whole bug class.

### NEXT — Sprint 2 (weeks 3–5): make cost visible, then make it cheap

**4. Capture `usage.cost` + a `GenerationEvent` record.** ✅ **DONE 2026-09-14.**
Was the single highest-leverage item in this document. Shipped: `GenerationEvent`
table + `recordGenerationEvent`/`resolveSceneProjectId` helpers, wired into the 5
metered job types. Deliberately deferred: instrumenting the other 14 text-planning
`AiJobType`s (cheap, numerous call sites — fast-follow with the same helper), a
cost dashboard UI, and ElevenLabs/Sarvam cost backfill (those providers never
return per-call cost). See [[narrata-cost-capture-built]].

**5. Change the default video model to Veo 3.1 Lite (pending a 1-week blind test).**
`MUST BUILD NOW`. One `AiModelOption` row swings Narrata's dominant cost line ~8×.
Run `EXP-004` (`../strategy/monetization.md` §8) against the first invite cohort:
if users can't reliably tell Lite from Standard at 720p on short reference-anchored
clips, the margin problem is largely solved by a seed change. **Ask
`video-architect`** to settle it. Do not ship consumer pricing on a $0.40/second
default.

**6. Export & Share moment.**
`SHOULD BUILD SOON`. Today there is no download button — the journey stops one step
short of the only outcome the user actually wanted. Ship: a prominent Download on
the final assembly card, a copyable share link, and a watermark path (used later
as the free-tier gate, per `../strategy/monetization.md` §7's secondary gate).
This is simultaneously the activation finish line, the retention proof point, and
Narrata's cheapest distribution channel. **Ask `ui-ux-engineer`** where it lives.

### PARALLEL TRACK — pipeline quality, from the video-platform-intelligence research programme

Not part of the Sprint 1–4 sequence above — this track is owned by
`ai-architect`/`video-architect`, runs alongside the product-loop work, and is
informed by 11 external platform architecture briefs
(`../video-platform-intelligence/RESEARCH_CHECKLIST.md`, `CHANGELOG.md`).
**Three findings held across all 9 platforms researched for them** (Runway,
Kling, Veo, Hailuo/MiniMax, Higgsfield, Seedance, Wan, Sora, HunyuanVideo): none
run a runtime quality/continuity critic, none generate multi-scene narrative in
one model call, and none persist narrative structure — Narrata's `StoryBible` +
`Character`/`Location` + `SHOT_PLANNING` stack is already ahead of every
platform researched on that last point. This track is about compounding that
lead, not catching up.

**a. Fix the live prompt/reference-image mismatch bug.** ✅ **DONE 2026-09-14.**
`lib/shot-images.ts`: `buildImagePrompt` described every scene character in
prose while `generateShotImage` only attached images for locked ones, as an
unlabeled positional array — the model had no way to know which image was
which name. Fixed by building a `referenceManifest` (one label per entry in
`generationReferences`, same order — "Kael — locked character reference,
match this face and appearance exactly") rendered as a numbered "# Attached
reference images" block, and flagging every character/location with no
matching image as `[no reference image attached]` in its text block. System
prompt updated to bind numbered list position to attached image position.
Typechecked clean.

**b. Shot N-1 → Shot N continuity handoff.** ✅ **Already built** — found
already live while implementing (a): `loadPreviousShot`, `buildContinuityBlock`,
`Shot.continuityNotes`, and `previousShotContext` in `lib/shot-images.ts` pass
shot N-1's selected image + a persisted `continuityNotes` text field into shot
N's prompt and `generationReferences`. Matches the corrected, narrower finding
from `continuity-engine-gap-2026-09` — the 9-category state model was rejected
in favor of this. Remaining from that agreed order: structured `Shot.continuity`
JSON snapshot via `SHOT_PLANNING`'s existing response schema (zero extra model
calls) → fold continuity checks into the existing `IMAGE_VALIDATION` vision
call → a `Prop` entity (phase 2) → a video continuity critic (later).

**c. Pair every `Character.referenceImages` dispatch with its canonical name +
a stable short description in the prompt text, never paraphrased downstream.**
✅ **Done as part of (a)** — the `referenceManifest` labels are exactly this:
name + role + what to match, positioned against each attached image.

**e (renumbered from "structured Shot.continuity snapshot" in the agreed
build order). ✅ DONE 2026-09-14.** Added `Shot.continuity Json?`
(`packages/db/prisma/schema.prisma`, migration
`20260914074618_add_shot_continuity_snapshot`) — an array of
`{ subject, state }` entries stating what IS true as of a shot, not a diff of
what changed, extending `SHOT_PLANNING`'s existing response schema in
`lib/shots.ts` (zero extra model calls; the same batch call that already
produces `continuityNotes`). Deliberately a snapshot, not a diff chain — a
diff-only note requires replaying every prior shot correctly to reconstruct
current state, which is where drift compounds. Read by the next shot's image
prompt in `lib/shot-images.ts` (`buildContinuityBlock`) alongside the
existing free-text `continuityNotes`. Same-scene scope only, matching
`continuityNotes`' existing boundary — cross-scene continuity handoff
(`loadPreviousShot` is same-scene only today) remains open, flagged
separately in [[world-class-platform-roadmap-2026-09]] item 7.

**d. `wan-2.7` `first_clip` continuation — downgraded from "integrate" to
"spike," 2026-09-14.** The research brief's "already reachable via the
existing OpenRouter integration" claim was verified against Alibaba's own API
docs, not OpenRouter's. Checked OpenRouter's actual documented
`POST /api/v1/videos` schema: `frame_images`/`input_references` are
image-only, no field accepts a video clip as input. A `provider: {}`
passthrough object exists ("keyed by provider slug, only options for the
matched provider are forwarded") which is the only plausible path for
`first_clip` — but it's unconfirmed whether OpenRouter forwards it correctly
to Wan, and unresolved how a stored clip's bytes would reach it (a publicly
fetchable URL, presumably — Narrata's storage is local-disk per
[[narrata-deployment-plan]], reachability from OpenRouter's servers is
unverified). Matches the research programme's own repeatedly-flagged
aggregator-invents-a-capability trap. **Next step is a cheap one-off API spike
sending `provider: { alibaba: { first_clip: <url> } }` against a real
OpenRouter call, not a scene-video.ts wiring change** — do not build
production continuity logic on this until that spike confirms the field is
honored.

**e. Audit every provider adapter for default-on prompt rewriting.** ✅ **DONE
2026-09-14** — and the findings materially corrected the item. Checked
OpenRouter's own public `GET /api/v1/videos/models` (`allowed_passthrough_parameters`
per model) and `GET /api/v1/providers` (slugs) directly, live, for all 6
`VIDEO_GENERATION` models actually in the registry, rather than trusting the
research brief's vendor-level parameter names:
- `alibaba/wan-2.6` (configured, enabled): rewrite-disable **is** exposed, but
  as `enable_prompt_expansion` — not Wan's own `prompt_extend` name.
- **`google/veo-3.1` / `veo-3.1-lite` (the seeded default!): also exposes a
  rewrite-disable, `enhancePrompt`.** Prior research assumed Veo's rewriter
  was mandatory/non-disableable based on Google's own API docs — that
  assumption doesn't hold at the OpenRouter broker level. This was the
  highest-impact fix in this item, since Veo Lite is the actual default model
  running today, not a hypothetical Wan integration.
- `bytedance/seedance-2.5`/`2.0`, `x-ai/grok-imagine-video`: no rewrite-related
  passthrough parameter exists — audited, not applicable, not a gap.
- `minimax/hailuo-2.3` (not currently in the registry): `prompt_optimizer`
  confirmed exposed, added to the lookup table pre-emptively for when/if it's
  added — `hailuo-3`/`hailuo-3-max` expose no such control.

Implemented as `VIDEO_PROMPT_REWRITE_DISABLE` in `lib/ai/openrouter.ts`, sent
via OpenRouter's `provider.options.<slug>.parameters` passthrough object on
every `generateVideo` call for a listed model id.

**Side finding, routed back to item d:** `alibaba/wan-2.7`'s
`allowed_passthrough_parameters` includes `video`, `videos`, and `last_image`
— fields that weren't visible from OpenRouter's generic documented schema and
weren't found by reading the docs pages for item (d)'s spike. This may mean
`wan-2.7` video-continuation input **is** reachable through OpenRouter after
all, via the same passthrough channel used here, contrary to item (d)'s
"downgraded to spike" conclusion. Not yet confirmed live — worth re-opening
(d) with this specific passthrough shape rather than the originally-assumed
top-level field.

**f. Evaluate video-conditioned SFX (TV2A) providers for `SFX_GENERATION`.**
✅ **Evaluated 2026-09-14 — verdict: not currently viable, no code change.**
Scanned OpenRouter's full model catalog (`GET /api/v1/models`) for any model
with `video` in `input_modalities` and `audio` in `output_modalities` — zero
matches, out of 80 models that accept video input (all output text only,
e.g. Gemini/Qwen-VL — vision/understanding models, not audio generation).
Neither current `SFX_GENERATION`/`MUSIC_GENERATION` OpenRouter model is close:
`openai/gpt-audio` takes text+audio in, no video/image; `google/lyria-3-pro-preview`
takes text+**image** in (a still frame), not video. ElevenLabs (the default
SFX provider) is text-only by product design. HunyuanVideo-Foley — the
specific TV2A model the research flagged — isn't listed on OpenRouter at all,
matching the research's own prior finding that Hunyuan has no confirmed
OpenRouter listing. Narrata's assemble-without-audio + Audio Cue Plan already
emit the right input shape; the gap is entirely on the provider-availability
side. Re-check OpenRouter's catalog periodically (this is exactly the kind of
capability that could appear with no announcement) rather than building
toward it now.

**g. Capability matrix / duration-quantization.** 🟡 **Partially done
2026-09-14 — the concrete live bug is fixed, the forward-looking infra is
deferred.** Investigated before building anything new and found 3 of 6
enabled `VIDEO_GENERATION` models (`wan-2.6`, `seedance-2.0`,
`grok-imagine-video`) had `config: null` — meaning `planVideoSegments` sent
whatever duration a scene requested with zero validation, and (concrete bug)
`scene-video.ts`'s `supportsLastFrame` check defaulted to `true` on unset
config, so Narrata was sending a `last_frame` image to `wan-2.6` and
`grok-imagine-video`, neither of which support it. Fixed by backfilling real
`VideoModelConfig` for all 3 from OpenRouter's live `GET /api/v1/videos/models`
catalog (`supported_durations`, `supported_resolutions`,
`supported_frame_images`) — confirms the existing `durationMode: "fixed" |
"range"` mechanism already *is* the duration-quantization matrix, it just
needed real data (`wan-2.6` is genuinely sparse, `{5,10}` only; the others are
effectively continuous integer ranges). See
[[video-model-configs-backfilled-2026-09-14]]. **Deferred, not built:** a
declarative exclusion/arity matrix for optional passthrough *parameters*
(MiniMax mode⊥mode, Kling parameter⊥parameter, Wan arity) — no live bug
exists yet since Narrata doesn't send combinations of optional passthrough
parameters today; and an auto-fetch/cache layer keeping `VideoModelConfig`
synced to OpenRouter's live catalog automatically, instead of today's
one-time hand backfill (will drift again without one). Both are real
architectural decisions worth scoping deliberately before building, not
default-yes.

**h. Process rule: check a vendor's own deprecation page before adding any
model to `AiModelOption`, never the broker's catalogue.** OpenRouter listed
`sora-2-pro` as a headline model three weeks after OpenAI announced Sora's
shutdown — cheap to add, prevents a real incident class.

**h2 (renumbered from the agreed build order's step 4). ✅ DONE 2026-09-14.**
Folded continuity assertions into the existing `IMAGE_VALIDATION` vision call
(`runValidation` in `lib/shot-images.ts`) instead of a new critic — ~$0.04/image
vs ~$0.50/video clip, and the call already runs for every validated shot.
Changes: the previous shot's image now rides along as a second vision input
(already loaded for generation, zero extra fetch); `Shot.continuity` +
`continuityNotes` are rendered as explicit "continuity to preserve" facts in
the validation prompt; the system prompt now judges continuity adherence
(a dropped/contradicted carried prop or wardrobe change fails the same way a
mismatched character reference does) alongside the existing reference check.
Also broadened the trigger condition: validation now runs whenever there's
either a locked reference *or* continuity to check, not only when locked
references exist — a scene with only unlocked characters but real carried
state (a prop picked up last shot) is checked too. Still advisory-only, never
blocks generation.

**i. Tier-2 model-based quality/continuity critic.** 🟡 **Scoped 2026-09-14,
deliberately not built yet** — user chose scope-only over building, given
this repo's documented history of a new `AiJobType` causing a *silent* bug
(wrong model silently used, caught only by manual browser testing, not
typecheck/build) and no browser access being available to smoke-test in the
implementing session. Concrete design, ready to build when picked back up:

- **New `AiJobType.VIDEO_VALIDATION`**, default model
  `google/gemini-3.7-flash` — already trusted elsewhere in the registry
  (`MOTION_PROMPT_DRAFTING`, `AUDIO_CUE_PLANNING`) and confirmed video-capable
  (`input_modalities` includes `video`). **Cannot reuse `IMAGE_VALIDATION`'s
  model slot** — its current default (`gpt-5.6-luna`) doesn't accept video
  input at all (text+image+file only), confirmed via OpenRouter's live
  `GET /api/v1/models`.
- **No schema migration needed for storage** — `Asset.validationPassed` /
  `validationNotes` / `validationModelId` already exist and are asset-type
  generic (currently always null for `VIDEO_CLIP` rows since nothing writes
  them). Kept deliberately separate from `qcPassed`/`qcNotes`
  (`checkSegmentFrozen`'s deterministic, free, local ffmpeg check) — different
  failure modes, already-separated fields, no schema change either way.
- **Trigger point**: after each video segment/pair is generated and stored in
  `scene-video.ts` (mirrors `shot-images.ts`'s `runValidation` call after
  `generateImage`). Advisory-only, skipped entirely when no
  `VIDEO_VALIDATION` model is configured — same zero-cost-by-default posture
  as `IMAGE_VALIDATION`.
- **Rubric, deliberately minimal** (matches the "don't over-engineer" lesson
  from [[continuity-engine-gap-2026-09]]): reuse `IMAGE_VALIDATION`'s
  `{passed, notes}` shape, not `SeedVideoBench`'s full 4-dimension score or
  `Wan-Bench`'s 14-metric breakdown — those are development-time benchmark
  rubrics, not necessarily what one advisory per-clip check needs. One vision
  call judging: (1) reference consistency against locked
  character/location images, (2) continuity adherence against
  `Shot.continuity`/`continuityNotes` (reusing the same facts built for item
  h2 rather than reconstructing them), (3) prompt adherence (does the clip's
  actual motion/content match the requested camera movement/action).
  Explicitly deferred: motion-quality/physics/aesthetic scoring, best-of-N
  selection.
- **Implementation checklist when built** (from
  [[adding-ai-job-type-checklist]]): `schema.prisma` enum + migration;
  `ai-models-manager.tsx`'s `JOB_TYPES`/`JOB_LABELS`; `api/ai-models/route.ts`'s
  own separate `JOB_TYPES` array; `seed.ts` default row; a new
  `runVideoValidation()` mirroring `shot-images.ts`'s `runValidation()`; wire
  into `generatePairSegments` (and the TEXT_TO_VIDEO branch); manual smoke
  test of Settings → AI Models and a real generation — this last step is
  mandatory per the checklist's own history, not optional polish.

### THEN — Sprint 3–4 (weeks 6–10): make the first hour survivable

**7. First-run path / time-to-first-video.**
`SHOULD BUILD SOON`. A new user currently faces ~10 sequential surfaces
(project → story → bible → characters → locations → scenes → shots → images →
voice → music → cue plan → assembly) before seeing anything move. Manual-first is
correct and non-negotiable — but manual-first does not require *unguided*. Ship a
guided short-path: a seeded demo project, plus a "shortest complete loop" that gets
a 3-scene `ILLUSTRATION` story to an exported video in one sitting. Do **not**
solve this by auto-running generation. **Ask `growth-strategist`** for the
activation definition and `ui-ux-engineer` for the flow.

**8. Fold the Seedance page back into the registry.**
`SHOULD BUILD SOON` (small). `/projects/[id]/seedance` is a *model-named product
surface* — direct drift from the `AiModelOption` principle that every job type
reads its model from an editable registry. Whatever that page does better than the
generic scene-video panel (visible cast references, focused studio layout) is a
good idea that should be generic; the model name in the URL should not survive.

**9. Instrument the funnel (lightweight).**
`SHOULD BUILD SOON`. Piggyback on `GenerationEvent` rather than adding an analytics
SDK: signup → first project → first scene plan → first image → first video → first
assembly → first export. That is the whole activation funnel and it is derivable
from data item #4 already creates.

### LATER — beyond 90 days, in this order

10. **Resumable background job queue** (create `workers/` for real). Prerequisite
    for long-form chaining (`TODO-long-form-video.md` item 2), parallel generation,
    *and* Master AI. Biggest engineering item on the board; sequence it after cost
    telemetry so its spend is observable from day one. Ask `technical-architect`.
11. **Master AI Orchestrator** (`PHASES.md` Phase 12). Still correctly deferred —
    the sequencing decision that pipelines come first was right and should not be
    reversed. When built, **a per-run credit ceiling and a pre-run cost estimate
    shown to the user are hard requirements, not niceties**. Any auto-cascade
    proposal is a cost-control regression, not a UX improvement.
12. **Billing / credits / entitlements schema.** Only once there is a deployed
    cohort and real cost data. Pricing designed against estimates is a guess.
13. **Embeddings continuity memory** (`PHASES.md` Phase 13) and **producer
    controls at scale** (Phase 14). Both are hundreds-of-episodes problems; Narrata
    has zero users. Real, but not now.
14. **Long-form chaining + periodic re-anchoring** (`TODO-long-form-video.md`).
    Blocked on #10.

---

## 4. Do not build now

| Item | Why not |
|---|---|
| Team / multi-seat / Enterprise | No membership model; `Project` has one owner. Selling seats means building auth, sharing, and admin first (`../strategy/monetization.md` §3). |
| Public API / white-label | No product behind it, no cost controls to expose. |
| Translation / multi-format / distribution integrations | No trace in schema or code; export doesn't even exist yet. Do #6 first. |
| Full Showrunner→Producer agent hierarchy | Explicitly out of scope in `PHASES.md` Phase 12 and it stays out. |
| Device fingerprinting / fraud detection | No threat at invite scale; pure friction against the users whose feedback is the point. |
| More per-model dedicated pages | See #8. This is drift, not a feature. |

---

## 5. Roadmap risks that should reorder priorities

1. **Cost blindness — resolved 2026-09-14.** `GenerationEvent` now records real
   per-call cost for the 5 metered job types. Remaining exposure: text-planning
   calls are uninstrumented (deliberate, cheap fast-follow) and there is still no
   dashboard surfacing the data — EXP-004 and abuse detection are unblocked in
   principle but not yet *visible* to anyone.
2. **Stale voice IDs are a silent differentiator failure.** They break at first
   contact, in the exact feature Narrata claims as continuity. Fix before users.
3. **The auth-before-deploy shift is mostly *done* — the real gate moved.** Auth
   exists; static `SIGNUP_CODE` + zero rate limiting + no credit ceiling is what
   actually stands between Narrata and an uncapped bill. Reframe the deploy
   checklist accordingly.
4. **`workers/` doesn't exist.** Two docs assume it does. Everything that depends
   on it (long-form, parallelism, Master AI) is one large unbuilt component
   further away than the docs imply. Plan accordingly.
5. **Veo 3.1 Standard as default is a live 8× cost multiplier** running today
   against every generation the invite cohort makes.
6. **Doc drift.** `PHASES.md` marks Phase 9 unverified when it is built, and cites
   a `workers/` directory that doesn't exist. Cheap to fix; expensive if a future
   plan is built on it.
7. **The journey has no ending.** No export = no shareable artifact = no
   word-of-mouth, no retention proof, and no measurable activation.

---

## 6. Metrics to define alongside this work

North Star candidate (mine, pending `company-vision`'s call):
**recurring creators who complete a second project.**

Near-term supporting metrics, all derivable from `GenerationEvent` (#4):
time to first exported video; % of signups reaching first export; provider USD
cost per activated user; regeneration rate per job type (a direct quality signal);
video-vs-illustration mode mix; failed-generation rate by provider.

---

## 7. Cross-agent asks

| Agent | Question |
|---|---|
| `ai-architect` + `technical-architect` | Should voice IDs become a registry like `AiModelOption` (#3)? |
| `ai-architect` + `video-architect` | Own the parallel pipeline-quality track (Section 3, items a–i) — continuity fix, reference textual-anchoring, `wan-2.7` continuation, prompt-rewrite audit, capability matrix, tier-2 critic. |
| `video-architect` | Settle the default video model; run EXP-004 (#5). |
| `ui-ux-engineer` | Export/share placement (#6); guided first-run without breaking manual-first (#7). |
| `growth-strategist` | Define activation; own the funnel definition for #9. |
| `technical-architect` | Scope the resumable job queue / `workers/` (#10). |
| `qa-engineer` | Rate-limit correctness and the in-flight illustration-timing change. |
| `company-vision` | Write `VISION.md`: premium vs. creator-economy, India-first vs. global, North Star. |
| `product-manager` | Turn sprints 1–4 above into scheduled work. |
