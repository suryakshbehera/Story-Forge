# Narrata — Competitor UI/UX Research & Adoption Plan

**Owner:** `ui-ux-engineer`
**Created:** 2026-09-14
**Status:** v1. First outward-looking UX study.
**Companion to:** [`./ux-audit-2026-09.md`](./ux-audit-2026-09.md) — that document
is a 100% internal, code-derived audit. This is the missing external half. Read
them together: the audit says what is broken, this says what the rest of the
field does about it.
**Also see:** [`./roadmap.md`](./roadmap.md),
[`../video-platform-intelligence/`](../video-platform-intelligence/) (generation-
pipeline/model intelligence — deliberately **not** duplicated here; this document
is strictly about interface and workflow).

Evidence labels: `FACT` (read on the vendor's own site/docs today) /
`ASSUMPTION` (read on a third-party review or reconstructed from several
sources) / `UNKNOWN` (could not establish).

---

## 0. Method & honesty note

I have **no browser, no screenshots, and no account on any of these products.**
Everything below was gathered by reading vendor documentation, help centres,
changelogs, and third-party reviews. That has a specific failure mode worth
stating plainly:

- Vendor help docs describe UI **regions and names** accurately (`FACT`-grade).
- Vendor marketing pages describe **capabilities**, not layout. I have demoted
  those to `ASSUMPTION` wherever they implied an interface.
- Third-party reviews describe **impressions**. Demoted to `ASSUMPTION`.
- `help.runwayml.com` returned **HTTP 403** to every direct fetch, so Runway's
  entries lean on search-result excerpts of those same pages plus
  `runway.com/changelog` (which did load). Runway is therefore the weakest
  evidence set here; I have marked it accordingly rather than inflating it.

I also re-verified Narrata's own current state today rather than trusting the
audit's "current state" section — §2 lists exactly what changed.

---

## 1. Findings per platform

### 1.1 LTX Studio — the closest analog

The only researched product whose object model is the same shape as Narrata's:
script → scenes → shots → generated assets → assembly.

| | |
|---|---|
| `FACT` | **Hierarchy is synopsis → scenes → shots.** The product expands a synopsis, breaks it into scenes, and divides each scene into specific shots. This is Narrata's Story → Scene → Shot, independently arrived at. |
| `FACT` | **Onboarding is one field.** You enter a synopsis; the system generates a title and a character set. Aspect ratio and cinematic style are chosen up front and remain changeable later. |
| `FACT` | **Left sidebar = scene-scope settings** (location, lighting, weather) applying to every shot in that scene. **Shot editor = a separate panel** exposing shot type (wide/medium/close-up), camera angle, motion preset + motion intensity, negative prompt, duration, frame rate. Layout is explicitly **list-detail with a scoped inspector**, not a stack. |
| `FACT` | **The storyboard generator extracts characters, objects and locations from the script and lets you edit/refine them *before* you press Generate.** Extraction is a reviewable draft, not an automatic commit. |
| `FACT` | **Both a Storyboard view and a Timeline view exist.** The timeline is for combining shots, transitions and export — it is the *assembly* surface, not the *authoring* surface. |
| `FACT` | **"Retake"** regenerates a specific shot or segment — adjusting action, emotion or dialogue — while holding visual consistency, instead of rebuilding the sequence. |
| `FACT` | **Editing is non-destructive: "your source generations are never altered — you're arranging references, not files."** Reorder, replace or restructure without rebuilding. |
| `FACT` | **Credits (renamed from "computing seconds") are shown at the top of the app and update in real time after each action.** Cost varies by duration, resolution and model complexity. |
| `ASSUMPTION` | Per-shot in-progress indicators live on the shot tile itself (implied by shot-level Retake, never stated). |
| `UNKNOWN` | Mobile/responsive behaviour. No evidence found either way. |
| `UNKNOWN` | What happens to a *failed* shot generation — no failure-state documentation found. |

**Why this matters most:** LTX independently converged on scene-rail + focused
shot + scoped inspector, and on "generations are references you arrange".
Narrata already has the second idea (the `isSelected` take model) and is missing
the first (ux-audit §3.1).

---

### 1.2 Synthesia — best-documented multi-step production UI

Script-driven, not shot-driven, but it solves "many steps, one pipeline" more
explicitly than anyone else researched.

| | |
|---|---|
| `FACT` | **Five fixed regions:** toolbar (top), **scene list (left)**, canvas (centre), **inspector (right)**, **script box (bottom)**. |
| `FACT` | **The inspector is scope-contextual:** with nothing selected it shows *scene* settings; select an element and it switches to that element's settings. One panel, two scopes, no new surface. |
| `FACT` | **The script box at the bottom owns the script *and* the avatar, language and voice speaking it** — voice identity lives with the words, not in a settings page. |
| `FACT` | **Generate opens a pre-flight panel** (title, description, captions, chapters) and **flags anything blocking generation before processing starts** — unsupported characters in the script, moderation issues, missing permissions. |
| `FACT` | **Named generation stages, shown to the user: _Moderating, Queued, Preparing, Rendering, Assembling, Finalizing_.** Not a percentage — a named position in a known sequence. |
| `FACT` | **Auto-snapshot every 30 minutes, plus a snapshot on every generate.** Snapshots can be restored or duplicated from version history. |
| `FACT` | Help copy explicitly asks users **not** to re-submit a generation ("this will hinder the process, resulting in increased wait times") — i.e. they have no double-fire guard and handle it with documentation. |
| `ASSUMPTION` | Email notification on completion is standard; render times commonly quoted as 3–10 minutes, up to 30 for long/custom videos (third-party reviews, not vendor-stated). |
| `UNKNOWN` | Whether per-stage progress is also exposed via any project-level dashboard, or only on the individual video. |

**Two directly stealable things:** the named-stage vocabulary, and the
pre-flight panel that surfaces blockers *before* you spend anything. Narrata
already beats Synthesia on the double-fire problem (generation claims, shipped
in ux-audit 2.1) — that is worth noting as a lead, not a gap.

---

### 1.3 HeyGen — pathway-first onboarding

| | |
|---|---|
| `FACT` | **One `Create` button branches into five named pathways:** Video Agent (prompt → whole video), AI Studio (full control, script → video), PDF/PowerPoint conversion, Photo to Video, Templates. The user picks an *intent*, not a tool. |
| `FACT` | **A scene "works like a slide in a presentation"**; opening the Editing Studio auto-creates the first scene, **linked to a script section on the left**. Script and scene are bound, not parallel. |
| `FACT` | **Statuses are `processing` and `queued`**, with concurrency limits explained in-product: queued means waiting for a slot, **explicitly "does not mean those projects have failed."** |
| `FACT` | Vendor-stated throughput: roughly **10 minutes of render per 1 minute of avatar video**; video translation ~5:1. They publish the ratio rather than a spinner. |
| `ASSUMPTION` | An error badge appears on the item in the video library when a render fails, and the recovery is delete-and-regenerate (third-party troubleshooting sources). |
| `ASSUMPTION` | Realistic hands-on time for a 5-minute explainer is quoted at 30–60 minutes (third-party review). |
| `UNKNOWN` | Whether HeyGen shows queue *position*, or only queue *membership*. |

**The useful lesson is not the slide metaphor** (too flat for narrative) — it is
that the *first decision a new user makes is about intent, not about
machinery*, and that **queued ≠ failed is stated in the interface**, not left
for the user to infer from a stalled spinner.

---

### 1.4 Runway — asset/generation organisation (weakest evidence)

Help-centre pages 403'd; entries below come from search excerpts of those pages
plus the public changelog.

| | |
|---|---|
| `FACT` (changelog) | Progressive asset-management build-out: **Assets V2** ("redesigned the assets page to make it easier to find and reuse generations"), **sorting** by asset type / media type / duration / creator / date / favourite, **favouriting**, **bulk download, move and share**. |
| `FACT` (changelog) | **Projects + Brand Kits in Agent** (Aug 2026): a project's assets and brand kits are "instantly accessible from inside the session, so you never re-upload logos, product shots or style references." |
| `FACT` (changelog) | **Timeline in Agent** (Jul 2026) — multi-step assembly inside a conversational surface. **Light Mode** shipped Sep 2025 (i.e. dark was the default for years). **Mobile App Generation Feed** (Jul 2024) — mobile is a *feed for viewing generations*, not a production surface. |
| `FACT` (help excerpts) | **Sessions** are "a folder or group of generations you create at a given time"; **Projects** "add an additional layer of structure and organize assets, sessions, and workflows per a single creative effort". |
| `FACT` (help excerpts) | Generations appear **chronologically in the right-hand pane, oldest at top, latest at bottom** — a transcript, not a grid. |
| `FACT` (help excerpts) | **Current credits are shown in the top-right corner of a session**; full totals on the Billing page. |
| `FACT` (help excerpts) | **Workflows** are a **node-based editor** — nodes take input from other nodes, each running a function or a specific model — for "scalable, automated, repeatable creative pipelines". |
| `ASSUMPTION` | The full IA is Workspace → Project → Session → Generation, with assets shared at Project level. Consistent across all excerpts but never stated as a whole. |
| `UNKNOWN` | How an in-flight generation renders in that right-hand pane (placeholder card? progress bar? nothing until done?). |
| `UNKNOWN` | Failure presentation. |

**The signal:** Runway spent two years adding *findability* to generations —
sort, favourite, bulk-act, share, reuse-without-re-upload. That is a maturity
curve Narrata has not started at all (see §2, finding C1).

---

### 1.5 Kling AI — mode-first IA and queue transparency

| | |
|---|---|
| `FACT` | Credit-based, with a **dedicated generation queue and unlimited concurrent tasks as paid features**; free tier shares queue capacity. Free credits documented as 66/day reset at **midnight UTC, not local midnight**. |
| `ASSUMPTION` | Primary navigation is **mode-first**: Text to Video / Image to Video / Elements (multi-element canvas) as left-sidebar or top tabs, each with a prompt field plus aspect-ratio, quality and length controls. Model version is a dropdown within the same interface. (Consistent across several third-party tutorials, no vendor doc read.) |
| `ASSUMPTION` | Completed generations land in a **"My Creations"** library, which occasionally lags behind the job's true state — users are advised to refresh. |
| `ASSUMPTION` | Busy-queue state is surfaced as a message plus an upsell ("upgrade for a faster generation"). |
| `UNKNOWN` | Per-job progress detail. |

**Mostly a rejection case.** Kling's top-level IA is the *model's* input modality
(text→video vs image→video). That is exactly ux-audit **F8 — AI architecture
leaking into the interface** — shipped as navigation. Narrata's inversion
(`visualMode` as a *scene* property the user reasons about narratively) is the
better design and should be defended, not revisited.

---

### 1.6 Luma Dream Machine — spatial canvas

| | |
|---|---|
| `FACT` | **Boards** is an infinite-canvas surface for building image sequences — storyboards, character sheets, shot plans — organised **spatially**. |
| `FACT` | Designed around **generating multiple outputs in parallel** and keeping **master reference assets for consistency** across a project, rather than juggling one-off generations. |
| `FACT` | **Brainstorm** mode (explore variations without detailed prompts), **Concept Pills** (preset unified styles applied across outputs), **Modify** (targeted change to an existing generation). |
| `FACT` | Ships a first-class native mobile app. |
| `UNKNOWN` | How ordering/sequence is expressed on an unordered canvas — the obvious weakness for narrative work. |

**Adopt one idea, reject the container.** "Master reference assets held at
project level for consistency" is exactly Narrata's locked characters + style
anchor, and validates that direction. The infinite canvas itself is wrong for
Narrata: scene order *is* the story, and a spatial canvas makes order ambiguous.

---

### 1.7 Pika — library as the home surface

| | |
|---|---|
| `ASSUMPTION` | The **Library** is the default home: every generated video lands there automatically, organisable into **folders**, with a **search bar that finds old generations by prompt keyword**. (Third-party guides only; no vendor doc read.) |
| `ASSUMPTION` | Per-item actions are **retry** (same prompt, slight variation) and **regenerate** (edit prompt and re-run) directly from the library item. |
| `UNKNOWN` | Anything about progress, failure or cost display. |

Thin evidence; included only because it reinforces the Runway signal — for
generation-first products, **the library, not the editor, tends to become the
home screen.** Narrata is not generation-first, so this is a caution, not a
target (§3, R7).

---

### 1.8 Cross-platform pattern: cost shown *before* the spend

Not a single platform — a convergent pattern found across several products,
worth isolating because it maps directly onto the audit's open item 2.4.

| | |
|---|---|
| `FACT` | **LTX Studio:** live credit balance at the top of the app, updating in real time after each action. |
| `ASSUMPTION` | **InVideo:** the agent returns the **planned image count, video clip count and credit estimate** before running — scope *and* price. |
| `ASSUMPTION` | **Vidrush:** an estimated total is shown for every generation before approval, in a "Quote Statement" that **recalculates as you change duration or model**, with nothing spent until confirmation. |
| `ASSUMPTION` | **Rendair:** "the exact cost is always calculated and displayed in the interface before you confirm an action." |

The shared shape is: **scope → price → adjustable inputs → explicit confirm.**
All of these run on published rate cards. Narrata, as of today, can do something
none of them can — see §2, finding C2.

---

## 2. Narrata's current state, re-verified today

The audit's current-state claims are dated 2026-09-10/11. Re-read today
(2026-09-14) against working-tree state. Changes that matter:

**Still true, verified today (`FACT`):**

- `scene-manager.tsx` L410–440 still renders **a flat vertical stack of
  `SceneRow` cards**, one per scene, all mounted. ux-audit **0.6 shipped** — each
  row's Shots / Video / Voice / Music&SFX are now `Collapsible` with a
  `SectionTrigger` completion tick (L726–800, L807–815) — but **3.1 did not
  ship**: there is no scene rail, no focused-scene detail pane, no list-detail.
- `app/projects/[id]/story/scenes/page.tsx` still loads **every scene with the
  full nested include set** (`SCENE_INCLUDE` + voice + video + audio, each with
  every take ordered desc) in one query, then mounts them all.
- Three `window.location.reload()` calls remain (`audio-cue-plan-panel` L121,
  `document-ingest-panel` L100, `story-chat-panel` L94).
- `project-nav.tsx` is now 4 ordered, ticked tabs; `Seedance 2.5` is gone from
  nav. ux-audit 1.2 holds.
- `/projects/[id]/page.tsx` is a real 7-row status board with one `Continue`
  primary action. ux-audit 1.1 holds.
- `video-assembly-panel.tsx` renders "Step 3 of 4 — Final Assembly" and "Step 4
  of 4 — Download & Share" with Download + copy-link. ux-audit 0.1/3.2 hold.

**Changed since the audit — new, and it moves the plan:**

**C1. There is no asset library anywhere in Narrata (`FACT`, new finding).**
Enumerating `app/api/**/[assetId]` returns 21 asset routes — shot images,
character images, location images, narration, dialogue audio, music, sfx, scene
video, silent video, final video — and **every one of them is reachable only
through its owning parent object.** There is no `/projects/[id]/assets` route,
no search, no filter, no favourite, no cross-scene reuse, no "where did that
good take go". Runway spent two years building exactly this (§1.4) and Pika made
it the home screen (§1.7). This is not in the ux-audit at all.

**C2. `GenerationEvent` landed, and nothing reads it (`FACT`, unblocks 2.4).**
`packages/db/prisma/schema.prisma` L1023–1043 defines `GenerationEvent` with
`jobType`, `provider`, `modelId`, `projectId`, `entityType`, `entityId`,
**`costUsd`**, **`durationMs`**, **`success`**, **`errorMessage`**, `createdAt`,
indexed on `projectId` and `jobType`. `lib/generation-events.ts` writes it, and
it is wired into all five metered job types — `shot-images.ts` (L413, L426),
`scene-video.ts` (L379, L392, L615, L628), `scene-audio.ts` (L156, L169, L274,
L287), `voice.ts` (L146, L159, L696, L709) — on both the success and failure
paths. `openrouter.ts` genuinely extracts `usage.cost` for images (L246), video
(L342) and streamed audio (L556).

Grepping for read call sites returns **zero outside `lib/generation-events.ts`
itself.** There is no API route, no page, no component that consumes it.

Three separate open items are unblocked by this, not one:
- ux-audit **2.4** (pre-generation cost estimate) — was deferred *explicitly*
  pending this table. It has landed. **2.4 is now unblocked.**
- ux-audit **2.2's known gap** ("shows in-flight only, not failure history —
  nothing persists a failed attempt once its toast dismisses"). `success` +
  `errorMessage` + `entityId` now persist exactly that.
- **ETAs**, which no open item anticipated. `durationMs` per `jobType` per
  `modelId` is a real observed distribution.

**C3. The job tray is thinner than every competitor's equivalent (`FACT`).**
`job-tray.tsx` is 71 lines. `InFlightJob` is `{ jobType, label, startedAt, href }`
(`lib/generation-claims.ts` L28–33). It polls every 5s, ticks elapsed time every
1s, and **collapses two or more concurrent jobs into the unclickable string
`"N generating…"` with no list** (L66–68). No stage, no ETA, no cancel, no
failure, nothing persisted across a tab close. Synthesia names six stages;
HeyGen distinguishes queued from processing and publishes a time ratio. Narrata
shows a label and a stopwatch.

---

## 3. Synthesis — adopt, adapt, reject

### Adopt

| # | Pattern | Source | Why for Narrata |
|---|---|---|---|
| A1 | **Scene rail (left) + focused scene (centre) + scope-contextual inspector (right)** | LTX `FACT`, Synthesia `FACT` | The two closest analogs converged on this independently. It is the strongest single signal in this document. **Confirms ux-audit 3.1 and extends it** — see §5. |
| A2 | **Named generation stages instead of a spinner** | Synthesia `FACT` (Moderating/Queued/Preparing/Rendering/Assembling/Finalizing) | Narrata's pipeline has real, nameable server-side stages (prompt built → provider submitted → polling → downloading → persisting). Naming the current one costs nothing and is honest in a way a fake percentage is not. |
| A3 | **Observed-median ETA, from `durationMs`** | HeyGen `FACT` (publishes a 10:1 ratio); nobody does it from live data | Narrata can beat the field here: a real p50 for *this* job type on *this* model, not a marketing ratio. Requires only a read of C2's table. |
| A4 | **Pre-flight panel on expensive actions: scope → cost → blockers → confirm** | Synthesia `FACT` (blocker flagging), InVideo/Vidrush/Rendair `ASSUMPTION` (scope + price + live recalculation) | This *is* ux-audit 2.4, now buildable. Narrata's version is better than the competitive norm because C2 gives real observed cost, not a rate card. |
| A5 | **Extraction is a reviewable draft, gated before Generate** | LTX `FACT` (characters/objects/locations extracted, editable, then Generate) | Narrata already half-does this (ingest preview, unmatched-names warning) but the unmatched-names case is a **dismissible amber card**, not a gate — a user can generate shots for scenes referencing characters that do not exist. Promote warning → pre-flight blocker. |
| A6 | **Project-level asset findability: search, filter, favourite, reuse** | Runway `FACT` (Assets V2, sort, favourite, bulk), Pika `ASSUMPTION` (library + prompt search) | Finding C1. Narrata generates a large number of durable assets and offers zero ways to find one that is not through its parent. Every comparable product built this. |
| A7 | **Failure is a persistent badge on the object, not a toast** | HeyGen `ASSUMPTION` (error badge in library) | Closes ux-audit 2.2's stated gap using C2's `success`/`errorMessage`/`entityId`. |
| A8 | **"Queued ≠ failed" stated in the interface** | HeyGen `FACT` | Narrata has no queue, but it has the same *perception* problem: a long-running claim looks identical to a hung one. Say what is happening. |
| A9 | **Snapshot version history at document scope, not just asset scope** | Synthesia `FACT` (auto every 30 min + on every generate) | Narrata has excellent per-asset take history and **no** story/scene-text history. Losing an hour of script rewriting is currently unrecoverable. Lower priority than A1–A7, but a real hole. |
| A10 | **Intent-first first decision** | HeyGen `FACT` (five named `Create` pathways) | Validates ux-audit 1.4 (intent step before Story Setup), which shipped. Extend the same idea to the demo-project entry point: name the outcomes, not the tools. |

### Adapt

| # | Pattern | Change for Narrata |
|---|---|---|
| D1 | **LTX's Storyboard ⇄ Timeline toggle** (`FACT`) | Adopt the *view*, reject the *editor*. Narrata should gain a **read-only linear filmstrip** of the assembled sequence — every scene's selected image/clip in order, with duration and gaps visible — as a review surface feeding Silent Assembly. Not draggable, not trimmable. This is a **qualification** of the ux-audit's blanket "no timeline" rejection, not a reversal: see §6. |
| D2 | **LTX's "Retake"** (`FACT`) | Narrata already says "take" and already regenerates per shot/shot-pair. Adopt the *vocabulary consistency* only — use one word ("take") everywhere, never "version"/"alternate"/"clip" for the same concept. Cheap; addresses ux-audit F17. |
| D3 | **Luma's project-level master reference assets** (`FACT`) | Narrata's locked characters + style anchor already are this, but they are invisible while you work — they live on other pages. Surface them as a persistent, read-only "Consistency" strip in the scene inspector (A1's right column). |
| D4 | **Runway's credit chip, top-right** (`FACT`) | Narrata has no credits. Adapt to **cumulative project spend to date**, from C2, on the project overview — not a chip in global chrome. Spend is a *project* fact here, not an *account* fact. |

### Reject

| # | Pattern | Source | Why not |
|---|---|---|---|
| R1 | **Node-based workflow editor** | Runway `FACT` | The single most direct violation of "complexity belongs inside the system". It asks the user to become the pipeline. Narrata's whole thesis is the opposite. |
| R2 | **Infinite spatial canvas as the authoring surface** | Luma `FACT` | Scene order *is* the narrative. A canvas makes order ambiguous and un-assemblable. Keep the ordered list. |
| R3 | **Full editable NLE timeline** | LTX `FACT` | Confirms the ux-audit's existing rejection. Narrata's edit model is take-selection, and take-selection is *better* for AI-generated material because the atoms are regenerable, not trimmable. Adopt D1's read-only filmstrip instead. |
| R4 | **Chat/agent mode as the primary entry point** | Runway Agent `FACT`, HeyGen Video Agent `FACT` | Contradicts manual-first. Narrata's differentiator is that the human writes, edits, locks and selects. A prompt-to-finished-video front door would make everything behind it feel like overhead. Revisit only as a clearly-labelled accelerator, never as the default. |
| R5 | **Mode-first navigation (Text-to-Video / Image-to-Video as top-level tabs)** | Kling `ASSUMPTION` | This is ux-audit **F8** shipped as an information architecture. Narrata's per-scene `visualMode` — a narrative decision with an editable AI reason, made where the scene is — is strictly better. Defend it. |
| R6 | **Scene as slide** | HeyGen `FACT` | Flattens away the shot layer. Narrata's Scene → Shot → take hierarchy is the thing that makes continuity tractable. |
| R7 | **Library as home screen** | Pika `ASSUMPTION`, Runway `ASSUMPTION` | Adopt the library (A6); reject it as *home*. Those are generation-first products where the unit of work is one clip. Narrata's unit of work is a story. Home stays the project status board (ux-audit 1.1). |
| R8 | **Exposing queue position / concurrency limits** | Kling `FACT`, HeyGen `FACT` | Narrata has no queue. Do not invent queue UI to display a queue that does not exist. If `workers/` (roadmap #10) ever lands, revisit. |

---

## 4. Phased plan

Same format and conventions as [`ux-audit-2026-09.md` §3](./ux-audit-2026-09.md).
Numbering continues from that document (which ended at Phase 3) so these slot
into the existing roadmap without renumbering. Effort is rough dev-days for one
engineer.

**This plan absorbs the two open items from the audit rather than competing with
them:** 4.1 *is* audit 2.4, and 5.1 *is* audit 3.1. Both are reframed by the
research — see §5 for exactly how.

### Phase 4 — Read what we already record (~6–7 days)

Everything here is UI over `GenerationEvent`, which exists, is populated, and has
zero readers (C2). Highest value per day in this document.

**4.1 shipped 2026-09-14.** Scoped down on delivery: `GenerationEvent` never
recorded the two ffmpeg assembly steps (jobType `VIDEO`), so there was no
duration data for Silent/Final Assembly at all — added `recordGenerationEvent`
calls to `generateSilentAssembly`/`assembleVideo` (`lib/video-assembly.ts`,
`costUsd` always `null`, no paid API call) as a prerequisite. New
`GET /api/projects/[id]/estimates` (global median cost/duration, model-specific
falling back to jobType-wide below 3 samples) backs a shared
`useGenerationEstimate` hook now wired into all three panels. `scene-video-panel`
gained a confirm step for multi-clip batches (`clipCount > 1`); the two assembly
panels show ETA only (no cost, no confirm — there's nothing costly to gate).
4.5's unmatched-characters blocker was intentionally left out (separate item).

**4.2 shipped 2026-09-14.** `InFlightJob` gained `stage` (a human label per
`GenerationJobType`, e.g. "Video generation" — distinct from `label`, which
names the entity, e.g. "Scene 2 video") and `etaSeconds` (observed median
duration for that job's `AiJobType`, via `getGenerationEstimate`, minus
elapsed — jobType-wide, not model-specific, since a tray entry doesn't carry
which model it's running without extra per-entity lookups). `jobs/route.ts`
now does a second enrichment pass over the raw claims: dedupes to the unique
`AiJobType`s actually present, fetches one estimate per, then maps stage/ETA
onto each job before sorting. `job-tray.tsx`: single job unchanged in shape,
now shows stage + ETA inline; 2+ jobs no longer collapse to "N generating…"
with no way to see them — the pill opens a dropdown (`DropdownMenu`) listing
every job with its stage, label, elapsed time, and ETA, each linking to
`job.href`.

| # | Item | Touches | Est. | Adopts | Closes |
|---|---|---|---|---|---|
| 4.1 | **Pre-flight panel on the expensive actions** (video generation, silent assembly, final render): scope line ("18 shots → 9 clips"), observed-median cost from `GenerationEvent.costUsd`, observed-median duration, blocking issues listed, then confirm | `scene-video-panel`, `silent-assembly-panel`, `video-assembly-panel`, new `GET /api/projects/[id]/estimates` | 2.5d | A4, A5 | **audit 2.4** |
| 4.2 | **Named stages + ETA in the job tray**; expand `InFlightJob` with `stage` and `etaSeconds`; **list every job when there are 2+** instead of `"N generating…"` | `job-tray`, `generation-claims`, `jobs/route.ts` | 2d | A2, A3, A8 | C3 |
| 4.3 | **Persistent failure badge on the failed object** + inline retry, reading `success: false` + `errorMessage` + `entityId`; keep `generation-error.tsx`'s Problem → Explanation → Action shape and give it durable data | `generation-error`, all generation panels, jobs API | 1.5d | A7 | **audit 2.2's stated gap** |

**4.3 shipped 2026-09-14.** Skipped `jobs/route.ts` — a failure isn't an
in-flight claim, so the job tray isn't the right surface for it; that touch
in this row looks like scope creep from the original research. Found a real
gap in 4.1's own foundation: both assembly steps recorded `jobType: "VIDEO"`
with no field distinguishing silent vs. final assembly, so a failure from
one would've incorrectly surfaced on the other panel — fixed by giving them
distinct `provider` values (`ffmpeg-silent-assembly` / `ffmpeg-final-assembly`)
and setting `entityId: parentId`, which they'd been omitting. New
`getActiveFailures(projectId)` (`lib/generation-events.ts`) reads the last
~100 `GenerationEvent` rows for the project and keeps the newest per
identity slot, filtered to failures — "resolved once a newer success
exists," no polling needed since a failure is static until the next
attempt. `ShotItem.lastImageError`, `SceneItem.{lastNarrationError,
lastVideoError,lastMusicError,lastSfxError}`, `DialogueLineItem.lastAudioError`,
and a new `initialError` prop on 4 more panels all seed the existing
`lastError` state instead of starting at `null`; both `page.tsx` files
fetch once and merge into the mapped scene tree. One real subtlety: VOICE
and IMAGE_GENERATION are entity-scoped by SCENE/SHOT/DIALOGUE_LINE, but
VIDEO_GENERATION is scoped differently per `scene.visualMode` —
TEXT_TO_VIDEO logs under SCENE, IMAGE_TO_VIDEO logs under SHOT (per shot-pair,
for the per-pair retake) — so `sceneVideoFailure()` checks both, since the
panel only has one whole-panel `lastError`, not a per-pair one.
| 4.4 | **Project spend to date** on the project overview — total, and a per-stage breakdown by `jobType` | `projects/[id]/page.tsx` | 0.5d | D4 | — |

**4.4 shipped 2026-09-14.** New `getProjectSpend(projectId)` groups
`GenerationEvent` by `jobType` and sums `costUsd` (null on every
failure-branch event, so a failed attempt contributes 0, not an error) —
plain `groupBy`, no estimate/fallback logic needed since this is an exact
historical total, not a prediction. New "Spend to date" card on the project
overview: total prominently, then a breakdown row per job type with nonzero
spend (assembly's `VIDEO` jobType is always $0 — local ffmpeg — so it's
naturally filtered out rather than special-cased). Shows "No paid
generations yet" rather than an empty breakdown on a fresh project.
| 4.5 | **Promote the unmatched-characters warning from dismissible card to pre-flight blocker** on shot generation for affected scenes | `scene-manager`, `shot-manager` | 0.5d | A5 | — |

**4.5 shipped 2026-09-14.** The existing warning was a single project-wide
flat list with no per-scene association — `generateScenes` (`lib/scenes.ts`)
tracked unmatched names globally but discarded which specific scene
mentioned which name. Added `sceneUnmatchedNames: Record<sceneId, string[]>`
to `GenerateScenesResult`, zipped from a per-scene `Set` built during the
same map that already produces the flat list (no extra AI call or query).
`scene-manager.tsx` keeps the existing dismissible card unchanged and adds a
per-scene lookup passed to `ShotManager`, whose "Generate Shots"/"Regenerate
Shots" click now goes through a `confirm()` gate first when its scene has
unresolved names — "Generate Anyway" proceeds, matching the confirm-not-hard-
block pattern 4.1 already established for multi-clip video generation.
Scoped to the scene-level shot-planning action only, not the per-shot image
button — gating every individual image click would be noisy for a
scene with many shots. Session-only, same lifetime as the pre-existing card
(not persisted — a reload loses both, no regression from today).

Phase 4 complete: all 5 items shipped.

> 4.1 and 4.2 together convert Narrata from "weakest feedback on the most
> expensive jobs" (audit F5, partially fixed) to **better than any platform
> researched**, because the numbers are observed rather than published.

### Phase 5 — Workspace shape (~11–13 days)

| # | Item | Touches | Est. | Adopts |
|---|---|---|---|---|
| 5.1 | **Scene workspace: rail + focused scene + scope-contextual inspector.** Left: ordered scene rail with per-scene completion dots (Shots/Video/Voice/Audio — the data already exists in `SectionTrigger`). Centre: one `SceneRow` as detail. Right: inspector showing *scene* scope by default, *shot* scope when a shot is selected. Load only the focused scene's heavy includes | `scene-manager`, both scene routes, scenes page query | 9d | A1, D3 |
| 5.2 | **Consistency strip** in the inspector: locked characters, style anchor, previous-shot reference — read-only, always visible while working on a scene | new, inspector column | 1.5d | D3 |
| 5.3 | **Read-only assembled filmstrip** above Silent Assembly: every scene's selected image/clip in order, with durations and gaps; click to jump to that scene | new, scenes/episode pages | 2d | D1 |

> 5.1 subsumes the scenes page's all-scenes-with-all-takes query (§2). At
> realistic episode length that is the largest single performance win available,
> and it is a side effect of the layout change rather than separate work.

### Phase 6 — Findability & recovery (~6 days)

| # | Item | Touches | Est. | Adopts |
|---|---|---|---|---|
| 6.1 | **Project asset library** at `/projects/[id]/assets`: every generated asset with type filter, scene filter, selected/unselected filter, and "jump to where this is used" | new route + API | 3d | A6 |
| 6.2 | **Favourite / keep** on takes, surfaced in the library and in take galleries | schema flag + take galleries | 1d | A6 |
| 6.3 | **Story/scene text snapshot history** — snapshot on save and on every generate, restorable | `story-editor`, `scene-manager`, schema | 2d | A9 |

### Phase 7 — Polish (~3 days)

| # | Item | Touches | Est. | Adopts |
|---|---|---|---|---|
| 7.1 | **One vocabulary pass**: "take" everywhere; kill "version"/"alternate"/"clip" as synonyms for the same object | app-wide copy | 0.5d | D2 |
| 7.2 | **Remove the three `window.location.reload()` calls** (cue plan apply, story chat apply, document ingest apply) — with 5.1's focused loading these become cheap targeted refetches | 3 panels | 1.5d | — |
| 7.3 | **Completion notification** when the tab is backgrounded (Notification API, permission-gated, opt-in) — Synthesia emails, Narrata can do it in-browser for free | `job-tray` | 1d | A2 |

---

## 5. Reconciliation with `ux-audit-2026-09.md`

The task asked whether competitor research changes the two open items. It
changes one and confirms the other.

### audit 2.4 — pre-generation cost estimate → **now 4.1, and now unblocked**

The audit deferred 2.4 with: *"Roadmap #4 (`GenerationEvent` + `usage.cost`
capture) … confirmed fully unbuilt … Revisit once #4 ships."*

**It shipped** (C2 — table, writer, and all five metered job types wired on both
success and failure paths, verified today). **The stated blocker no longer
exists.** 4.1 should be scheduled.

Research changes the *design* of it in two ways:

1. **Show scope alongside price, not price alone.** The audit said "cost/scope
   estimate"; every researched implementation that does this well leads with
   scope ("18 shots → 9 clips → ~6 min") and treats currency as secondary.
   Creators reason in units of work, not dollars.
2. **Use observed medians, not a rate card.** Every competitor runs on a
   published credit table because they own their models. Narrata routes through
   OpenRouter to models whose prices move, so a static table would rot. `costUsd`
   and `durationMs` per `jobType`+`modelId` are a self-maintaining estimate and a
   genuine advantage. It also means the estimate must be honestly labelled as an
   estimate, with a fallback when there is no history for that model yet.

Also newly unblocked and **not** anticipated by the audit: `durationMs` gives
real ETAs (4.2), and `success`/`errorMessage` close 2.2's stated failure-history
gap (4.3). Those are two additional items the audit could not have scheduled.

### audit 3.1 — scene workspace → **confirmed, now 5.1, with one addition**

The audit deferred 3.1 on file-contention grounds: `scene-manager.tsx`,
`scene-video-panel.tsx` and `shot-manager.tsx` had a concurrent work stream.

**Verified today:** that work stream **landed** — commits `99e46c8` ("Phase 12/13:
generation claims, per-project model defaults, video pipeline routing + QC") and
`9a884e9` ("Motion prompt drafting: populate the structured Prompt Builder
fields"). The working tree still shows modifications to `shot-manager.tsx` and
`scene-video-panel.tsx`, so **confirm with the owning agent before starting
5.1** — but the *reason* for deferral is materially weaker than it was.

Research **confirms the approach and does not contradict it.** The audit
reasoned from Narrata's code that list-detail was right. LTX and Synthesia, the
two closest analogs, both independently ship exactly that shape. That is as
close to external validation as this method gets.

One substantive addition: **both of them have a third column.** LTX's shot
editor is a separate panel from the scene sidebar; Synthesia's inspector switches
scope between scene and selected element. The audit's 3.1 described two regions
(rail + focused scene). **5.1 should be built as three** — rail, focused scene,
scope-contextual inspector — because Narrata has the same two-scope problem
(scene-level: visual mode, characters, locations, narration; shot-level: prompt,
camera, duration, model override) and today solves it by stacking both in one
column. Building two regions now and retrofitting the third later would be
rework.

The estimate rises from the audit's 8d to 9d to cover the inspector. Everything
else in 3.1 stands, including its correct observation that `SceneRow` is already
self-contained and reusable as the detail pane.

### Unchanged rejections

The audit's §4 "Explicitly not recommended now" survives research intact, with
**one qualification**: "Timeline / NLE-style editor — a timeline is a different
product" was right about *editing* and slightly over-broad about *viewing*. LTX
ships both a storyboard and a timeline and uses the timeline purely for assembly
and review. 5.3 adopts the review half (read-only filmstrip) while keeping the
rejection of editable timeline intact. Take-selection remains Narrata's edit
model.

---

## 6. What Narrata is already ahead on

Worth recording, because the pull toward copying competitors is strongest where
we are actually leading.

- **Double-fire protection.** Synthesia handles duplicate generation requests
  with a help-centre plea not to do it. Narrata has server-side claims, `409` on
  double-fire, stale-claim expiry and cross-reload recovery (audit 2.1, shipped).
- **One take model across every asset type.** Images, video, voice, music, SFX,
  silent renders and final renders all share `isSelected` + take history. No
  researched product applies one review idiom that uniformly.
- **Visual mode as a narrative property.** Kling makes input modality the
  navigation; Narrata makes it a per-scene decision with an editable AI
  rationale. Strictly better and worth defending (R5).
- **Real cost/duration telemetry per generation.** Competitors publish rate
  cards. Narrata records what actually happened, per model, per job type. It
  just has no reader yet.
- **Manual-first held under pressure.** Every researched product is adding a
  prompt-to-finished-video agent front door. Narrata's differentiator is the
  opposite, and R4 says keep it.

---

## 7. Cross-agent asks

| Agent | Question |
|---|---|
| `product-strategist` | Phase 4 is ~7 days and turns generation feedback from the product's weakest surface into its strongest, using data already being written. It has no dependencies. Confirm it outranks Phase 5 for the next sprint. |
| `technical-architect` | 4.1/4.2 need an aggregate read over `GenerationEvent` (median `costUsd` and `durationMs` grouped by `jobType` + `modelId`). Should that be a cached aggregate or a live `groupBy` on each pre-flight open? It is indexed on `projectId`/`jobType` but not `modelId`. |
| `technical-architect` | 5.1 changes the scenes-page query from all-scenes-all-takes to rail-summary + one focused scene. Confirm that shape before I build it — it is the largest perf change in this plan and it is load-bearing for the layout. |
| `ai-architect` | Is `usage.cost` reliably present for **all** five metered job types, or only chat completions? `openrouter.ts` L198–201 flags it as "confirmed present for chat completions; unconfirmed" elsewhere. 4.1's honesty depends on knowing when the number is absent rather than zero. |
| `monetization-strategist` | 4.4 shows per-project USD spend. Under the credit-based model in the pricing baseline, should the user see **credits**, **USD**, or **both**? Building 4.4 in the wrong unit is rework. |
| `video-architect` | 4.2 needs real stage names for the video path (submitted → polling → downloading → persisting, or similar). What are the stages actually worth naming, and which are long enough to be worth showing? |
| `product-manager` | 5.1 touches `scene-manager.tsx` / `scene-video-panel.tsx` / `shot-manager.tsx`, which still show working-tree modifications. Who owns those right now, and is the concurrent stream that blocked audit 3.1 finished? |
| `qa-engineer` | 4.3 makes failure state durable. Worth a deliberate fault-injection pass — force a provider failure on each of the five metered job types and confirm the badge, the message and the retry all behave. |
