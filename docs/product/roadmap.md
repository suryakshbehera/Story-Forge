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

**Not built** (`FACT`, absence verified):

- No cost capture. `apps/web/src/lib/ai/openrouter.ts` contains **zero**
  occurrences of `usage` or `cost` — OpenRouter's per-call USD figure is parsed
  past and discarded.
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

**4. Capture `usage.cost` + a `GenerationEvent` record.**
`MUST BUILD NOW` — **the single highest-leverage item in this document.** Narrata
is already handed the exact USD charge per video call and throws it away
(`openrouter.ts`). One field plus one table converts every estimate in
`../strategy/economics.md` into a measurement, and simultaneously delivers:
pricing input, abuse detection, the Phase-14 budget dashboard's data spine, and
the first real product analytics Narrata has ever had. Log `jobType`, `modelId`,
USD cost, duration, success/failure, project/scene/shot id.
*Complexity: LOW. Strategic value: very high.* Owners: `ai-architect` +
`technical-architect`.

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

1. **Cost blindness is the #1 risk.** `FACT`: no cost is recorded anywhere. It
   blocks pricing, blocks EXP-004, blocks abuse detection, and blocks knowing
   whether any of this is viable. It is a ~small change. This is why it outranks
   every feature.
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
| `ai-architect` + `technical-architect` | Capture `usage.cost` + `GenerationEvent` (#4). Should voice IDs become a registry like `AiModelOption` (#3)? |
| `video-architect` | Settle the default video model; run EXP-004 (#5). |
| `ui-ux-engineer` | Export/share placement (#6); guided first-run without breaking manual-first (#7). |
| `growth-strategist` | Define activation; own the funnel definition for #9. |
| `technical-architect` | Scope the resumable job queue / `workers/` (#10). |
| `qa-engineer` | Rate-limit correctness and the in-flight illustration-timing change. |
| `company-vision` | Write `VISION.md`: premium vs. creator-economy, India-first vs. global, North Star. |
| `product-manager` | Turn sprints 1–4 above into scheduled work. |
