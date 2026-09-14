# Video Platform Research Checklist

Source: user-supplied "StoryOS AI Video Architecture" capability chart, updated
2026-09-13 to 14 categories (expanded from the original 10 — added Reference/
Conditioning System, Quality Control, Continuity Engine, and Story→Scene→Shot
Planner; Seedance added throughout; Pika added to Editing).

Categories 1–10 are **external platform** categories — each maps to one or
more platforms, researched as a full architecture brief
(`platforms/<platform>.md`, Section-19 format in
`video-platform-intelligence.md`). A single brief feeds every category that
platform appears in, so **platforms are the unit of work**, not categories.

Categories 11–14 are **Narrata-internal architecture checklists** (Quality
Control, Continuity Engine, Planner, Infrastructure) — not platform lists.
They're what external research (1–10) ultimately feeds into, owned by
`ai-architect` / `video-architect` / `technical-architect`, not researched
externally by this agent. Tracked separately below (Part B).

Do not start research from this file alone — wait for explicit go-ahead per platform/batch.

---

# Part A — External Platform Research (categories 1–10)

## Platform status

| Platform | Status | Brief | Categories it feeds (# from chart) |
| --- | --- | --- | --- |
| Kling | ✅ Done | `platforms/kling.md` | 1 Foundation, 2 Creative Control, 4 Character Consistency, 5 Continuity, 6 Camera, 7 Reference/Conditioning |
| Runway | ✅ Done (+ six-gap follow-up audit 2026-09-13) | `platforms/runway.md` | 1 Foundation, 2 Creative Control, 3 Story/Scene, 4 Character Consistency, 5 Continuity, 6 Camera, 7 Reference/Conditioning, 8 Orchestration, 9 Editing |
| Veo | ✅ Done | `platforms/veo.md` | 1 Foundation, 3 Story/Scene, 5 Continuity, 6 Camera, 10 Audio |
| Seedance | ✅ Done | `platforms/seedance.md` | 1 Foundation, 2 Creative Control, 3 Story/Scene, 4 Character Consistency, 5 Continuity, 6 Camera, 7 Reference/Conditioning, 8 Orchestration — **8 of 10 categories, the highest-leverage single brief in the programme** |
| Hailuo / MiniMax | ✅ Done | `platforms/hailuo-minimax.md` | 1 Foundation, 4 Character Consistency, 5 Continuity, 6 Camera, 7 Reference/Conditioning |
| Higgsfield | ✅ Done | `platforms/higgsfield.md` | 2 Creative Control, 4 Character Consistency, 6 Camera, 8 Orchestration |
| Sora | ✅ Done (2026-09-14) | `platforms/sora.md` | 1 Foundation, 3 Story/Scene, 5 Continuity — **and a stop-ship notice: OpenAI is discontinuing the entire product (app dead 2026-04-26, API shutting down 2026-09-24, no replacement) — research value is architectural precedent only, not a live integration option** |
| Wan | ✅ Done (2026-09-13/14) | `platforms/wan.md` | 1 Foundation, 4 Character Consistency, 5 Continuity, 7 Reference/Conditioning — **first open-weight brief: architecture read from published source/configs rather than inferred; also the first brief yielding a directly actionable integration (`alibaba/wan-2.7` is already reachable via Narrata's OpenRouter)** |
| HunyuanVideo | ✅ Done (2026-09-14) | `platforms/hunyuanvideo.md` | 1 Foundation, 4 Character Consistency, 7 Reference/Conditioning, 10 Audio — **second fully-readable frontier architecture, and it disagrees with Wan on nearly every disclosed component. Delivers the programme's headline convergence: HunyuanCustom's identity mechanism (temporal concatenation) independently matches VACE's. Also surfaces HunyuanVideo-Foley, a Text+Video→Audio model matching the input shape Narrata's Audio Cue Plan already emits. Counterweight: least *reachable* platform researched — no verified first-party hosted API, no OpenRouter video listing found, one 480p T2V-only third-party endpoint** |
| Luma | ⬜ Not started | — | 2 Creative Control |
| Pika | ⬜ Not started | — | 2 Creative Control, 9 Editing |
| Vidu | ⬜ Not started | — | 4 Character Consistency, 7 Reference/Conditioning |
| Krea | ⬜ Not started | — | 8 Orchestration |
| Adobe Firefly (Video) | ⬜ Not started | — | 9 Editing |
| CapCut (AI) | ⬜ Not started | — | 9 Editing |
| InVideo | ⬜ Not started | — | 9 Editing |
| HeyGen | ⬜ Not started | — | 10 Audio |
| Synthesia | ⬜ Not started | — | 10 Audio |

**Narrata (StoryOS)** appears in the chart at 8 (Orchestration) and 10
(Audio) — that's not external research, it's the "Narrata" column already
tracked via `video-architect.md` / `ai-architect.md` current-reality
sections.

---

## Category coverage snapshot (categories 1–10, from platforms done so far)

| # | Category | Covered by | Gap |
| --- | --- | --- | --- |
| 1 | Foundation Video Models | Kling, Runway, Veo, Hailuo/MiniMax, Seedance, Wan (the only *fully verified* backbone in the programme — layer/dim/head counts, 3D RoPE split, patch kernel, flow-matching objective, VAE ratios and losses all read from published source), **Sora** (spacetime-patch diffusion transformer; the only brief in the programme where the flagship model's *current-generation* system card contains zero architecture content — a "no technical report was ever published for Sora 2" finding), **HunyuanVideo** (second fully-readable backbone: 20 dual-stream → 40 single-stream blocks, dim 3072, RoPE split (16,56,56), VAE 8×8/4× at 16ch, decoder-only MLLM encoder + bidirectional token refiner; and 1.5's 8.3B *downscale* with published **SSTA sparse attention**, 16×/32ch VAE and Qwen2.5-VL + Glyph-ByT5) | ✅ **CATEGORY CLOSED — all eight foundation platforms researched.** Two open architectures now disagree on text encoder, text-fusion topology, attention density, VAE ratio, temporal RoPE budget, model-size direction and licence — **treat "how video models work" as unsettled** |
| 2 | Creative Control | Kling, Runway, Higgsfield, **Seedance** | Luma, Pika unresearched |
| 3 | Story/Scene Understanding | Runway, Veo, Seedance (in-prompt `Shot n:` / `Cut to` structure; dramaturgical framing of extension), **Sora** (fourth independent lab confirmed using timestamped in-prompt shot blocks; OpenAI's own docs admit compound-scene fragility — "small changes in phrasing can alter identity, pose") | ✅ **CATEGORY CLOSED — Sora was the last outstanding platform.** Consistent negative answer across all four briefs: **no platform exposes a persistent narrative structure.** Story is always (a) an LLM rewrite the caller may not control plus (b) a prose convention for shot blocks. Sora's Storyboard came closest and compiled down to prompt cards on a timeline before being switched off with the app. **Narrata's persisted `StoryBible` + `Character`/`Location` + `SHOT_PLANNING` stack is ahead of every platform researched** |
| 4 | Character Consistency | Kling, Runway, Higgsfield, Hailuo/MiniMax, Seedance, Wan (first *disclosed* identity-conditioning mechanisms anywhere in the programme: VACE temporal-axis reference injection; Animate's skeleton + implicit facial features; and a dual-path I2V design separating geometry from semantics — but still **no persistent character record**), **Sora** (Cameo — a verification-and-consent-gated identity record, structurally unlike every reference-image mechanism found elsewhere; non-human `characters` kept in a separate, more constrained, ID+verbatim-name-bound mechanism), **HunyuanVideo** (**HunyuanCustom independently confirms VACE's mechanism — identity injected by *temporal concatenation* of the reference — plus a LLaVA text-image fusion module modelling the identity image jointly with its description**) | Vidu unresearched. **But the standing question is now answered: two independent labs disclose the same identity mechanism, and three independent sources (VACE's masks, HunyuanCustom's LLaVA fusion, OpenAI's "the ID alone isn't enough") agree a reference needs a textual anchor** |
| 5 | Video Continuity / Multi-Shot Generation | Kling, Runway, Veo, Hailuo/MiniMax, Seedance, Wan — `wan2.7` exposes `first_frame` / `first_frame+last_frame` / **`first_clip` continuation**, the exact primitive `video-architect.md` names as Narrata's sharpest gap; and Wan2.6's `shot_type: single\|multi` was **deleted in 2.7** in favour of prompt-only shot control; **Sora** (forward-only Extensions confirmed in the current API — a widely circulated "bidirectional extend" claim for Sora 2 was checked against the first-party API guide and downgraded to UNVERIFIED, even though the *original* 2024 Sora genuinely had backward extend) | — covered; this category's last outstanding platform is now done |
| 6 | Camera/Cinematography | Kling, Runway, Veo, Higgsfield, Hailuo/MiniMax, **Seedance** (one boolean `--camerafixed` + trained-in caption vocabulary) | — covered; re-open only if a new parametric-control approach appears |
| 7 | Reference / Conditioning System | Kling, Runway (partial — reference-image mechanisms covered but not audited specifically for this framing), Higgsfield, Hailuo/MiniMax, Seedance (most permissive in industry: 50 assets at 2.5; adds "white-model"/green-screen blocking conditioning), **Wan** (the only *mechanism-level* disclosure: VACE's VCU `[T;F;M]`, references concatenated on the **temporal** axis and dropped at decode, Concept Decoupling, Context Blocks at layers [0,5,10…35]), **HunyuanVideo** (second mechanism-level disclosure: temporal-concat identity + LLaVA text-image fusion + AudioNet spatial cross-attention + patchify-based video feature alignment — **four modalities, four injection paths, one model** — plus a **learnable type embedding "to explicitly distinguish between different types of conditions,"** the in-model answer to "a reference and a start-frame are different kinds of object") | Vidu unresearched; Kling/Runway briefs still worth a targeted re-read for this category specifically |
| 8 | Model Orchestration | Runway, Higgsfield, **Seedance** (notable as a *negative* result — no router at all; one unified model, task disambiguated by input shape via binary masks) | Krea unresearched |
| 9 | Video Editing / Transformation | Runway | Adobe Firefly, Pika, CapCut, InVideo unresearched |
| 10 | Audio / Voice / Music | Veo, **HunyuanVideo** (via **HunyuanVideo-Foley** — an end-to-end **Text+Video→Audio (TV2A)** Foley architecture with REPA loss and dual-stream audio-video joint attention; **the input shape Narrata's assemble-without-audio + Audio Cue Plan already emits**, targeting the `SFX_GENERATION` stage Narrata implements most crudely. Also the finding that Tencent's open line keeps **audio as a separate sequential model**, unlike Sora 2's and Wan 2.5+'s native audio — Tencent's shape is the one that fits Narrata's pipeline without restructuring) | HeyGen, Synthesia unresearched — **still the thinnest category alongside 9 (Editing)** |

---

## Suggested next-platform priority (not started until told to go)

Ranked by how many uncovered categories a single brief would close, plus
strategic relevance to Narrata's differentiation bets (continuity, character
consistency, story understanding):

*Seedance and Higgsfield were completed 2026-09-13; Wan was completed
2026-09-13/14; **Sora and HunyuanVideo were completed 2026-09-14, closing
categories 1 and 3 entirely**. Remaining order, re-ranked:*

1. **HeyGen / Synthesia** — Audio (10). **Promoted to #1.** Category 10 has only Veo and HunyuanVideo-Foley, and the Hunyuan brief made this category newly concrete rather than peripheral: **video-conditioned audio (TV2A) is now a named, published capability shape** that maps directly onto a Narrata pipeline stage (`SFX_GENERATION`, currently text-only, fed by the already-persisted silent cut + Audio Cue Plan). HeyGen/Synthesia are lip-sync/voice-first and are the natural contrast for Narrata's voice-consistency work ([[voice-consistency-design]] in memory). **Highest marginal information of anything remaining.**
2. **Vidu** — closes gaps in 4, 7. **Demoted from #1, because the question it was queued to answer has now been answered.** See the running finding below: two independent labs disclose the *same* identity mechanism. Vidu is still worth doing as a **falsification check** — a platform that markets character consistency as its core differentiator either uses the same temporal-concat family or has found something genuinely different, and both outcomes are informative. But it is no longer expected to change the conclusion.
3. **Adobe Firefly / Pika / CapCut / InVideo** — Editing (9). **Promoted as a group.** Category 9 has only two briefs (Runway, Sora) and is now tied with Audio as the thinnest-covered category; Pika additionally closes part of 2 (Creative Control). Do these only if editing UX becomes a near-term roadmap item, but they are where new information now lives.
4. **Luma** — Creative Control (2). Lower priority; less differentiated per public information so far.
5. **Krea** — Orchestration (8), niche (model-agnostic creative canvas) — lowest priority now that 8 has three briefs and Seedance established the useful *negative* result.

**The open-weight bucket is now CLOSED.** Wan and HunyuanVideo are both done, both fully readable, and between them they establish both the build-vs-buy arithmetic and the architectural disagreement map. **Re-open only if a new open frontier release lands** (no HunyuanVideo 2.0 and no Wan 2.5+ open weights exist as of 2026-09-14, verified by registry enumeration).

### Running finding: does any vendor disclose an identity-conditioning mechanism?

This has been the programme's longest-standing open question. Consolidated state as of 2026-09-14:

| Platform | Discloses a mechanism? | What |
| --- | --- | --- |
| **Wan** (Alibaba) | ✅ **Yes, in papers** | **VACE**: references VAE-encoded, **concatenated on the temporal axis**, dropped at decode; Concept Decoupling via masks; Context Adapter Tuning (frozen DiT + 8 Context Blocks). **Wan-Animate**: skeleton + implicit facial features. *No hosted Wan product exposes a persistent character record.* |
| **HunyuanVideo** (Tencent) | ✅ **Yes, in papers** | **HunyuanCustom**: image ID enhancement module using **temporal concatenation** to reinforce identity across frames, plus a **LLaVA text-image fusion module** modelling the identity image jointly with its description. **Independently converges on Wan's mechanism.** |
| **Sora** (OpenAI) | 🟡 **Product mechanism only** | **Cameo** is verification-and-consent-gated (one-time enrollment → durable revocable identity record); the **`characters`** endpoint is a persistent record requiring the name **verbatim in the prompt** — "the ID alone isn't enough." **Internal architecture never disclosed.** |
| **Kling, Runway, Higgsfield, Hailuo/MiniMax, Seedance** | ❌ **No** | Reference images / character records exposed as product surface; **no mechanism disclosed by any of them.** |
| **Vidu** | ⬜ **Unresearched** | The one remaining falsification opportunity — see priority #2. |

**Conclusion, promoted from open question to established finding:** *identity conditioning by **temporal concatenation of the reference** is the field's converged mechanism, disclosed independently by two labs with published source.* The property both exploit is that a temporally-concatenated reference is visible to **every** output frame through full attention **without geometrically constraining any one of them** — which a first frame cannot do and a LoRA requires training to do.

**Corollary, and the most actionable line in the programme: a reference asset needs a textual anchor.** Three independent sources agree — VACE's masks (which region does this govern), HunyuanCustom's LLaVA fusion (image modelled jointly with its description), and OpenAI's documented requirement that the character name appear verbatim. **Narrata should never dispatch `Character.referenceImages` without the canonical name and a stable short description in the prompt text.** Routed to `ai-architect`.

**Note on the chart's shape after Sora and HunyuanVideo — a milestone.** With
these two briefs, **category 1 (Foundation Video Models) closes entirely at
eight briefs, and category 3 (Story/Scene Understanding) closes entirely at
four.** Together with category 5 (Continuity/Multi-Shot) and category 6
(Camera), **four of the ten external categories now have no outstanding
platform.** Categories 4 and 7 are each covered by 6–7 briefs with strongly
converging findings and only Vidu outstanding. **9 (Editing) has two briefs and
10 (Audio) has two** — these remain the thinnest-covered external categories
and are where the remaining research budget should go.

Three cross-cutting findings have now reached maximum useful sample size across
all nine platforms researched (Runway, Kling, Veo, Hailuo/MiniMax, Higgsfield,
Seedance, Wan, Sora, HunyuanVideo) and should be treated as **established
baselines rather than re-derived per brief**:

- **(a) No frontier platform runs a runtime quality or continuity critic —
  nine for nine.** Sora sharpened rather than weakened this: it is the one
  platform with a *documented runtime output-scanning pipeline* (frames, scene
  descriptions and audio transcripts through multimodal classifiers plus a
  reasoning monitor, at consumer-app scale) — **and it is pointed at safety,
  not quality.** The engineering is proven feasible; the target is unclaimed.
  With Wan-Bench's 14-metric structure, SeedVideoBench's four-dimension rubric,
  Tencent's GSB methodology and `IMAGE_VALIDATION`'s existing result shape,
  `video-architect` now has feasibility, rubric and result shape.
- **(b) No frontier platform generates a genuine multi-scene narrative in a
  single model call.** Every one is generate-short-then-assemble. Nothing found
  in either of today's briefs argues for single-pass long-form.
- **(c) No frontier platform exposes a persistent narrative structure.** Story
  is universally reduced to an LLM rewrite stage plus a prose shot-block
  convention. **This is the differentiation thesis, and it has now held across
  nine briefs.**

A fourth finding, newly **settled** today and previously the programme's main
open question, is recorded in full in the "Running finding" table above:
**identity conditioning by temporal concatenation is the field's converged
mechanism**, independently disclosed by Alibaba (VACE) and Tencent
(HunyuanCustom).

**Where new information still lives:** Editing (9), Audio (10) — especially
video-conditioned audio — and any *hosted product* that exposes an identity
mechanism rather than burying it in a paper. **General-purpose foundation-model
briefs now have near-zero marginal value; do not add another.**

**One methodological rule added today, and it is a live operational risk, not a
research nicety: check the *vendor's own* deprecation page before adding any
model to the `AiModelOption` registry — never the broker's catalogue.**
OpenRouter launched video generation on 2026-04-15 with `sora-2-pro` as a
headline model, **three weeks after OpenAI had publicly announced it was
shutting Sora down.** A broker listing is not evidence a model is safe to build
on. Routed to `ai-architect` and `technical-architect`.

---

# Part B — Narrata Internal Architecture Checklist (categories 11–14)

Not platform research. These are Narrata's own systems to design/build,
informed by Part A findings. Status below is drawn from what
`video-platform-intelligence.md` documents as current reality (citing
`video-architect.md`/`ai-architect.md`) — verify against the live repo before
treating any "exists" claim as still true.

## 11. Quality Control / Generation Evaluation

| Sub-capability | Status |
| --- | --- |
| Prompt adherence scoring | ⬜ Not confirmed built |
| Character consistency scoring | ⬜ Not confirmed built |
| Scene consistency scoring | ⬜ Not confirmed built |
| Temporal consistency scoring | ⬜ Not confirmed built |
| Motion quality scoring | ⬜ Not confirmed built |
| Physics quality scoring | ⬜ Not confirmed built |
| Artifact detection | 🟡 Partial — **verified live 2026-09-13**: `checkSegmentFrozen()` in `apps/web/src/lib/scene-video.ts` detects one specific failure mode (frozen/static output on a non-`STATIC` shot) via ffmpeg freeze detection at `FREEZE_FLAG_FRACTION = 0.6`. Deterministic, **advisory-only** (`qcPassed: boolean | null`, never blocks). No general artifact detection |
| Automatic scoring | ⬜ Not confirmed built |
| Best-generation selection | ⬜ Not confirmed built |
| Automatic retry / regeneration | 🟡 Partial — take-history regeneration exists (manual/user-triggered per prior audits), not confirmed automatic |

**CORRECTED 2026-09-13 (Seedance brief, verified against live code).** The
standing claim — repeated in `.claude/agents/video-platform-intelligence.md`
and in earlier versions of this file — that "nothing analogous to
`IMAGE_VALIDATION` exists for video" is **out of date**. Narrata already has
**tier 1** of a video critic: `checkSegmentFrozen()` in
`apps/web/src/lib/scene-video.ts`, a deterministic, advisory-only check
persisted per-`Asset` as `qcPassed` + `qcNotes`. The agent file's premise
should be updated.

What is genuinely missing is **tier 2 — the model-based critic**: prompt
adherence, identity drift, and continuity scoring against the Story Bible.
Research across five platforms (Runway, Kling, Hailuo/MiniMax, Higgsfield,
Seedance) now confirms **no competitor runs a runtime quality or continuity
gate at all** — making this a differentiation surface rather than catch-up
work. Seedance closed the main open question here by supplying a
**ready-made rubric**: SeedVideoBench's four dimensions (Motion Quality /
Prompt Following / Aesthetic Quality / Preservation), each with named
sub-criteria and validated by film-director experts. `IMAGE_VALIDATION`'s
existing result shape is the template. Owned by `video-architect`.

## 12. StoryOS Continuity Engine

**CORRECTED 2026-09-14, against live code, by `ai-architect` + `video-architect`
in parallel session.** The nine-parallel-state-table framing below (one row per
category) was the original chart's shape and is **over-modeling** — most rows
are either already covered by an existing field or are free-prose facts that
don't need dedicated infra. The real, verified gap is narrower: `Shot.image`
generation (`lib/shot-images.ts` `generateShotImage`/`buildImagePrompt`) builds
every shot from static bibles only and **never sees shot N-1's image or
description** — shots are generated in isolation even though the video stage
(`scene-video.ts`) already correctly chains shot N's image → shot N+1's image
as keyframes. Continuity is decided (or lost) at image-generation time, not
video time. Full finding and agreed build order in memory
`continuity-engine-gap-2026-09` / `docs/product/roadmap.md` Section 3
(Parallel Track, item b).

| Sub-capability | Status |
| --- | --- |
| Story Bible | 🟢 Exists (`StoryBible` table per `packages/db/prisma/schema.prisma`) |
| Character Bible | 🟢 Exists (`Character` records with `referenceImages`, `isLocked`) |
| Location Bible | 🟢 Exists (`Location` records with `referenceImages`, `isLocked`) |
| Object / Prop Bible | ⬜ Not built — genuine gap, real new entity needed (phase 2, per agreed build order) |
| World / Scene / Shot / Character / Camera / Lighting / Wardrobe / Spatial / Temporal "state" tables (original 9-category chart) | ⚪ **Rejected as over-modeling** — Camera is already the `cameraMovement` enum; Time/Action/Emotional are free-prose facts folded into existing prompt text; no dedicated table planned for any of these |
| Shot N-1 → Shot N image/description handoff | 🟢 **Built** — `loadPreviousShot`/`buildContinuityBlock`/`continuityNotes`/`previousShotContext` in `lib/shot-images.ts` pass shot N-1's image + notes into shot N's prompt and `generationReferences` |
| Structured per-shot continuity snapshot | 🟢 **Done 2026-09-14** — `Shot.continuity Json?` (array of `{subject, state}`), written by extending `SHOT_PLANNING`'s existing response schema in `lib/shots.ts` (zero extra model calls), read by the next shot's image prompt in `lib/shot-images.ts`. Same-scene scope only |
| Reference Image Management | 🟢 Exists (`referenceImages` on Character/Location) — 🟢 **fixed 2026-09-14**: now consistently paired with canonical name + role in prompt text via the `referenceManifest` numbered list in `lib/shot-images.ts` (roadmap item c) |
| Reference/text binding correctness | 🟢 **Fixed 2026-09-14** — the live "wrong character's face" bug: unlabeled positional reference-image array vs. prose describing every character regardless of whether an image backed them. Fixed by numbering and labeling every attached reference image and flagging unbacked entities `[no reference image attached]`. See `docs/product/roadmap.md` Parallel Track item a |
| Previous-Frame Conditioning (video stage) | 🟢 Exists (frame-chaining in the Image→Video pipeline, per [[per-shot-pair-video-and-silent-assembly]] memory) |
| Cross-Scene Consistency | 🟡 Partial — Story/Character/Location Bibles exist; no dedicated cross-scene validator confirmed (same-scene only, matches `continuityNotes`' existing boundary) |
| Continuity checking folded into `IMAGE_VALIDATION` | 🟢 **Done 2026-09-14** — `runValidation` in `lib/shot-images.ts` now also judges continuity adherence (previous shot's image + `Shot.continuity`/`continuityNotes` facts), not a new critic; advisory-only, same as before |

**External validation (2026-09-14):** research across all 9 platforms with
external briefs found **zero competitors persist any continuity state at
all** — this whole category is Narrata's differentiation surface, not
catch-up work, which is the strategic reason to fix the narrow real gap
properly rather than resurrect the nine-table model.

## 13. Story → Scene → Shot Planner

| Sub-capability | Status |
| --- | --- |
| Story decomposition | 🟢 Exists (`SCRIPT_DRAFTING` AiJobType) |
| Scene planning | 🟡 Likely covered by existing job types, not separately confirmed |
| Shot planning | 🟢 Exists (`SHOT_PLANNING` AiJobType) |
| Camera planning | 🟡 Partial — `MOTION_PROMPT_DRAFTING` exists (per recent commit "Motion prompt drafting: populate the structured Prompt Builder fields"); dedicated camera-planning stage not confirmed |
| Character blocking | ⬜ Not confirmed built |
| Action planning | 🟡 Likely folded into `SHOT_PLANNING`/`SCRIPT_DRAFTING`, not separately confirmed |
| Transition planning | ⬜ Not confirmed built |
| Generation instructions | 🟢 Exists (`DIALOGUE_DIRECTION`, `NARRATION_DIRECTION`, `MOTION_PROMPT_DRAFTING` AiJobTypes) |

## 14. Production Infrastructure

| Sub-capability | Status |
| --- | --- |
| GPU scheduling | ⚪ N/A at MVP — no self-hosted GPU inference, API-first (OpenRouter, ElevenLabs, Sarvam) |
| Job queues | 🟡 Not confirmed — `workers/` reported empty per agent file; verify current state |
| Model routing | 🟢 Exists (`AiModelOption`/`AiJobType` registry, provider-agnostic, admin-configured) — 🟡 gap: flat parameter map, not a declarative capability matrix with exclusion/arity rules (three provider topologies confirmed distinct: MiniMax mode⊥mode, Kling parameter⊥parameter, Wan enumerated-combos+arity) |
| Model fallback | ⬜ Not confirmed built |
| Parallel generation | ⬜ Not confirmed built |
| Caching | ⬜ Not confirmed built |
| Asset storage | 🟡 Likely local disk per [[narrata-deployment-plan]] memory (free VPS + local disk) — not CDN-backed |
| CDN | ⬜ Not present per deployment plan memory |
| Rendering | 🟢 Exists (ffmpeg render/composition pipeline) |
| Upscaling | ⬜ Not confirmed built |
| Cost capture | 🟢 **Done 2026-09-14** — `GenerationEvent` table + `recordGenerationEvent`, wired into the 5 metered job types (image/video/voice/music/sfx). Superseded [[narrata-monetization-baseline]]'s "cost field discarded" finding — update that memory as resolved before citing it as current. Still open: cost dashboard UI, ElevenLabs/Sarvam cost backfill, `withGenerationClaim` wrapper cleanup |
| Usage / GPU monitoring | ⬜ Not confirmed built — no dashboard surfaces `GenerationEvent` data yet |
| Registry hygiene (deprecation-safe model additions) | 🔴 **Process gap, not code** — OpenRouter listed `sora-2-pro` as a headline model three weeks after OpenAI announced Sora's shutdown; rule added: check the vendor's own deprecation page before adding any model to `AiModelOption`, never the broker's catalogue |

At MVP scale (single VPS, no worker fleet), most of category 14 is
intentionally deferred — don't treat gaps here as urgent without
`technical-architect` sign-off on sequencing.

---

*Say which platform or batch to start, and the agent will produce the next
`platforms/<name>.md` brief in the existing Section-19 format. Part B items
are not researched externally — they get proposed once Part A findings are
in, then handed to `ai-architect`/`video-architect`/`technical-architect` to
verify against the live repo and build.*
