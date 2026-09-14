# Video Platform Intelligence — Changelog

Dated log of findings that meaningfully changed prior research. Newest first.

---

## 2026-09-14 — New platform brief: HunyuanVideo (Tencent) — **and with it, categories 1 and 3 both close**

Added `platforms/hunyuanvideo.md`. Second half of the same 2026-09-14 session as
the Sora brief logged immediately below; **read the two entries together.**

**Milestone.** These two briefs were the last outstanding gaps in **category 1
(Foundation Video Models)** and Sora was the last gap in **category 3
(Story/Scene Understanding)**. **Both categories are now fully covered — 1 with
eight briefs, 3 with four.** `RESEARCH_CHECKLIST.md` updated accordingly in the
same pass.

Covers the whole open-weight line — **HunyuanVideo** (13B, weights 2024-12-01,
arXiv 2412.03603) → **HunyuanVideo-I2V** (2025-03) → **HunyuanCustom**
(2025-05, arXiv 2505.04512) → **HunyuanVideo-Avatar / HunyuanPortrait**
(2025-05) → **HunyuanVideo-Foley** (2025-08, arXiv 2508.16930) →
**Hunyuan-GameCraft** / **HunyuanWorld-Voyager** (2025-08) →
**HunyuanVideo-1.5** (8.3B, 2025-11-18, arXiv 2511.18870, current base model).

**The checklist had this platform ranked last, and that ranking was wrong.** It
was downgraded after the Wan brief on the grounds that the open-weight
build-vs-buy question was already answered with verified arithmetic. **That
reasoning was correct about build-vs-buy and wrong about everything else** —
because a *second* fully-readable frontier architecture is worth far more than
the first, since every point where the two disagree marks a place the field has
no consensus and Narrata must not assume one.

**Most significant findings:**

- **THE HEADLINE — the programme's longest-standing open question is answered a
  second time, and it converges.** *Does any vendor disclose an
  identity-conditioning mechanism?* **HunyuanCustom does, and it is the same
  core mechanism as Alibaba's VACE: temporal concatenation of the reference.**
  VACE VAE-encodes references and concatenates them **on the temporal axis**,
  dropping them at decode; HunyuanCustom's image ID enhancement module
  *"leverages temporal concatenation to reinforce identity features across
  frames."* **Two independent labs, different backbones (Wan's
  cross-attention-only DiT vs Hunyuan's dual-stream/single-stream hybrid), same
  answer.** This should now be treated as the field's **settled mechanism**
  rather than one vendor's design taste, and it upgrades the Wan brief's
  "never conflate a character reference with a shot start-frame" from a
  single-source inference to a two-source convergence. **[VERIFIED — arXiv
  2505.04512 + 2503.07598]**
- **A three-way convergence spanning this session's two briefs and the Wan
  brief — the most actionable finding of the session: a reference asset needs a
  textual anchor.** VACE pairs references with **masks** saying which region
  they govern; **HunyuanCustom pairs the identity image with its description
  through a LLaVA-based text-image fusion module**; **OpenAI documents that
  "passing the character ID alone isn't enough to reliably preserve the
  character in the shot"** and the name must appear verbatim. Three independent
  sources, two of them mechanistic. **Narrata should never dispatch
  `Character.referenceImages` without the canonical character name and a stable
  short description in the prompt text, and no downstream stage may paraphrase
  it.**
- **Architecture read from primary sources, exact.** 1.0 (13B): **20
  dual-stream blocks → 40 single-stream blocks**, dim 3072, FFN 12288, 24 heads
  × head-dim 128, **full attention**, **3D RoPE partition (16, 56, 56)**, **3D
  VAE 8×8 spatial / 4× temporal, 16 channels**, **decoder-only MLLM text
  encoder + bidirectional token refiner**, flow matching (velocity), **129
  frames fixed**, 60 GB peak at 720p. 1.5 (8.3B, current): 54 layers, dim 2048,
  FFN 8192, 16×128 heads, **SSTA sparse attention**, **VAE 16×16 / 4×, 32
  latent channels, causal 3D *transformer***, **Qwen2.5-VL + Glyph-ByT5**
  dual-channel text encoder, cascaded second-stage 8.3B DiT for 1080p SR,
  **13.6 GB peak on a single RTX 4090**.
- **The two open vendors disagree on nearly every component they both
  disclosed, and that is itself the strategic finding.** Text encoder:
  decoder-only MLLM (Tencent) vs encoder-only umT5-XXL (Alibaba) — **each
  chosen after an explicit published ablation, reaching opposite conclusions**.
  Text fusion: joint stream after 20 blocks vs cross-attention only, every
  block. Attention: **sparse (published) vs dense (published, with the
  concession that attention can be 95% of training time)**. Temporal RoPE
  budget: **12.5% of head dim (16/128) vs ~34%** — a 2.7× disagreement.
  Model-size direction: **down (13B → 8.3B) vs up**. Licence: restrictive vs
  Apache 2.0. **Narrata should not build any assumption that depends on "how
  video models work" being settled. It is not.**
- **Tencent published a working sparse-attention design, closing a question
  left open twice.** **SSTA (Selective and Sliding Tile Attention)**: partition
  Q/K into 3D blocks → score by **Q-K similarity minus K-K redundancy** (a
  *diversity* criterion, not pure top-k relevance) → select top-k → add sliding
  window → block-sparse attention. **1.87× end-to-end on 10-second 720p vs
  FlashAttention-3.** Wan chose 2D context parallelism over sparsity; MiniMax
  trained native sparse attention and **withheld** the implementation;
  **Tencent published theirs with a measured speedup against a named
  baseline.**
- **The VAE contradiction, and the correction it forces on a prior brief.**
  Alibaba built a 64× VAE and **refused to put its flagship on it** (only
  TI2V-5B uses it) — which the Wan brief read as evidence that high-compression
  latents cost quality at the frontier. **Tencent moved its entire line onto a
  16×-spatial VAE — while doubling latent channels 16 → 32.** **Compression
  ratio without channel count is not a meaningful comparison and is not a
  quality proxy.** This does not overturn the Wan brief's observation but it
  does bound it: the two vendors made opposite calls and both are defensible.
- **I2V is dual-path, matching Wan** (VAE channel-concat for geometry + SigLIP
  semantic embeddings concatenated sequentially), **plus one mechanism Wan
  lacks: a learnable *type embedding* "to explicitly distinguish between
  different types of conditions."** That is the in-model solution to exactly
  the problem the Wan brief flagged — vendors tag condition types internally,
  so **Narrata must keep them in distinct slots externally.**
- **HunyuanCustom is the most conditioning-complete open architecture found:
  four modalities, four distinct injection mechanisms, one model.** Text+image
  via LLaVA fusion; identity via temporal concatenation; **audio via AudioNet's
  "hierarchical alignment via spatial cross-attention"**; video via a
  "patchify-based feature-alignment network." Where Alibaba ships a *zoo* of
  task checkpoints, Tencent pushes conditioning **into** the model.
- **HunyuanVideo-Foley is the sleeper finding, and it is not a video model.**
  An end-to-end **Text+Video→Audio (TV2A)** Foley architecture — 100k-hour
  curated dataset, **REPA loss** using self-supervised audio features,
  multimodal DiT with **dual-stream audio-video joint attention + text
  cross-attention** explicitly framed as resolving modal competition.
  **Narrata already emits exactly this model's input**: the persisted
  assemble-without-audio silent cut plus the Audio Cue Plan, feeding an
  `SFX_GENERATION` stage that currently works from **text alone**. The action
  is not self-hosting — it is treating **video-conditioned SFX** as the
  capability shape to look for in providers.
- **Audio is a separate, sequential model here — and that shape matches
  Narrata's pipeline better than the alternative.** Sora 2 and Alibaba's closed
  line generate synchronized audio natively; Tencent's open line keeps video
  and Foley as two models in sequence. **Narrata already assembles silent video
  first and produces audio against it, so Tencent's shape is the one that fits
  without restructuring.**
- **Licence is materially not Apache, and the restriction reaches outputs.**
  **Tencent Hunyuan Community License**: Territory is worldwide **excluding the
  European Union, United Kingdom and South Korea**, and licensees may not use,
  reproduce, modify, distribute or display the works **or any outputs** outside
  it; a **100M MAU** threshold requires a discretionary Tencent licence;
  outputs may not train competing models; attribution must be preserved;
  governed by **Hong Kong law**. **Wan is Apache 2.0 with none of this. "Open
  weights" is now a two-vendor spread wide enough to be a first-order filter if
  self-hosting is ever revisited.**
- **Architecture quality and integration value are orthogonal — this brief is
  the clean demonstration.** HunyuanVideo is the **most completely disclosed
  architecture in the programme** (no divergent closed line, unlike Wan) **and
  the least reachable**: no verified first-party hosted API, **no OpenRouter
  video listing found this session**, and the one verified third-party endpoint
  (fal, ~$0.40/video) is **T2V-only and capped at 480p** — unusable for
  Narrata's image-conditioned main path. **Wan remains the actionable
  integration; Hunyuan is evidence. Do not let disclosure quality drive
  integration decisions.**
- **First-party prompt rewriting exists in the *honest* form.** A fine-tuned
  **Hunyuan-Large rewrite module** with **"Normal" and "Master" modes** ships in
  the repo — **local and explicitly invoked**, unlike Alibaba's `prompt_extend`
  and MiniMax's `prompt_optimizer`, which default to `true` server-side. Fourth
  vendor with a rewrite stage; **first where the default is off by
  construction.**
- **Nine platforms, nine times: no runtime quality or continuity critic.**
  Tencent measures ID consistency and publishes GSB win rates **including its
  losses** — **−10.32% vs Veo3, +17.12% vs Wan2.2, +12.6% vs Kling 2.1**;
  instruction-following **61.57 vs Wan2.2's 44.07 vs Veo3's 73.77**. A lab
  publishing that it loses is a credibility signal. Still development-time only.
- **Third confirmation of causal-VAE duration quantization.** Hunyuan's fixed
  **129 frames = 1 + 4×32**; Wan's `frame_num 121 = 1 + 4×30`; MiniMax's
  17-frame increments at 2K. **Duration is a provider-quantized value, not a
  free float** — belongs in the adapter contract.
- **Evidence-trap note (milder than Wan's, same species).** Aggregators date
  the 2024-12-01 open-sourcing to "January 29, 2026," place 1.5 in 2026 rather
  than 2025-11-18, and assert HunyuanVideo is "the only open-source video model
  worth running at production scale" — contradicted by **Tencent's own report**,
  which scores itself behind Veo3. **Registries and first-party reports only**,
  per the rule the Wan brief established; the HF catalogue and GitHub org were
  enumerated directly and show **no HunyuanVideo 2.0.**

**Top open leads from this brief:** whether a first-party Tencent Cloud hosted
video API exists (would change the reachability verdict entirely);
Hunyuan-GameCraft's **"hybrid history condition"** (the line's closest thing to
a continuation mechanism, internals not read); and the **"cinematic properties"
captioner's vocabulary** — unpublished, but it would be the single most useful
artifact in this programme for `SHOT_PLANNING` prompt design.

### Routed to sibling agents — combined, covering both of today's briefs (per Section 24)

- **`ai-architect`** — (1) **pair every reference asset with a textual anchor**:
  inject the canonical `Character` name and a stable short description whenever
  `referenceImages` are attached, and forbid downstream paraphrase (three
  independent sources, two mechanistic). (2) **Never let a character reference
  and a shot start-frame share a conditioning slot** — now a two-lab mechanism
  convergence. (3) Stop treating published VAE compression ratios as a quality
  proxy. (4) Keep the "disable hosted prompt rewriters" rule; **Tencent's local,
  named, opt-in rewriter is the pattern to emulate** if Narrata ever ships
  prompt enhancement. (5) Add timestamped/blocked shot structure as a
  constrained output format for `SHOT_PLANNING` / `MOTION_PROMPT_DRAFTING` —
  now a fourth independent confirmation (Veo, Seedance, Kling, Sora).
- **`video-architect`** — (1) **evaluate video-conditioned (TV2A) SFX as the
  target capability shape** for `SFX_GENERATION`; Narrata's silent-cut + Audio
  Cue Plan output is already this input shape. (2) Model duration as
  **provider-quantized**, confirmed at three vendors. (3) The **runtime critic**
  remains the clearest differentiation surface — now with nine-platform
  evidence, **Sora's proof that runtime frame-and-audio scanning is feasible at
  consumer-app scale** (it exists, it is simply pointed at *safety* rather than
  quality), and rubric/result-shape templates already recorded from Wan-Bench,
  SeedVideoBench and `IMAGE_VALIDATION`. (4) Prefer whole-clip continuation over
  last-frame chaining where a provider offers it.
- **`technical-architect`** — (1) **do not self-host either model.** Hunyuan
  1.5's 13.6 GB consumer-GPU figure lowers the breakeven throughput but does not
  change the Wan brief's arithmetic, because the GPU bills whether or not it
  generates. (2) **Protect provider-agnosticism in the registry.** Sora is the
  existence proof that a flagship model from the best-capitalised lab can be
  withdrawn entirely; the two open architectures disagree on nearly every
  component. Nothing should assume the field is settled. (3) New process rule:
  **check the vendor's own deprecation page before adding a model, not the
  broker's catalogue** — OpenRouter launched video generation on 2026-04-15
  with `sora-2-pro` as a headline model, **three weeks after OpenAI announced
  the shutdown.**
- **`monetization-strategist`** — (1) a frontier lab shut down a flagship video
  product **on unit economics**, months after an enormous launch; the cost
  figures in circulation are **inconsistent across sources and unattributed to
  OpenAI**, so do not treat them as load-bearing. (2) SSTA's published 1.87×
  is evidence that long-clip generation cost has a **downward trajectory driven
  by public technique**, not only by vendor competition. (3) Licence terms
  (EU/UK/KR territory exclusion **extending to outputs**, 100M MAU ceiling) are
  a first-order filter if self-hosting is ever revisited.
- **`market-intelligence`** — the Sora discontinuation, the reported
  cost/revenue asymmetry, the Disney partnership context and the **absence of a
  named successor** are business signals rather than architecture; a successor
  name circulating in one secondary source is contradicted by others and should
  be treated as rumour. Also: **Tencent publishing its own losses against Veo3**
  is a positioning signal worth folding into competitor intelligence.
- **`ui-ux-engineer`** — (1) **named intensity tiers rather than booleans or
  continuous sliders** for "how much should the AI change this": Tencent ships
  Normal/Master, Sora shipped graded edit intensity, Runway retired its sliders
  — three vendors converging on a short named ladder. (2) Sora's Storyboard made
  **card spacing** a semantic control over transition pacing — a genuinely good,
  model-agnostic idea, though the account rests on third-party tutorials only.
- **`product-strategist` / `company-vision`** — **category 3 closes with the
  finding that no platform in this programme exposes a persistent narrative
  structure.** Every one of Runway, Veo, Seedance and Sora reduces story to an
  LLM rewrite plus a prose convention; Sora's Storyboard came closest and
  compiled down to prompt cards on a timeline before being switched off with the
  app. **Narrata's persisted `StoryBible` + `Character`/`Location` +
  `SHOT_PLANNING` stack is not catch-up work — it is the differentiator, and it
  has now held across four consecutive briefs.**

---

## 2026-09-14 — New platform brief: OpenAI Sora (Sora / Sora Turbo / Sora 2 / Sora app)

Added `platforms/sora.md`. Covers the original 2024 Sora ("Turbo") technical-report
era through Sora 2 (2025-09-30) and the now-defunct Sora social app, organized around
the eight user-specified lenses (world modeling, temporal coherence, spatial
consistency, scene understanding, prompt interpretation, story-level generation,
video continuation, editing/transformation) layered inside the standard Section-19
format.

**The single most important finding in this brief, and it changes the practical
conclusion of the whole research pass: OpenAI is shutting Sora down, in full, within
days of this brief's writing.** The Sora web app and iOS app were discontinued
**2026-04-26**; the Videos API (`sora-2`, `sora-2-pro`, and their dated snapshots) is
scheduled for shutdown **2026-09-24 — ten days from this brief's analysis date** —
with **no replacement listed** in OpenAI's own deprecations table (fetched directly:
`developers.openai.com/api/docs/deprecations`, every row's "Recommended replacement"
column is empty). Reported cause (secondhand, WSJ-sourced via TechCrunch/Axios/
the-decoder): Sora cost roughly **$1M/day** to run against **$2.1M in total lifetime
in-app revenue**. **Practical consequence: this brief converts "should Narrata
integrate Sora" from an open question into a closed one — no, unconditionally, because
the API will not exist by the time any integration could ship.** Everything else in
the brief is preserved as architectural precedent and comparative evidence, not as a
live vendor recommendation.

**Access note.** `openai.com` and `help.openai.com` both return HTTP 403 to direct
fetch, same as `help.runwayml.com` and `docs.cloud.google.com` in earlier briefs —
handled the same way (search-indexed excerpts quoting the official pages, labeled
VERIFIED only where quoted text is consistent across many independent sources). Two
first-party documents **were** fetched and read in full this session, which is better
access than several prior briefs got: the **Sora 2 System Card PDF** (`cdn.openai.com`,
downloaded and read page-by-page as a document) and `developers.openai.com`'s API
guide, deprecations table, and cookbook prompting guide (all direct-fetchable, no
403 — `developers.openai.com` is a different subdomain than the blocked `openai.com`
and `help.openai.com`). The original 2024 technical report itself could not be
directly fetched (blocked; not reachable via `web.archive.org` from this session's
tooling) — its content is reconstructed from highly consistent cross-corroborating
search excerpts quoting the report's own sentences verbatim, a pattern strong enough
to label VERIFIED for the specific quoted claims.

**Most significant findings:**

- **OpenAI's own limitations section is the most candid in this research programme,
  sitting inside the same document as the loudest "world simulator" claim.** The
  original technical report claims 3D consistency, object permanence, and zero-shot
  simulation of Minecraft — and, in the same report, names its own failures: glass
  shattering not modeled, food-eating not reliably changing object state (the
  cookie-bite example), left/right spatial confusion, and "incoherencies that develop
  in long duration samples." No other platform brief in this programme found the
  strongest marketing claim and the most explicit limitations disclosure living in one
  first-party document.
- **The Sora 2 System Card, read in full, contains zero architecture content.** It is
  entirely a safety document — data filtering, moderation classifiers, red-teaming,
  safety-evaluation metrics (a `not_unsafe`/`not_overrefuse` table). OpenAI never
  published a Sora 2 technical report. This is "disclosure decay" (the pattern the
  Seedance brief named for ByteDance) taken further: not just less detail over time,
  but a complete absence of an architecture document for the current-generation model.
- **No mandatory inference-time prompt rewriter was found for Sora — a genuine
  negative case against Veo (mandatory, non-disableable LLM rewriter) and Kling
  (documented Prompt Enhancer).** OpenAI's documented DALL·E-3-style "recaptioning"
  technique is training-data-only (train a captioner, apply it to training videos,
  fine-tune the generator on the richer captions) — it does not touch the user's
  actual prompt at inference time. The widely-circulated "use ChatGPT to expand your
  Sora prompt" workflow is a documented cookbook recommendation and user habit, not an
  automatic pipeline stage. **Router/provider-adapter implication: "does this provider
  silently rewrite my prompt" must be a per-provider capability flag, not an assumption.**
- **Multi-shot generation confirmed as a prompt convention for a fourth independent
  frontier platform.** Sora 2's own cookbook prompting guide instructs timestamped shot
  blocks (`0.00–2.40 — "Arrival Drift"`) inside one prompt — the same pattern as Veo's
  `[00:00-00:02]` and Seedance's `Shot 1:`/`Cut to`, arrived at independently by three
  different labs (now four, counting Kling's per-shot-prompts-and-durations design).
- **Cameo is a verification-gated identity mechanism, structurally unlike every other
  platform's reference-image approach.** A user records one verified video+audio clip
  (identity-matched transcript check) once; that consent-scoped, revocable identity can
  then be invoked across unlimited future generations without re-supplying reference
  images per call. No other platform in this programme ties identity persistence to a
  one-time verification-and-consent record rather than to a per-call reference budget.
- **The separate `characters` API parameter is explicitly non-human-only** — animals,
  mascots, objects; max 2 per video; requires the character's name to appear verbatim
  in the prompt text *in addition to* the ID (ID alone does nothing); cannot combine
  with Extensions. Human likeness runs through Cameo entirely separately. A double-
  binding requirement (ID + verbatim name) not seen at Kling/Higgsfield's simpler
  `@name` conventions.
- **Editing converged, independently, on the same mask-free pattern Runway reached with
  Aleph 2.0 — second frontier confirmation.** `/v1/videos/edits` takes a video + a
  single natural-language change ("change lighting to sunset," "same shot, switch to
  85mm") with graded intensity (Strong/Mild/Subtle), no mask or region parameter, and
  explicitly preserves camera motion/framing. Two frontier labs, same mask→prompt move,
  arrived at independently.
- **Video continuation is forward-only in the currently-documented API — and this
  directly contradicts a widely circulated "bidirectional extend" claim, which is
  explicitly downgraded to UNVERIFIED rather than repeated as fact.** The original 2024
  Sora demonstrably had backward extension (a frequently and consistently quoted launch
  claim). Multiple 2026 third-party developer guides claim `/v1/videos/extensions`
  still supports backward ("flashback") generation in Sora 2. **The first-party API
  guide, fetched and read directly, describes only forward continuation** (up to 20s
  per call, ≤6 calls, 120s total ceiling) with no direction parameter and no mention of
  backward generation. This is the same aggregator-invents-a-precise-capability failure
  mode already caught three times in this programme (Kling's "native 4K 60fps",
  MiniMax's "physics architecture" sentence, ByteDance's "DB-DiT phoneme-level lip
  sync" sentence) — now caught a fourth time, on a capability (bidirectional extend)
  that genuinely existed in a *previous* version of the same product, which is what
  makes this instance of the trap unusually easy to fall into.
- **Independent physics evaluation: Physics-IQ scored a Sora model at 8.7/100 on
  physical understanding despite rating it the most visually plausible model tested** —
  the same "looks real, isn't physically correct" gap found for Veo. Carried forward
  honestly from the Veo brief's own caveat on this benchmark: **which Sora version
  (1 vs. 2) was actually tested could not be confirmed this session.** A June 2026 audit
  of the benchmark itself ("Physics-IQ Verified") found 57.6% of its video samples
  contaminated by non-physics artifacts and 34.8% of its prompts flawed — a reminder
  that the evaluation side of "does AI video obey physics" is itself immature.
- **Story-level generation: eighth-of-eight confirmation of generate-short-then-assemble.**
  Storyboard (both eras) is a timeline-assembly UI for stitching separately generated
  clips, not a single-call multi-scene mechanism. Duration ceiling per the fetched API
  guide is 16s/20s for both `sora-2` and `sora-2-pro`; secondary reporting on the *app*
  says 15s free / 25s Pro — an unreconciled app-vs-API mismatch, the same class of
  discrepancy the Veo brief flagged for Gemini-API-vs-Vertex durations. Moot in practice
  given the shutdown, but recorded as a fifth instance of the pattern in this programme.
- **Runtime quality/continuity critic: now confirmed absent at eight of eight platforms
  researched in this programme** (Runway, Kling, Veo, Hailuo/MiniMax, Higgsfield,
  Seedance, Wan, Sora). Sora's only disclosed runtime evaluator — a "safety-focused
  reasoning monitor," a custom-trained multimodal reasoning model — checks **policy
  compliance**, not quality or continuity, mirroring the Higgsfield Virality Predictor's
  "scores a different axis entirely" pattern. Narrata's missing tier-2 (model-based)
  video/audio critic is now a confirmed differentiation surface at maximum sample size
  for this research programme, not catch-up work.

**Material corrections / conflicts recorded:**

- **Sora 2 API backward-extend — downgraded to UNVERIFIED against a genuine prior-
  version capability.** See above; this is flagged as the sharpest instance yet of the
  aggregator-invented-capability trap because the claimed capability is not invented
  from nothing — it demonstrably existed in Sora 1 — which makes the claim that it
  "survived" into Sora 2 easy to accept without checking. The first-party API guide
  does not support it.
- **App-vs-API duration mismatch, unreconciled**: 16s/20s (API, fetched directly) vs.
  15s free/25s Pro (app, secondary reporting only). Not resolved this session; noted as
  the fifth instance of this general pattern in the programme (after Veo's Gemini-API/
  Vertex mismatch).
- **A precise-sounding aggregator sentence rejected on sight, per the now-standard
  method rule**: "the reference image is not merely a style hint but a hard constraint
  applied throughout the Latent Space diffusion process" (describing Cameo's mechanism)
  appears only in third-party guide sites, not in any OpenAI source read this session.
  Explicitly not used for any VERIFIED claim in the brief — the fourth instance of this
  exact failure mode caught in this research programme.
- **Physics-IQ's 8.7/100 Sora score — version attribution flagged as unresolved**, not
  asserted as either Sora 1 or Sora 2, consistent with the caution the Veo brief already
  established for this same benchmark family.

**Cross-cutting patterns reinforced or extended:**

- **No frontier platform runs a runtime quality/continuity critic — now 8/8**, the
  largest sample size this finding has reached in the programme.
- **No frontier platform generates a genuine multi-scene narrative in a single model
  call — now 8/8.** Narrata's per-shot-pair generate-then-assemble architecture is
  validated at maximum sample size, not merely "the industry standard so far."
  Programme-wide, this finding is now stable enough that future briefs should treat it
  as an established baseline rather than re-deriving it, and focus verification effort
  on genuinely new claims instead.
- **Multi-shot-as-prompt-timestamp-convention — now 4 independent labs** (Veo, Seedance,
  Kling's per-shot-durations variant, Sora), the strongest cross-platform corroboration
  of a single UX/prompt-architecture pattern found anywhere in this programme.
- **Mask-free, prompt-scoped, single-change editing — now 2/2** (Runway Aleph 2.0, Sora
  `edits`) among platforms that disclose an editing mechanism at all.
- **A third frontier lab (OpenAI, after Google/Gemini Robotics and Runway/GWM) is
  reported to be separating "narrative video product" from "world-model/robotics
  research"** — OpenAI's video-research effort is reported to be redirected toward
  world-simulation work tied to robotics rather than a narrative-video successor. If
  accurate, this is a third independent data point for a structural industry pattern:
  the commercially strained part of this technology is the consumer narrative-video
  product, not the underlying world-model research direction.

**Routed to other agents:** see the "Routed to Other Agents" section of
`platforms/sora.md` for full detail — summarized: `market-intelligence` gets the
shutdown economics and the third robotics-redirection data point; `technical-architect`
gets awareness-only of the ~$1M/day cost-at-scale data point; `ai-architect` gets the
per-provider prompt-rewrite capability flag, further strengthening of the timestamp-
shot-block recommendation, and first-party evidence for keeping Narrata's explicit
planner stages rather than trusting implicit scene understanding; `video-architect` gets
a second confirmation of prompt-scoped mask-free editing, another capability-exclusion-
matrix data point (Extensions ⊥ characters/refs), and the 8/8 critic-gap confirmation;
`company-vision` gets the shutdown as a cautionary real-world instance of the exact
compute-cost-outpacing-revenue risk the `MASTER_AI` sequencing decision is designed to
avoid; `monetization-strategist` gets the ~$1M/day figure as a rough order-of-magnitude
anchor; `growth-strategist` gets the finding that a social/distribution layer bolted
onto a generation product did not by itself fix unit economics.

**Note on `platforms/wan.md` below:** that brief and its changelog entry were written
by a separate, concurrent session — not part of this Sora research pass. Discovered
mid-session via the standing "check `RESEARCH_CHECKLIST.md` reconciliation" note in
this agent's task; the checklist has been updated to reflect both Sora and Wan as Done
in the same pass (see the platform-status table), which addresses the exact "brief
written without its checklist row updated" failure mode the 2026-09-13 maintenance
entry further below already flagged once.

---

## 2026-09-14 — New platform brief: Wan (Alibaba / Tongyi Lab)

Added `platforms/wan.md` (research conducted 2026-09-13, written 2026-09-13/14; the
brief carries **analysis date 2026-09-13**). **The seventh platform brief and the first
open-weight one** — written at the user's direction to go deeper technically than the
closed-API platforms, because Wan2.1/2.2 ship Apache-2.0 weights *and inference source*.
Thirteen dedicated technical subsections (transformer/DiT, diffusion/flow formulation,
text conditioning, image conditioning, latent representation, VAE, temporal modeling,
training, inference, quantization, GPU requirements, LoRA/fine-tuning, deployment &
licensing) sit alongside the normal Section-19 product-facing sections.

**Methodological first for this programme: nothing central here is inferred.** Prior
briefs reverse-engineered architecture from marketing pages, API docs and — at best — a
model card. This brief reads layer counts, hidden dims, the RoPE split expression, the
patch kernel, sampler settings, VAE ratios and loss coefficients **directly out of
`wan/configs/*.py` and `wan/modules/model.py`**. Where earlier briefs labeled the
identity-conditioning mechanism "NOT DISCLOSED" six times in a row, this one can print it.

**Most significant findings:**

- **The open line and the product line have diverged, and the gap is now ~14 months.**
  The newest **base video generator** with published weights is **Wan2.2 (2025-07-28)**.
  Everything after — 2.5-preview (2025-09), 2.6 (2025-12-16), 2.7 (2026), **3.0
  (2026-08-13)** — is **API-only**. Verified by *enumeration*, not assumption: the complete
  `Wan-AI` HF catalogue is **27 models** (newest created 2026-08-06, none named 2.5/2.6/
  2.7/3.0), the `Wan-Video` GitHub org has **six** repos with no 2.5+ repo, and Alibaba's
  own Wan3.0 blog says Model Studio only. Post-2.2 open releases are all *derivative* task
  models (Animate, Animate-2, Dancer, skills).
- **`wan2.7` ships the exact primitive `video-architect.md` names as Narrata's sharpest
  gap — and it is already reachable through Narrata's existing OpenRouter integration.**
  `media[]` accepts `first_frame`, `last_frame`, `driving_audio` and **`first_clip`**
  (true video continuation: "if `duration=15` and the input video is 3 s long, the model
  generates a 12-s continuation"). `video-architect.md` gates cross-shot continuity on
  *"if/when a provider in use supports image-conditioned generation this way."* **That gate
  condition is now met.** This is the first brief in the programme to yield a concrete
  integration recommendation rather than a pattern to borrow.
- **Verified backbone, exactly.** Wan2.1/2.2-14B: **40 layers · dim 5120 · 40 heads · ffn
  13824 · patch (1,2,2) · `window_size (-1,-1)` (full dense 3D attention, no sparsity) ·
  qk-norm · eps 1e-6**; 1.3B: 30 layers / dim 1536 / 12 heads; TI2V-5B: 30 / 3072 / 24 /
  ffn 14336. Text encoder **umT5-XXL, 512-token hard cap, bf16, cross-attention only**
  (chosen over Qwen2.5-7B and GLM-4-9B in a published ablation). **3D RoPE** splits the
  head dim `[c − 2·(c//3), c//3, c//3]` across (frame, height, width). **Flow matching**,
  v-prediction, `x_t = t·x₁ + (1−t)·x₀`, logit-normal timestep sampling.
- **"MoE" in Wan2.2 is MoE-by-timestep, not MoE-by-token — and calling it MoE invites the
  wrong mental model.** Two complete ~14B DiTs (high-noise → layout, low-noise → detail),
  27B total / 14B active, switched at an SNR threshold shipped as **`boundary: 0.875`**,
  with **per-expert CFG** (`sample_guide_scale: (3.0, 4.0)`). No router network, no gating,
  no load-balancing loss. **It is not a cost saving**: compute per step is flat while
  parameters on disk/in VRAM roughly double (hence the ~80 GB single-GPU peak, and
  ComfyUI's official two-loader/two-sampler graph).
- **Alibaba shipped a 64× VAE and declined to put its flagship on it.** Wan2.2-VAE
  (4×16×16, 4×32×32 after patchify) is loaded **only** by TI2V-5B; `wan_t2v_A14B.py`
  still loads `Wan2.1_VAE.pth` (4×8×8, 16ch, 127M, causal, RMSNorm-for-GroupNorm,
  MagViT-v2 "1+T"). Strongest available signal that high-compression latents still cost
  quality at the frontier. The "1+T" layout is also why Wan frame counts are `4k+1`
  (`frame_num 121` = 1 + 4·30) — **the same class of tell as MiniMax's 17-frame
  quantization, but documented rather than inferred.**
- **First disclosed identity/reference mechanisms in the programme.** I2V is **dual-path**:
  VAE-encoded condition frames **channel-concatenated** with the noisy latent plus a binary
  mask (geometry), *and* CLIP (`clip_xlm_roberta_vit_h_14`) features through `MLPProj` into
  a **separate image cross-attention** with its own `k_img`/`v_img`, summed with text
  attention (semantics/identity). **VACE** does something different again for *references*:
  VAE-encode and **concatenate on the temporal axis**, then drop before decode — so a
  reference informs every frame without constraining any one geometrically. Trained via
  **Context Adapter Tuning**: frozen DiT + Context Embedder + **8 Context Blocks at layers
  [0,5,10…35]**.
- **A vendor shipped a structured multi-shot control and deleted it one version later.**
  `wan2.6-i2v` exposes **`shot_type: "single" | "multi"`** with the documented rule
  **"Parameter priority: shot_type > prompt"**; the Wan2.7 reference states shot control is
  **prompt-based with no `shot_type` parameter**. Combined with Runway's 2026-07-30
  retirement of camera sliders and masks, **two independent frontier vendors have now
  retired a structured control surface in favour of prose inside twelve months** — while
  Higgsfield went the opposite way. Direct evidence for Higgsfield's notation-layer
  synthesis: keep intent structured *internally*, serialize per provider.
- **A third distinct conditioning-constraint topology.** MiniMax: mode ⊥ mode. Kling:
  parameter ⊥ parameter. Wan2.7: an **enumerated set of valid `media[]` combinations** plus
  **"each `type` at most once"** (arity). Three providers, three shapes — a parameter map
  cannot express any of them. The declarative **capability matrix** recommendation is now
  settled, not proposed.
- **Second vendor defaulting to silent prompt rewriting.** Wan's hosted line defaults
  **`prompt_extend: true`**, as MiniMax v1 defaults `prompt_optimizer: true`. Two of seven
  platforms paraphrase the caller's prompt unless told not to. Narrata spends real LLM
  budget in `SHOT_PLANNING`/`MOTION_PROMPT_DRAFTING` producing considered prompts and is
  currently exposed to this.
- **Self-host vs rent, settled with arithmetic rather than opinion.** Wan2.2-A14B needs
  **~80 GB VRAM** and **~180 s of one H100 per 5-second clip** (repo table; 42 s on 8×H100;
  TI2V-5B 540 s / 24 GB on a 4090; Wan2.1-1.3B 8.19 GB). Against verified rental prices
  (**OpenRouter: `wan-3.0` from $0.0425/s, `wan-3.0-prime` $0.068/s, `wan-2.7` $0.10/s,
  `wan-2.6` from $0.04/s**; Alibaba direct **$0.05/$0.10/$0.20** per second for
  480P/720P/1080P), a dedicated H100 at an **assumed** $2.50/hr must absorb **~10–23
  minutes of finished video per day** merely to break even. **Verdict: do not self-host.**
- **Apache 2.0 is a materially better escape hatch than MiniMax's licence.** No territory
  exclusion, no revenue ceiling, no application process, and an explicit disclaimer of
  rights over generated content — versus the H3 Community Licence's (still unverified)
  EU/UK/KR/US exclusions and ~$20M revenue cap.
- **The most mature quantization/distillation ecosystem of any video model, and it is
  entirely community-run.** QuantStack is the de-facto GGUF publisher (`Wan2.2-T2V-A14B-GGUF`
  alone at **708k downloads**), plus unsloth and bullerwins; ComfyUI ships official
  `fp8_scaled`; **lightx2v's `Wan2.2-Lightning`** distills to **4 steps, no CFG, as a rank-64
  LoRA**. LoRA training is community-owned too (musubi-tuner, DiffSynth-Studio, ai-toolkit) —
  **there is no official Alibaba fine-tuning trainer.**
- **Wan-Bench is the best template found so far for Narrata's missing video validator** —
  14 metrics in 3 groups (Dynamic Quality incl. **ID consistency**; Image Quality;
  Instruction Following incl. camera control), weighted by **5,000+ human pairwise
  comparisons**. Like everything else, it is **development-time only**.

**Material corrections to hype / secondary claims:**

- **REJECTED — "Wan 2.7 / Wan 3.0 shipped Apache-2.0 open weights."** A dense SEO layer
  (`wan27.org`, `wan2-7.io`, `localaimaster.com`, `oakgen.ai`, `kingy.ai`, `videoai.me`,
  `wan2.video`, `cliprise.app`) asserts this with specific dates (March 2026, April 6 2026,
  April 22 2026) and download instructions, while contradicting itself (one of the same
  domains publishes "Wan 2.7 Has a Thinking Mode — and Closed Weights"). **The primary
  registries refute all of it.** Verified by enumerating `huggingface.co/api/models?author=Wan-AI`
  and the `Wan-Video` GitHub org repo list.
- **NEW EVIDENCE TRAP, the worst yet: an Apache-2.0 licence badge on a repo that contains no
  weights.** `github.com/AlibabaCloud-Official/Wan3.0` is **Apache-2.0-licensed marketing
  README** (11 stars, 2 commits, no code, no weights, no HF/ModelScope links) for an
  API-only model. **Method rule added: a licence badge describes the repo's contents, not
  the model's weights — enumerate the model registry, never infer openness from a repo.**
  This generalises the Higgsfield brief's `geo.higgsfield.ai` finding: *the trap is not
  always a fake-looking domain; sometimes it is a real-looking licence.*
- **CONFLATION WARNING — do not attribute Wan2.2's verified internals to `wan2.7` or
  `wan3.0`.** They share a brand and lineage and **nothing publicly verifiable beyond that**.
  The hosted line added joint native audio, 30-second single-pass generation, 20-asset
  multimodal references and document ingestion with **zero architectural disclosure**.
  Several secondary sources make exactly this error. Structurally identical to the Hailuo
  brief's "MiniMax M-series text stack ≠ H3 video stack" warning.
- **FLAGGED — Wan2.2 has no technical report.** arXiv **2503.20314** (v1 2025-03-26, v2
  2025-04-19) predates Wan2.2 and describes **Wan2.1**. The MoE design — Wan2.2's headline
  contribution — is documented **only** in a README and a model card. Prior secondary
  sources cite 2503.20314 *as* the Wan2.2 report; that citation is wrong.
- **FLAGGED — an unexplained price discrepancy.** OpenRouter's `wan-3.0` floor of
  **$0.0425/s** is *below* Alibaba's own published 480P rate of **$0.05/s**. Tier,
  promotion, or listing error — unknown. Do not build unit economics on it unverified.
- **NOTED — a price-ladder inversion.** `wan-2.7` lists at **$0.10/s** while the *newer*
  `wan-3.0` starts at **$0.0425/s**. **Version recency is not a valid cost proxy** for this
  vendor.
- **DOWNGRADED to HYPOTHESIS — all GGUF quality-tier guidance** ("Q8 near-lossless, Q5_K_M
  the compromise, Q4_K_M banding"). It is aggregated blog/forum consensus with no
  measurement behind it. The one rigorous source (arXiv 2606.00658) finds that the
  **dual-expert structure requires separate calibration per expert** and early-layer
  protection — i.e. **for an MoE-by-timestep model, compression is one decision per expert.**
- **NOTED as a primary-source caution** — the repo explicitly advises **"we do not recommend
  using LoRA models trained on Wan2.2"** with Animate-14B. LoRAs are **not portable across
  the task-model family even within one version.**

**Cross-cutting patterns updated:**

- ***Seven platforms, seven times, no runtime quality or continuity critic.*** Wan-Bench is
  development-time (like Kling's OmniVideo-1.0); MiniMax discloses no benchmark at all;
  Higgsfield's Virality Predictor scores commercial outcome, not correctness. The only
  automated runtime gate observable anywhere in Wan's hosted line is **`prompt_extend`,
  which rewrites the prompt rather than checking the output.** Narrata's missing analogue to
  `IMAGE_VALIDATION` for video/voice/music/SFX is now the most durable differentiation
  finding in the entire programme — and Wan-Bench finally supplies a concrete result shape
  to build it against.
- ***Long-form is still generate-short + assemble, but the ceiling moved.*** `wan3.0`
  claims **30 seconds in a single pass** (vs Kling ≤15s+extend, MiniMax's hard 15s, Runway's
  brokered extend). Whether that is one pass or internal stitching is **not disclosed**.
  Narrata's per-shot-pair + assembly architecture remains correct; the change is that
  provider clip ceilings are drifting upward and duration should be treated as a router
  variable, not a constant.
- ***Openness attracts hype the same way closedness does.*** Wan simultaneously has the
  **best primary evidence** of any platform studied (source code) and the **worst secondary
  evidence** (confident false licensing claims, an Apache-badged marketing repo). The method
  rule that closes the loop on the Runway/Kling/Hailuo lessons: **enumerate the registry
  (`huggingface.co/api/models?author=…`, the GitHub org repo list) before accepting any
  claim about what is open.**

**Routed to other agents:**

- `video-architect` — **top item across the whole programme so far:** evaluate
  `alibaba/wan-2.7` via the **existing OpenRouter integration** for cross-shot continuity —
  it supports `first_frame` (shot N's last frame → shot N+1), `first_frame + last_frame`
  (bridge), and **`first_clip`** (continue from the whole previous clip). This is the
  provider capability `video-architect.md` explicitly gates that feature on. Also: (1)
  replace the provider parameter map with a **declarative capability matrix carrying
  exclusion *and arity* rules** — now settled by three distinct provider topologies; (2)
  **set `prompt_extend: false` on Wan calls and audit every adapter for an equivalent
  default-on rewrite flag**; (3) model **duration quantization** (`4k+1` frames at Wan,
  17-frame steps at MiniMax) as a general provider property in the assembly/duration-split
  logic; (4) build the video analogue of `IMAGE_VALIDATION` against **Wan-Bench's 14-metric
  / 3-group shape**, ID consistency and prompt/camera adherence included; (5) treat model
  *and* resolution tier as a **joint** routing decision — Alibaba's own 4× intra-model
  spread corroborates the deferred-resolution pattern from the Hailuo brief with a second
  vendor's numbers.
- `ai-architect` — (1) **references and start-frames are different kinds of object and must
  not share a slot** in prompt/reference assembly, even where a provider's API accepts them
  in one array — VACE's temporal-axis injection (informs every frame, constrains none) vs
  channel-concat first-frame conditioning (pins geometry) is the mechanism-level reason, and
  it is the correct mental model for what `Character.referenceImages` are *for*; (2) keep
  camera/shot intent as a **fixed internal enum serialized per provider** — Wan2.6→2.7's
  deletion of `shot_type` is now the second documented instance of provider control-surface
  churn, so any schema shaped to one provider's current API will break; (3) add Wan to the
  `AiModelOption` registry as an OpenRouter-served option, keeping provider-agnosticism
  strict; (4) note the **512-token umT5 cap** on the open line as evidence that prompt
  budgets are encoder-bound and silently truncating, not soft.
- `technical-architect` — **awareness, and a clear "no action" with arithmetic behind it.**
  Self-hosting Wan does not clear the Section 12 bar: ~80 GB VRAM and ~180 s of H100 per
  5-second clip means **~10–23 minutes of finished video per day** just to break even
  against renting, on a single VPS with an empty `workers/`. The models that *would* fit
  cheaper hardware (TI2V-5B on the 64× VAE; GGUF-quantized A14B) are precisely the ones
  Alibaba did not put its flagship weights behind. Two operational details worth designing
  for regardless: hosted **result URLs expire in 24 hours** (download immediately or lose
  the asset — shorter than MiniMax's 7-day window), and Wan is the **least single-vendor-
  dependent model family** in the research set (OpenRouter, fal, Replicate, Together,
  WaveSpeed, Novita, Runpod all serve it), which is a real supply-resilience property. Wan's
  published training infra (FSDP + 2D context parallelism, Ring-outer/Ulysses-inner, FP8
  GEMM, 8-bit FlashAttention at 95% MFU on H20) is **Scale-tier for a model-training lab and
  does not apply**.
- `monetization-strategist` — verified rental prices now exist for a second vendor:
  OpenRouter `wan-3.0` from **$0.0425/s**, `wan-3.0-prime` **$0.068/s**, `wan-2.7`
  **$0.10/s**, `wan-2.6` from **$0.04/s**; Alibaba direct **$0.05 / $0.10 / $0.20** per
  second across 480P/720P/1080P (a clean **4× spread inside one model**). Two cautions
  before any of it becomes load-bearing: the **OpenRouter floor undercuts Alibaba's own
  published 480P rate** (unexplained), and **version recency is not a cost proxy** (the
  newer flagship is cheaper per second than its predecessor). Also: **Apache 2.0 with no
  revenue ceiling** makes the open Wan line a genuine long-run price floor, which is a
  different strategic object from MiniMax's revenue-capped licence.
- `market-intelligence` — (1) **Alibaba has quietly stopped open-weighting its frontier
  video generator**: base weights froze at Wan2.2 (2025-07-28) while 2.5 → 2.6 → 2.7 → 3.0
  all shipped API-only, with open releases continuing *only* for derivative task models.
  That is a strategic posture change with competitive implications, and it runs opposite to
  MiniMax's H3 open-weighting; (2) `wan3.0` accepts **documents (PDF/PPT/DOC/XLS, ≤50
  pages)** as generation input and edits "visuals, plot, and dialogue" — a
  business-document-to-video play not seen elsewhere in the set; (3) the Wan SEO layer is
  an unusually aggressive information environment and any competitor-intel pass on Alibaba
  should treat it as hostile; (4) Wan2.6's R2V reportedly carries **voice as well as
  appearance** from a reference video, which is a positioning claim worth tracking.
- `company-vision` — nothing in this brief argues for accelerating a `MASTER_AI` top-level
  orchestrator; if anything Wan reinforces the deferral, since Alibaba ships **no router and
  no orchestrator on either side of its open/closed line** and pushes the entire
  orchestration burden onto the integrator via a task-model zoo. The genuinely interesting
  sequencing question Wan raises is different: **cross-shot continuity is now unblocked by a
  provider capability**, which moves it from "blocked" to "schedulable" — a prioritisation
  call, not an architecture one.
- `ui-ux-engineer` — two patterns: (1) ComfyUI's official Wan2.2 graph **exposes the MoE
  seam to the user** (two loaders, two samplers) — an honest but costly UI decision, and a
  cautionary example of letting an internal architectural boundary leak into the user's
  mental model; (2) **documents as a creative input** (upload a deck, get a video) is a
  novel on-ramp worth noting even though it is not Narrata's use case.
- `product-strategist` — Narrata's **lockable `Character`/`Location` records with
  `referenceImages`, plus persisted take history, are ahead of Wan's shipping product** on
  persistence, for the second brief running: Wan has no saved entity of any kind at any
  layer, open or closed, and hosted results vanish in 24 hours. Combined with the Kling and
  Higgsfield findings, the industry split is now clear — **Kling and Higgsfield have entity
  libraries; Runway (narrative), MiniMax, Seedance and Wan do not.** Persistent story-world
  state remains a genuine differentiation surface rather than catch-up work.

**Bookkeeping:** `RESEARCH_CHECKLIST.md` updated — Wan row → ✅ Done with brief path;
category rows 1, 4, 5 and 7 updated with what the Wan brief contributes; Wan removed from
the next-platform priority list (Sora is now #1); **HunyuanVideo downgraded** from #8 to
"do only if a specific capability question needs it," on the grounds that the open-weight
build-vs-buy question it was queued to answer is now answered with verified arithmetic and
that it would add a sixth brief to the programme's best-covered category.

---

## 2026-09-13 — Maintenance: `RESEARCH_CHECKLIST.md` reconciled with actual repo state

No new research. The checklist had drifted out of sync with the briefs that
actually exist on disk, so it was reconciled and is now trustworthy as a
starting point for the next session.

- **Seedance marked ✅ Done** with a link to `platforms/seedance.md`, and the
  category coverage snapshot refreshed to move Seedance from the gap column to
  the covered column across all eight categories it feeds (1, 2, 3, 4, 5, 6, 7, 8),
  each with a one-line note on *what* it contributes rather than just its name.
- **Two other completed briefs were also stale in the checklist and were fixed:**
  `higgsfield.md` was still listed "⬜ Not started" despite existing with a
  CHANGELOG entry, and **`hailuo-minimax.md` was missing from the platform table
  entirely**. Both are now listed as Done and credited in the coverage snapshot.
  *Method note: the platform status table must be updated in the same pass as a
  new brief, or the "what's left" ranking silently misleads the next session.*
- **Next-platform priority re-ranked.** Sora is now #1. Recorded the more useful
  observation about the chart's new shape: categories 1, 4, 5, 6, 7 each have
  4–6 briefs with strongly converging findings, while **9 (Editing) and 10
  (Audio) have one brief each** — marginal research value has shifted toward
  those and away from a sixth general-purpose foundation-model brief.
- **Part B / category 11 (Quality Control) corrected against live code.**
  `checkSegmentFrozen()` in `apps/web/src/lib/scene-video.ts` was re-verified
  this session (freeze detection at `FREEZE_FLAG_FRACTION = 0.6`, advisory-only,
  persisted as `qcPassed`/`qcNotes`). The "Artifact detection" row moved from
  ⬜ to 🟡 Partial. **The standing premise in
  `.claude/agents/video-platform-intelligence.md` that nothing analogous to
  `IMAGE_VALIDATION` exists for video remains stale in the agent file itself** —
  flagged for the user, since agent files are not this agent's to edit.

**Open repo gap, flagged not filled:** `docs/video-platform-intelligence/REPORT.md`
— the synthesized top-level findings + roadmap artifact required by the agent's
FIRST TASK — **does not exist.** Six platform briefs have been written without
a synthesis layer over them, and the cross-platform conclusions (five-for-five
no runtime critic; three-way confirmation of first-last-frame anchoring; Narrata's
entity model ahead of three frontier vendors) currently live only in CHANGELOG
prose. Worth a dedicated pass.

---

## 2026-09-13 — New platform brief: Seedance (ByteDance Seed)

Added `platforms/seedance.md`. Covers the whole line — **Seedance 1.0** (2025-06) →
**1.5 pro** (2025-12) → **2.0 / 2.0 Fast / 2.0 Mini** (2026-02) → **2.5** (2026-07-31,
current flagship) — shipped through Doubao, Jimeng/Dreamina (CapCut), Volcano Engine
(CN) and BytePlus ModelArk (intl), and brokered inside Runway, Higgsfield, OpenRouter,
fal and Replicate. All 14 user-specified topics given dedicated coverage.

**Access note.** ByteDance has published **four** relevant English arXiv reports.
`Seedance 1.0` (2506.09113) and `Long Context Tuning` (2503.10589) were readable in
**full HTML**. `Seedance 1.5 pro` (2512.13507) and `Seedance 2.0` (2604.14148) have
**no arXiv HTML rendering** (ar5iv returns a fatal conversion error) and their PDFs
could not be parsed — **no local PDF renderer (`poppler-utils`) in this environment.
That is the single cheapest open lead in the whole research repo.** Official docs
followed the Kling pattern: `docs.byteplus.com/en/docs/ModelArk/*` returned only
navigation shells on five distinct pages (client-rendered SPA), and Chinese-language
`docs.volcengine.com/docs/82379/*` returned **empty content**. Parameter facts came
from a readable first-party **BytePlus blog** plus OpenRouter/fal/Replicate mirrors.

**Most significant findings:**

- **Seedance 1.0's technical report is the most architecturally detailed video-model
  disclosure found in this programme — more detailed than Kling-Omni.** It discloses
  VAE compression ratios, attention topology, positional encoding, training objective,
  the prompt-rewriter's backbone **by name**, the captioner **by name**, both
  distillation methods **by name**, the parallelism strategy, and a wall-clock figure
  on a named GPU. Kling published systems and withheld topology; MiniMax published
  topology and withheld systems; **ByteDance published both — once.**
- **Flow matching confirmed** (the user's premise). "Flow matching framework with
  velocity prediction," plus a "resolution-aware shift, which increases the noise
  perturbation for videos with higher resolution and longer duration." Not DDPM.
- **Decoupled spatial/temporal attention — the biggest architectural divergence from
  every other platform examined.** Spatial layers do within-frame attention **and** all
  text fusion (SD3-style MMDiT, "textual tokens only participate in cross-modality
  interaction in spatial layers"); temporal layers do cross-frame attention with
  "window partition within each frame." Compare Kling's full spatiotemporal attention.
  **This is the most plausible structural reason Seedance ships 30-second single-pass
  generation while Kling and MiniMax cap at 15s** — duration is architecturally
  cheaper here, not just commercially discounted. Most strategically relevant fact in
  the brief for a long-form storytelling product.
- **Multi-shot is a property of the positional encoding, not a stitching layer.** 3D
  MM-RoPE over interleaved text/video tokens, extended so "shots are organized in the
  temporal order of actions and **each shot has its own detailed caption**." Cleanest
  mechanistic explanation of native multi-shot found anywhere. Trained on real cut
  footage (clips ≤12s that "may contain one or multiple temporally coherent shots"),
  not synthesized.
- **The 41.4s-for-5s-1080p figure was measured on an NVIDIA L20 — the China-export-
  compliant Ada SKU**, deliberately configured under the 4,800 TPP threshold and
  roughly an order of magnitude below the H100/B200-class hardware Runway, Higgsfield
  and MiniMax benchmark on. ByteDance publishes frontier-competitive latency **on
  deliberately throttled silicon**. Reframes the whole efficiency programme as
  optimization under a hardware ceiling, and is the most plausible structural reason
  Seedance undercuts Western per-second pricing. *(Strategic/pricing read routed to
  `market-intelligence`.)*
- **Full inference-optimization stack disclosed** — TSCD (~4×) + **RayFlow** score
  distillation (ByteDance's own method, arXiv 2503.07699); a **"thin VAE decoder"**
  (narrowed channels, retrained against a *frozen* encoder → 2× decode, zero quality
  loss — a surgical optimization of a component nobody else discusses); kernel fusion
  (+15% throughput); mixed-precision quantization **specifically targeted at Attention
  and GEMM**; data+sequence parallelism with comms "reduced to a quarter of the level
  observed in Ulysses"; HSDP; PyTorch-hook CPU offload at <2%. Net **~10× end-to-end**.
- **High resolution is an explicitly stated cascade, not native.** "The base model
  generates 480p videos first, which are then upscaled to 720p or 1080p" by a refiner
  *initialized from the base model* and getting its own pre-train + SFT + **RLHF**.
  Where the Kling brief had to *infer* that 4K claims were upscales, ByteDance says so.
- **Named prompt-rewriter backbone — a first.** The Prompt Engineering module is
  "initialize[d] based on **Qwen2.5-14B**," SFT'd on prompt→dense-caption pairs then
  **DPO**'d on correct/incorrect rephrasings. Kling confirmed a Prompt Enhancer exists
  but refused to name the backbone; MiniMax names nothing. **Caution recorded: this is
  the *rewriter*, NOT confirmed as the generator's text encoder — do not conflate.**
- **`--flags` live inside the prompt string.** Seedance's canonical parameterization is
  `--ratio --resolution --duration --framepersecond --camerafixed --watermark --seed`
  appended to the prompt text, with JSON fields taking precedence where a broker
  exposes them. Combined with `@Image1`/`@Video1`/`@Audio1` reference tokens, `Shot 1:`
  / `Cut to` shot markers, camera vocabulary and quoted dialogue for lip-sync: **the
  prompt string *is* the interface, and JSON is an overlay on it.** The most extreme
  version of Runway's "collapse control surfaces into prompts" pattern, and the exact
  opposite of Higgsfield's parametric-widget expansion.
- **`@` notation, third independent sighting — but positional, not nominal.**
  `@Image1` means "the first URL in `image_urls`," not "the character named Maya."
  **No Element Library, no saved reference, no lock, no persistence between calls.**
  Same statelessness as MiniMax. Narrata's lockable `Character`/`Location` records are
  **ahead of a third frontier vendor's shipping product** on durable identity. What
  ByteDance has that Narrata doesn't is *capacity* (2.0: ≤9 img + ≤3 vid + ≤3 audio,
  hard 12-file cap; **2.5: 30 + 10 + 10 = 50 assets**) and *cross-modal* references.
- **No disclosed identity mechanism at all.** No identity embedding, IP-Adapter-like
  module, reference cross-attention, face encoder or identity loss appears anywhere in
  the readable report. References enter as ordinary tokens in the shared sequence bound
  to `@` markers. If that is the whole mechanism, **Seedance's character consistency
  may be purely in-context conditioning + data + RLHF.** Consistency is *measured* (the
  I2V "Preservation" dimension) but not enforced — mirroring the Kling brief's Layer-5
  temporal-stability finding almost exactly.
- **"White-model control" is a genuinely novel conditioning modality.** Untextured 3D
  blocking geometry or a green-screen plate supplied as a reference video to specify
  "character movement, spatial location, and interactions," leaving appearance to the
  prompt/images. A **clean separation of blocking from look** — previz-shaped, not
  prompt-shaped. No equivalent at any other platform in this programme.
- **First-last-frame anchoring now has THREE independent frontier confirmations.**
  KlingAvatar 2.0's keyframe cascade, Higgsfield's Bridge mode, and now Seedance 2.5's
  extension (forward past the last frame / backward before the first / **bridge between
  two clips**). Promoted from "interesting single-source pattern" to the **highest-
  confidence pipeline recommendation** in the repo. Narrata's Image→Video mode already
  holds both endpoint stills and already has `supportsLastFrame` plumbed.
- **Seedance returns the *joined* clip; Runway returns only the delta.** Seedance's
  extend concatenates original + new server-side, destroying the independently-
  regenerable-take property Narrata's take history depends on. **Recommendation: do not
  route extend through Seedance's endpoint** — drive it from Narrata's own chaining.

**Material corrections / conflicts recorded:**

- **RESOLUTION CONFLICT, and this one originates first-party.** Seedance 2.0's own
  arXiv abstract says "native output resolutions of **480p and 720p**"; fal lists
  480p/720p/1080p; OpenRouter exposes 480p/720p for 2.5; **ByteDance's own Dreamina
  consumer page headlines "4K."** Reconciliation that fits all evidence: native is
  480p, the refiner does 720p/1080p, consumer "4K" is a further upscale unreachable via
  API. Same drift pattern as Kling's "native 4K 60fps" — **except the drift starts on a
  first-party ByteDance surface, which makes it more dangerous, not less.** Entering
  `"4k"` into an `AiModelOption` config would silently fail or downgrade.
- **DISCLOSURE DECAY — recorded as a method finding.** ByteDance disclosed richly at
  1.0, much less at 1.5, **effectively nothing at 2.0** (its HuggingFace community's top
  comment on the #1 paper of that day: "actually more like an ad for their model, no
  details on training/data/infrastructure/inference/architecture"), and **no report at
  all for 2.5** — while shipping its biggest capability jumps at the end. **New repo
  rule: version architecture briefs against the model version, not the vendor; a
  vendor's past transparency is not a forward guarantee.** Every concrete architectural
  fact in this brief is dated to June 2025 and may be stale for the models Narrata
  would actually call.
- **HYPOTHESIS, well-supported but explicitly unconfirmed: Seedance's native multi-shot
  is LCT or a descendant.** *Long Context Tuning* (arXiv 2503.10589) is authored by
  ByteDance Seed staff incl. **Lu Jiang** (leads ByteDance video generation), published
  three months before Seedance 1.0, solves exactly the claimed capability using exactly
  the disclosed primitive (interleaved 3D RoPE with per-shot text), and adds two
  mechanisms Seedance's report omits: **asynchronous per-shot diffusion timesteps** (so
  clean shots condition noisy ones, giving joint *and* sequential generation from one
  model) and **context-causal attention** enabling KV-cached autoregressive shot-by-shot
  generation. Neither ByteDance report cites it. Most useful architectural idea in the
  brief for Narrata's long-form problem.
- **HYPOTHESIS — all 2.x latency figures.** Only the 1.0 number (41.4s, 5s@1080p, L20)
  is first-party. Circulating "30–90s" figures are secondary benchmark blogs.
- **REJECTED as evidence — "DB-DiT enabling phoneme-level lip synchronization."** This
  precise-sounding sentence circulates widely and **appears in no ByteDance source**;
  the first-party claim is only "precise multilingual and dialect lip-syncing" and
  "dual-branch Diffusion Transformer … cross-modal joint module." Third occurrence of
  the aggregator-invented-technical-sentence failure mode (after Kling's "native 4K
  60fps" and MiniMax's "physics architecture" sentence).
- **COST INTUITION INVERTED vs. the Hailuo brief.** fal documents a **0.6× price
  multiplier when a video reference is supplied** — video-conditioned generation is
  *cheaper* per second than text- or image-conditioned on the same model. MiniMax's
  reference-heavy conditioning was an order-of-magnitude cost *multiplier*. **A
  cost-aware router cannot assume "more conditioning = more expensive"; the direction
  is per-provider.**

**Correction to a standing premise in `.claude/agents/video-platform-intelligence.md`:**
the agent brief states nothing analogous to `IMAGE_VALIDATION` exists for video. **This
is now out of date.** `apps/web/src/lib/scene-video.ts` contains `checkSegmentFrozen()` —
a deterministic, **advisory-only** video QC that, for any shot whose `CameraMovement` is
not `STATIC`, probes duration and ffmpeg-detected frozen seconds and flags the segment
when frozen time reaches `FREEZE_FLAG_FRACTION` (0.6) of duration, catching "the model
likely just returned the starting image with a codec wrapper around it." Persisted per
`Asset` as `qcPassed: boolean | null` + `qcNotes`, never blocking. **Narrata already has
tier 1 of a video critic; the missing tier is the model-based one.**

**Cross-cutting pattern now confirmed across FIVE platforms:** *no runtime quality or
continuity critic exists anywhere.* Runway: none. Kling: a development benchmark
(OmniVideo-1.0), no runtime gate. MiniMax: no benchmark at all, continuity as human
doctrine. Higgsfield: an automated evaluator that scores **virality**, not correctness.
ByteDance: **the most rigorous evaluation apparatus of any of them — three reward models
(Foundational/VLM, Motion, Aesthetic), multi-round iterative RLHF applied to the refiner
as well as the base, and SeedVideoBench evaluated by film-director experts on 5-point
Likert + Good-Same-Bad — and none of it runs when a user presses generate.** No best-of-N,
no reward-guided sampling, no candidate-selection parameter, no quality score in any
response. Five for five.

**Second cross-cutting pattern, refined:** *long-form is still generate-short +
chain/extend at every frontier platform* — but Seedance moves the bar. 30s single-pass
(double Kling and MiniMax), multi-round extension, and a ByteDance-claimed **~180s beta
long-video mode**. Narrata's per-shot-pair + assembly architecture remains the industry
standard, but the *unit* of a shot pair can now be much longer on the right route.

**Routed to other agents:**

- `video-architect` — **top item: add the Seedance family to `AiModelOption` as a
  cost/duration tier ladder. This is registry rows, not a build.** Four models already
  on OpenRouter (Narrata's provider), all matching the request shape `generateVideo()`
  already emits: `bytedance/seedance-2.0-mini` (from $0.03363/s), `-2.0-fast`
  ($0.04035/s), `-2.0` ($0.06726/s), `-2.5` ($0.1028/s) — all with first+last-frame
  conditioning, `input_references`, `generate_audio`, `callback_url`. The brief contains
  a ready-to-enter `VideoModelConfig` table (verify live before entering — provider
  pages drift). Also: (2) **prefer both-ends conditioning over forward chaining**
  wherever a shot pair has two stills — three independent frontier confirmations, and
  `supportsLastFrame` + `frame_images.last_frame` are already plumbed; (3) build the
  model-based tier of the video critic on **SeedVideoBench's published rubric** (Motion
  Quality / Prompt Following / Aesthetic Quality incl. *"perceptibility of AI sense"* /
  Preservation, each with named sub-criteria, validated by film directors) using
  `IMAGE_VALIDATION`'s result shape as the template; (4) **do not route extend through
  Seedance's server-side concatenation**; (5) use free native audio (`generate_audio`
  defaults true, no extra cost) for **ambience and diegetic SFX only, never character
  voice** — Narrata's server-side voice resolution exists precisely to keep voices
  constant, and a native-audio model would re-invent them per clip; (6) add a
  **reference-budget** field to `VideoModelConfig` — Narrata already sends
  `input_references` but has no cap modelled, and the spread is 1 (MiniMax S2V-01) to
  12-total (Seedance 2.0) to 50 (Seedance 2.5); (7) add a **duration-capability**
  routing dimension — 2.5's 30s ceiling makes "this pair needs a long continuous take"
  a routing input, not just a segmentation input.
- `ai-architect` — (1) **compile `CameraMovement` per-provider rather than emitting
  prose**: `STATIC` → `--camerafixed true`, everything else → `--camerafixed false` +
  the movement term; (2) add a **speed/stability qualifier** to the camera vocabulary —
  Narrata's enum lacks one and both Runway and ByteDance treat it as mandatory; (3)
  Seedance supplies the *reason* closed camera vocabularies work — camera terms are
  baked into the training captions by design ("dynamic features" fused with "static
  features") — which raises confidence in the constrained-vocabulary approach already
  recommended from the Runway brief; (4) **per-shot caption style**: the target output
  format for `MOTION_PROMPT_DRAFTING` should fuse dynamic (action + camera) with static
  (appearance, aesthetics, style) features, because that is literally the caption
  distribution these models were trained on; (5) **express multi-shot as prompt
  structure** (`Shot 1:` / `Cut to` with per-shot descriptions) where the route supports
  it — potentially one call instead of N for a continuous scene, with cut continuity
  handled in-model; countervailing constraint, it forfeits per-shot take history, so it
  suits scene-level generation not shot-level iteration; (6) do **not** flatten Narrata's
  entities into positional `@Image1` slots — use Seedance's capacity to send *more* of
  Narrata's already-structured references.
- `technical-architect` — **awareness only, no action.** Nothing here is self-hostable
  (no open weights anywhere in the Seedance line). The transferable *method* findings
  are: separable serving costs are worth attacking surgically (the thin VAE decoder:
  shrink only the decoder, retrain against a frozen encoder, leave the latent space and
  the whole trained generator untouched — 2× for free), and quantization targeted at
  specific op classes (Attention + GEMM) rather than applied blanket. Also note the
  regional API split (`ark.ap-southeast.bytepluses.com` vs Volcano Engine) as a probable
  data-residency boundary if a direct integration is ever considered over OpenRouter.
- `market-intelligence` — (1) **the L20 finding is yours to run with**: ByteDance
  benchmarks frontier-competitive latency on export-throttled silicon, which is the most
  plausible structural explanation for why Seedance undercuts Western per-second pricing
  — an architecture fact with direct pricing/positioning implications; (2) **provider-
  continuity risk**: copyright actions from Disney, Paramount Skydance and the MPA
  following Seedance 2.0, ByteDance's 2026-02-16 commitment to "strengthen the
  safeguards," and US Senate calls for shutdown — flagged here only because it is a risk
  on any route Narrata adds, not analysed; (3) Seedance is brokered **inside Runway**
  (it powers Runway's Generative Extend) **and Higgsfield** — a frontier lab depending on
  a Chinese competitor's model for a named feature is a competitive-structure signal;
  (4) the disclosure-decay trajectory (excellent report → advertisement → silence) is a
  readable signal about how ByteDance now views its video line.
- `monetization-strategist` — the published token formulas are usable cost-architecture
  input (`tokens = width × height × fps × duration / 1024`; BytePlus $0.0025/1K for
  1.0-lite, fal $0.014/1K for 2.0 and $0.0214/1K for 2.5, OpenRouter $0.0336–$0.1028/s).
  **Two structural notes matter more than the numbers:** (a) native audio is **free** on
  these routes (`generate_audio` billed at no extra cost), which changes the marginal
  cost of an audio-bearing clip; (b) the **0.6× video-input multiplier** means
  conditioning direction affects price non-obviously. Also: a **3× per-second spread
  inside one vendor family with one API shape** makes draft-then-upgrade tiering unusually
  cheap to implement — same call site, different registry row.
- `ui-ux-engineer` — (1) **prompt-as-entire-interface** vs. structured builder: Seedance
  puts parameters, references, shot structure, camera language and dialogue all in one
  text field, the most extreme version of Runway's collapse-into-prompts pattern and the
  exact opposite of Higgsfield's widget expansion — two frontier products, opposite
  conclusions, and Narrata's in-flight structured Prompt Builder sits between them; (2)
  **local re-draw as the default correction verb** ("refine only the parts of a video
  that need adjustment instead of recreating the entire scene," with timestamp-level
  targeting) rather than full regeneration; (3) ByteDance frames extension
  *dramaturgically* — "setup, development, turning points, and resolution," "narrative
  pacing" — which is the register Narrata's product already speaks.
- `product-strategist` — Narrata's lockable `Character`/`Location` records are now ahead
  of a **third** frontier vendor's shipping product on durable identity (Runway: no
  `Location` entity; MiniMax: no saved references; Seedance: positional slots only).
  Three-for-three is no longer a coincidence — persistent named entities are a
  differentiation surface, not a gap.

---

## 2026-09-13 — New platform brief: Hailuo / MiniMax

Added `platforms/hailuo-minimax.md` — third platform brief, written to feed the
cost-aware model-router design work. Covers the **MiniMax H3 / Hailuo 3.0** line
(announced 2026-07-31, **open-weighted 2026-08-03**) plus the still-live Hailuo
2.3 / 2.3-Fast / 02 and the legacy `*-01` models.

**Access note, and a first for this research repo:** MiniMax's own API reference
at `platform.minimax.io/docs/*` is **directly fetchable in full**. Unlike the Kling
brief — where `kling.ai/document-api/*` was an unreadable SPA and parameter facts
had to come from third-party mirrors — every parameter-level claim here is
first-party. Countervailing gap: **MiniMax has published no technical report for
any video model** (one was stated as "coming soon" at the H3 launch; nothing on
arXiv under MiniMax authorship for the video line). So the disclosure pattern is
the **inverse of Kling's**: MiniMax published model topology in detail and withheld
systems engineering and the entire training recipe.

**Most significant findings:**

- **The three-stage pipeline is exposed as three separately callable, separately
  billable endpoints** — `/v2/h3_context_ir` (understand + enrich; explicitly
  "does not create a video generation task"), `/v2/video_generation`,
  `/v2/video_regeneration` (768P → 2K). Kling and Runway both bury these stages
  inside one call. **This is the most router-relevant finding across all three
  briefs so far**: prompt enrichment becomes cacheable, and resolution becomes a
  post-review per-take decision.
- **2K is "In-Context Regeneration," not super-resolution** — official wording:
  the base model "regenerate[s] its own low-resolution output in-context," with no
  "dedicated super-resolution module." Directly opposite to Kling's cascaded SR.
- **Architecture disclosure is more concrete than Kling's despite there being no
  paper**: 33B dense single-stream Transformer, ~13B in modality-specific AdaLN
  branches, 52 DiT blocks/partition, 3D MM-RoPE, encoder = **Qwen3-VL-32B layer-50
  hidden states**, H3-VisualVAE `f16t4d24` (16× spatial / 4× temporal, causal),
  H3-AudioVAE stereo 32 kHz / 40 Hz latent rate, CFG-distilled BF16, sparse
  attention trained but withheld.
- **Verified cost/quality lattice with a non-obvious inversion.** Hailuo video
  points: 512p/6s = 0.3, 768p/6s = 1.0, 768p/10s = 2.0, 1080p/6s = 2.0 (standard);
  0.7 / 1.1 / 1.3 (2.3-Fast). Per-second cost is minimised at **6s on standard
  (0.167 pt/s) but 10s on Fast (0.110 pt/s)** — **cost-optimal clip length inverts
  between tiers**. And 512p is superlinearly cheap (3.3× cheaper for ~2.25× fewer
  pixels), making a draft tier economically real. 6.7× total spread inside one
  vendor's catalogue.
- **Long-form: flat 15s ceiling, no extend of any kind**, confirmed by enumerating
  MiniMax's own six video endpoints. Their own guidance prescribes 4–6s clips as
  "narrative atoms" plus a Beginning–Middle–End framework ("a standard 15-second
  arc requires these three atoms"). **Sharpest contrast yet with Kling's three-tier
  ≤15s / ≤3min / ≤5min duration story.**
- **Continuity is stateless and prescribed as human discipline.** Two API layers
  (S2V-01: exactly one image, `type:"character"` faces only; H3 Ref2VA: ≤9 images
  + ≤3 videos + ≤3 audio, 12 files max) and then a published doctrine: one **Master
  Reference Image** per scene reused across every beat (claimed −70% prompt
  variance), identical lighting keywords in every prompt, and "generate all clips
  for a specific sequence in a single sitting." **No Element-Library equivalent —
  no saved entity, no @mention, no lock, tasks expire from queryability in 7 days.**
  Narrata's lockable `Character`/`Location` records and take history are **ahead of
  MiniMax's shipping product** here.
- **A vendor admitting the consistency-vs-prompt-adherence tradeoff.** MiniMax's own
  S2V-01 launch post says the model "enhances subject consistency" but "may
  occasionally follow prompts less precisely" than T2V or I2V, "with some
  environmental morphing." Neither Runway nor Kling admits this. It is a real
  tension a router must model.
- **Camera control is a genuine in-prompt DSL** — 15 bracketed tokens
  (`[Push in]`, `[Truck left]`, `[Tracking shot]`, …), composable (≤3 per bracket)
  **and temporally ordered by position in the prompt string**. More structured than
  Runway's vocabulary, more expressive than Kling's non-time-positioned
  `camera_control` JSON.
- **Novel supply-chain pattern:** `MiniMax-H3-Max` is a selectable model in
  MiniMax's *own* v2 API and is **fal Research's post-train of MiniMax's open
  weights**. Open release → third-party specialisation → re-absorption into the
  first-party menu. Implication: "which model" and "which provider of that model"
  are independent router dimensions with different prices and feature coverage.
- **Hard conditioning-mode exclusivity:** first/last-frame pinning ⊥
  reference-image/video/audio conditioning in a single v2 request. Structurally the
  same class of constraint as Kling's `camera_control` ⊥ `image_tail`. A
  provider-agnostic adapter needs a **capability matrix with exclusion rules**, not
  a parameter map.

**Material corrections to hype / secondary claims:**

- **DOWNGRADED to HYPOTHESIS — the Hailuo 2.3 "physics architecture" sentence.**
  The widely-quoted claim that the "Hailuo core interprets motion through
  physically correct depth and inertia mapping, with materials deforming and
  reacting according to type" **does not appear on MiniMax's own 2.3 announcement**,
  which was fetched directly and contains only "enhanced understanding of physics
  and command following," "greater fluidity, naturalness, precision, and control,"
  and "enhanced response to motion commands for objects." The precise-sounding
  sentence traces to third-party creative-tool blogs. **Same failure mode as the
  Kling brief's "native 4K 60fps"** — a specific technical sentence originating
  downstream of the vendor and circulating as disclosure. Method rule added: direct-
  fetch the vendor's own announcement, and treat unusually precise technical
  phrasing in aggregator coverage as a red flag.
- **REJECTED — "2 concurrent tasks free / 15 paid."** MiniMax's official rate-limit
  table says **V1 = 20 RPM; V2 (MiniMax-H3) = 300 RPM with max 30 in-flight tasks**,
  with no free/paid split published. The circulating figures contradict the primary
  source.
- **DOWNGRADED to HYPOTHESIS — H3 "audio-video continuation."** Appears in
  third-party broker docs (Runware) and secondary write-ups; absent from MiniMax's
  own endpoint enumeration and its own H3 capability page. Do not plan around it.
- **DOWNGRADED — H3 "4K."** MiniMax's own docs cap H3 at **2K**; the 4K reference
  comes from fal's comparison page. Treat 2K as the ceiling.
- **DOWNGRADED — NCR's mechanism.** MiniMax names "Noise-aware Compute
  Redistribution" and claims 2.5× efficiency / 3× params / 4× data for Hailuo 02,
  but **never describes what it does**; the "dynamically identify high-error
  timesteps" explanation is secondary-only. Also unverified whether NCR survives
  into H3 — it is not mentioned in any H3 material.
- **FLAGGED AS UNVERIFIED — the H3 licence territory and revenue terms**
  (reportedly worldwide excluding EU/UK/South Korea/USA, ~$20M/yr revenue ceiling).
  From secondary reporting plus the model card's application requirement; the
  licence text was **not read this session**. Needs human legal review before it
  informs anything.
- **Conflict recorded, unresolved:** MiniMax's official `video-generation-i2v`
  reference lists **no** `last_frame_image` parameter, yet "Start & End Frames" is
  officially announced as live on the v1 API for Hailuo 02 with per-sub-mode
  resolutions. Must be resolved empirically before any v1 integration.
- **Conflation warning added:** MiniMax's lightning-attention / MoE / 456B-param
  arXiv reports (2501.08313, 2506.13585) describe the **M-series text line**, not
  the video line. H3's encoder is Qwen3-VL-32B and its generator is a dense 33B
  DiT. Several secondary write-ups blur these.

**Cross-cutting pattern now confirmed across three platforms:** *no runtime quality
or continuity critic exists anywhere.* Runway: none found. Kling: a development-time
benchmark (OmniVideo-1.0) with no runtime gate. MiniMax: **no benchmark disclosed at
all**, and continuity handled as a documented human workflow; the only automated gate
is content moderation (HTTP 422). This is now stated as a conclusion, not a
hypothesis — Narrata's missing video/voice/music validation analogue to
`IMAGE_VALIDATION` is a differentiation surface, not catch-up work.

**Second cross-cutting pattern:** *long-form is generate-short + assemble at every
frontier platform examined.* Runway delegates extend to a brokered third party and
tells users to chain in Workflows; MiniMax has no extend at all and prescribes
3 × 4–6s atoms; only Kling's narrow avatar line produces multi-minute output in one
operation. Narrata's per-shot-pair generation + assembly architecture is the
industry-standard answer, not a limitation.

**Routed to other agents:**

- `video-architect` — (1) make deferred-resolution a first-class per-take decision
  (draft low-res → review → upgrade keepers), backed by the verified 6.7× points
  spread; (2) put a **per-model-option cost curve** in the router rather than
  assuming cost is linear in duration, because cost-optimal clip length inverts
  between standard and Fast tiers; (3) replace the provider parameter map with a
  **capability matrix carrying exclusion rules** (MiniMax first/last-frame ⊥
  references; Kling `camera_control` ⊥ `image_tail`); (4) make pipeline stages
  independently addressable so a regeneration reuses the stored enriched prompt;
  (5) reference-heavy conditioning is an order-of-magnitude cost multiplier
  (measured: 86.96 s for 8.7 s FL2VA vs 784.4 s for a two-video Ref2VA on 4×B300) —
  treat reference count as a cost dimension, not a free quality dial.
- `ai-architect` — (1) store camera intent **structurally as a fixed enum** and let
  provider adapters serialise it (MiniMax bracketed tokens vs Runway prose with
  speed qualifiers); (2) derive and pin a **per-scene Master Reference Image plus a
  per-scene lighting clause** and inject both into every shot prompt in that scene —
  prompt-assembly change, no new tables; (3) `MOTION_PROMPT_DRAFTING`'s target
  output format should look like MiniMax's Context-IR output (per-beat timing,
  character detail, soundscape, scoring); (4) model the consistency-vs-prompt-
  adherence tradeoff deliberately on `isLocked` rather than letting it happen
  silently; (5) keep the `AiModelOption` registry's provider-agnosticism strict —
  the model set will increasingly include community post-trains of open bases.
- `monetization-strategist` — the verified Hailuo video-points lattice is usable as
  cost-architecture input **but no dollar figure in this brief is first-party
  verified**. Secondary figures conflict badly (MiniMax-direct reported at $0.08/s
  768P + $0.13/s 2K + $0.05/s for 2K regeneration + $0.04/image after 5 free; fal
  reports $0.06/s for H3 at 768p and $0.08/s for H3-Max, both $0.05/s at 480p, with
  token-pooled rather than per-image reference billing). Needs first-party
  verification before any unit-economics model depends on it. The deferred-resolution
  pattern is the credit-tier design question.
- `market-intelligence` — (1) **an open-weight frontier video model now exists**
  (H3-Base, 33B, 2026-08-03) and is #1 on Artificial Analysis' Video Editing arena;
  this is a pricing-floor event with direct competitive implications; (2) the
  open-release → fal post-train → re-served-in-first-party-API supply chain is a new
  competitive pattern; (3) MiniMax reportedly split compute between M-series text and
  H-series video while expanding a self-operated GPU cluster (H1 2026 disclosure);
  (4) ARR/margin trajectory, the Alibaba Cloud data-platform partnership, and the
  licence's territory/revenue terms are all yours, not analysed here.
- `technical-architect` — **awareness only, no action.** Self-hosting H3 does not
  clear the Section 12 bar: official reference config is 8×B200 with Ulysses 8,
  labelled "Experimental"; the open release **excludes H3-Context-IR and the entire
  2K workflow**, so a self-host reproduces neither the prompt intelligence nor the
  output resolution of the hosted product; measured ~10× real-time on 4×B300 for the
  easy path; MiniMax explicitly hands the operator capacity planning, scaling,
  monitoring, recovery and upgrades. Narrata is single-VPS with empty `workers/`.
  The open weights matter as *evidence*, not as an integration target. Also worth
  designing for: HTTP **422 sensitive-content** is a routine expected failure mode on
  this provider, not an edge case.
- `company-vision` — MiniMax's own Media Agent roadmap puts full autonomy at Stage 3
  and has shipped Stage 1 (templates). This **corroborates the existing decision to
  defer a `MASTER_AI` top-level orchestrator** until per-stage pipelines are solid;
  it is not evidence for building one sooner.
- `product-strategist` (on behalf of the unstaffed `growth-strategist`) — Hailuo ships
  **nine named single-purpose template generators** (CineScope, LoveFrame, PetPal,
  BabyForm, PlayFun, SnapMorph, Style Switch, ASMR, Ads) alongside the general tool.
  That is an activation/distribution pattern, not architecture, and it is the kind of
  finding that belongs to growth.
- `ui-ux-engineer` — two patterns: (1) resolution as a **deferred, post-review
  decision** rather than an up-front setting; (2) publishing an opinionated workflow
  doctrine (clip length, master reference, lighting lock) as product content, which
  demonstrably substitutes for feature surface.

---

## 2026-09-13 — New platform brief: Higgsfield (`platforms/higgsfield.md`)

First brief written from a **product-layer** angle rather than a model-first one, at the
user's direction: Higgsfield is the closest structural analogue to Narrata yet examined —
a company that trains a few native models but competes almost entirely on the directorial
control surface stacked over ~30 brokered third-party generation models. Eleven
user-specified topics were each given a dedicated researched subsection with its own
"Narrata read."

**Cross-cutting pattern identified — and it directly contradicts the Runway brief's
headline lesson.** `runway.md` recorded that Runway repeatedly **collapses control
surfaces into prompts** (masks → noun phrases, camera sliders → camera vocabulary,
parametric camera control retired 2026-07-30). Higgsfield does the **opposite**: it
*expands* control into parametric widgets — per-shot camera body/lens/focal length/
aperture, a two-source Lighting Console, an Emotion Wheel (8 emotions × 3 intensity
levels), 50+ colour grades, Tempo, an Era scrubber. Two frontier products reached
opposite conclusions about the same problem.

**Higgsfield's reconciliation of the two is the single most transferable idea in the
brief: a notation layer.** Camera moves are `#`-tags and characters/emotions are
`@`-mentions *inside the prompt field*, so widgets compile into prompt tokens rather than
into a separate parameter namespace. Structured control that stays legible to a
text-conditioned model — and emittable by an agent over MCP without a bespoke schema.

**Material findings:**

- **Three-way character-identity split, vs Runway's two.** **Soul ID** is a genuinely
  *trained* identity (20–80 photos, "training takes a few minutes," server-side,
  non-exportable, **holds exactly one person**); **Elements** are reference-based named
  reusable assets (character/location/**prop**) invoked with `@`; **Soul Cast** /
  **AI Influencer** are menu-driven *generative* character builders. Runway's narrative
  product has only the reference path and sells "no fine-tuning required" as a feature;
  Higgsfield sells fine-tuning as the premium tier. Notable workflow: a *generated*
  character is made persistent by generating a synthetic portrait batch and training
  Soul ID on it.
- **Kling and Higgsfield independently converged on the same construct and the same
  notation** — named, typed, reusable entity "Elements" invoked by `@name`. Third
  corroboration (with Runway's References) of Narrata's `Character`/`Location` +
  `referenceImages` design. Narrata's gap is a **prop** type, not the core pattern.
- **The AI Director is deliberately advisory.** Claude decomposes a script into shots with
  camera parameters pre-filled, but "Claude-generated prompts populate the prompt box for
  your review before generating: Claude never triggers generation directly." A
  well-capitalized frontier product put a human gate between planning and spend —
  corroborating the recorded decision to defer `MASTER_AI`.
- **Runtime quality/continuity critic gap now confirmed three-for-three.** Higgsfield
  ships the first automated post-generation evaluator found in this programme —
  **Virality Predictor** (Virality Index, Hook Strength, Hold Rate, attention curve,
  "brain-region heatmap") with a documented score → regenerate loop. But it scores
  *commercial outcome*, not correctness: no continuity check, no identity-drift check,
  no prompt-adherence gate anywhere. Runway, Kling and Higgsfield all lack a quality
  critic. Strengthens the case that Narrata's missing video/audio validation stage is a
  **differentiation opportunity**, not catch-up work.
- **Image → cinematic video is the strongest validation of Narrata's own architecture
  found so far.** DoP animates a keyframe from a curated *motion-preset* library rather
  than from prose; Popcorn generates the keyframes; Soul/Soul ID guarantee the person in
  them. Identity, composition and style are solved in image space, and the video model is
  asked only for motion — the same bet as Narrata's Image→Video mode and its per-shot-pair
  architecture. "DoP builds the entire shot from [the keyframe]" also elevates the
  priority of Narrata's existing `IMAGE_VALIDATION` stage.
- **"Bridge" extend mode** (generate *between* two existing points) is the second
  independent sighting of first-last-frame anchoring after KlingAvatar 2.0's cascade.
- **Post-generation look-lock is a distinctive continuity layer.** Colour grade, Relight
  and the Era scrubber apply *after* generation and project-wide — converting a stochastic
  conditioning problem (style drift across shots) into a deterministic transform. Mostly
  achievable in Narrata's existing ffmpeg render pipeline with **no inference cost**, and
  the benefit grows with story length.
- **Three distinct template types** worth keeping as a taxonomy: **presets** (parameter
  bundles), **format templates** (Marketing Studio's 1,500+ output recipes), **pipeline
  templates** (user-authored Canvas graphs). Only the third is user-authored — and only
  the third is one Narrata should skip.
- **Routing is agentic, not policy-driven.** Supercomputer's officially named
  "Orchestrator" picks the model per step; there is no public equivalent of Runway's
  declarative `optimize_for` + allow/deny + cost caps. Routing is also entangled with
  pricing ("unlimited" mid-tier models, credits for premium).
- **Higgsfield never retires versions** — Cinema Studio 2.0 through 4.0 all remain
  selectable — the exact opposite of Runway's 2026-07-30 mass retirement. Affordable only
  because Higgsfield's versions are control surfaces over brokered models, not models.

**Engineering-surface check (per the lesson recorded in the Runway entry below): mixed
result, and the lesson needs refining.** Higgsfield has **no research blog, no arXiv
paper, and no engineering blog** (`blog.higgsfield.ai` does not resolve). It *does* have a
detailed help center, an official changelog, and public API docs — the help center is the
best primary source in the brief. The only engineering-depth disclosure anywhere is a
**vendor-co-published Nebius case study** (HGX B200/Blackwell, distributed optimizers
chosen over activation checkpointing, FlashAttention + cuDNN fused attention,
`torch.compile()`, 720p→2K+ curriculum, location-aware latent cache with async batch
pulling, **DPO with human evaluators**, 4.5M+ daily generations). **Refined lesson: when a
platform has no engineering blog, check its cloud/infrastructure vendors' customer-story
pages — that is where the engineering detail leaks.** Note the Nebius study covers
**training only**; serving internals remain NOT VERIFIABLE.

**New evidence trap recorded:** `geo.higgsfield.ai` is a Higgsfield-owned subdomain
hosting apparently AI-generated SEO content. It *looks* first-party by domain but is
marketing by substance and contradicts the help center in places. Nothing from it was used
for a VERIFIED claim. Also flagged: Higgsfield's own surfaces contradict each other on
resolution/duration (product page "native 4K / one minute" vs blog "30 seconds / 1080p") —
same marketing-drift pattern as Kling's unverified "native 4K 60fps."

**Routed to other agents:**

- `ai-architect` — **top item:** per-character emotion + intensity as a structured,
  entity-bound attribute driving both visual prompt and voice call from one source
  (`Character` + `DIALOGUE_DIRECTION`/`NARRATION_DIRECTION` already know who is speaking).
  Also: a closed named camera/motion vocabulary compiled into prompt tokens (extends the
  in-flight structured Prompt Builder work); `@`-mention entity invocation; a **prop**
  entity type; a per-shot entity manifest as data rather than prose; a project-level
  "look" record on `StoryBible`; reference *selection/ranking* as reference budgets
  escalate (3 → 9 → 50 in one year at Higgsfield). Watch item, **not** a recommendation:
  trained per-character identity — re-open only if a provider exposes hosted per-character
  fine-tuning behind an API.
- `video-architect` — project-level look normalization in the **ffmpeg render pipeline**
  (deterministic, zero inference cost, scales with story length); bridge-mode generation
  vs pure forward chaining; strengthening `IMAGE_VALIDATION` as the load-bearing gate for
  the *video* that follows; a continuity/prompt-adherence critic modelled on
  `IMAGE_VALIDATION`'s result shape — now confirmed as an open industry gap across three
  platforms. Note: frontier use of multi-candidate ranking is for *building preference
  data*, not serving users — does not reprioritize best-of-N.
- `ui-ux-engineer` — department-organized control panel (camera / light / grade /
  performance / pacing) matching users' production mental model; preset browsing with
  categories and Trending/Top Choice ranking; **cost shown before the Generate action
  commits**; a generated-character builder form.
- `product-strategist` — Higgsfield beats Narrata on single-protagonist likeness fidelity
  via training, but Soul ID explicitly "holds one person"; **multi-character continuity
  across a long story is the axis where Narrata can win.** Also: do *not* adopt
  tool-per-job fragmentation (seven tools serving seven buyer personas is Higgsfield's
  go-to-market artifact, not a UX insight).
- `growth-strategist` — **first routing to this agent from this repository.** Higgsfield's
  growth architecture: template-first creation with no prompt required, an automated score
  that makes regeneration feel purposeful rather than like failure, a social-shaped mobile
  app (Diffuse) with daily free credits, MCP/CLI/Skills as a distribution channel (second
  sighting after Runway), and competitor-recreation hooks (Ad Reference — flagged as
  legally fraught and **not** recommended).
- `monetization-strategist` — **first routing to this agent from this repository.** Model
  routing is a margin lever, and Narrata's `AiModelOption` registry already has the hooks;
  "unlimited mid-tier / credits for premium" is a live competitor structure;
  cost-before-generate is the trust precondition for credit pricing (and Narrata currently
  discards OpenRouter's cost field); template-first creation drives volume per user, which
  is the demand side of a credit model.
- `technical-architect` — Nebius disclosures are **Scale** architecture for a
  model-training company and do **not** apply to Narrata at MVP. Transferable method only:
  the named bottleneck is data loading/orchestration, not compute — which echoes the
  Runway SLO-driven-queue-sizing finding. Also a real question raised: Narrata's
  `AiModelOption` registry means a project generated last month may not reproduce today;
  Higgsfield's answer (never break an old configuration — CS 2.0–4.0 all live) is one
  valid response.
- `company-vision` — Higgsfield corroborates the recorded sequencing decision to defer a
  `MASTER_AI` orchestrator: its agentic layer (Supercomputer) is **additive** to a strong
  deterministic per-stage layer, not a replacement for it, and its AI Director plans
  without executing.
- `market-intelligence` — Higgsfield positions toward performance/creator marketing with
  filmmaking as a halo, materially different from Runway's studio/post-production push;
  its ads business funds its filmmaking product. Business figures encountered (≈$700M
  annualized per Sacra, ~20M users, 50M videos, ~4.5M daily generations, $130M Series A at
  $1.3B, reported talks near $5B) were **not** reasoned about in the brief.

---

## 2026-09-13 — Runway brief: six-gap follow-up audit

Audited `platforms/runway.md` against a user-supplied checklist; six gaps researched
and integrated in place (no rewrite).

**Material corrections to prior findings:**

- **Infrastructure was under-researched, not unverifiable.** The first pass logged
  cloud/orchestration/storage as NOT VERIFIABLE. Runway in fact maintains an
  **engineering blog** at `runway.com/news/engineering`, separate from its research
  and changelog surfaces, disclosing: Kubernetes with production inference and
  research in separate clusters; **Kueue** as GPU scheduler (chosen over Volcano);
  a custom cross-cluster capacity controller named **`deckard`**; p98-SLO-driven
  capacity planning via discrete-event replay of arrival rates; +20pp GPU
  utilization (~2x industry norms); AWS SQS queueing; GCP `a3-megagpu-8g` node
  pools. **Lesson: check for an engineering surface distinct from research/changelog
  on every platform brief.** Serving internals (runtime, quantization, parallelism,
  absolute GPU counts, storage/CDN vendors) remain genuinely unverifiable.
- **Dev API `Characters` are conversational avatars, not narrative-continuity
  entities.** The prior brief's Continuity Layer 3 overstated this. Narrative
  identity is carried by **saved References**, not `Character` objects. This
  weakens Runway as a precedent for Story-Bible-style character records.
- **No first-class Location/Environment entity exists in Runway's narrative
  product** — now a confirmed gap rather than an unresearched one. Locations ride
  the entity-agnostic Reference mechanism plus a `locations` section in enterprise
  Brand Kits. The only structured world-state format, **WorldPrompt**, is confined
  to the GWM world-model branch.

**Newly documented:**

- **Camera control** — parametric control (Gen-3 Alpha Turbo's direction+intensity
  sliders) was **retired 2026-07-30**; current camera control is purely prompt-based,
  backed by an official camera-vocabulary library.
- **Generative extend** — still current and named, but delegated to a brokered
  third-party model (Seedance 2.5 Edit/Extend node), bidirectional, returning only
  the new footage for user assembly. Gen-4.5 has no confirmed native extend;
  Aleph 2.0 does not add duration.
- **Inpainting** — mask-based tool **retired 2026-07-30**, replaced by prompt-scoped
  Aleph 2.0 ("no mask, no tracking step") surfaced via the "Remove from Video" App
  and Agent 2.0. Outpainting is explicitly distinguished as "generative fill"; no
  current-model implementation confirmed.
- **Asset management** — Workspace → Project → Folders → system folders (All
  Generations / Private), plus a metadata/filter layer and a reference-semantics
  layer. **No generation version history or lineage found** (STRONG INFERENCE of
  absence). Notable pattern: Brand Kit section descriptions are compiled into a
  **custom system prompt**, making reference bundles retrieval-*plus-instruction*.

**Cross-cutting pattern identified:** Runway repeatedly **collapses control surfaces
into prompts** (masks → noun phrases, camera sliders → camera vocabulary). This is
the single most transferable UX/prompt-architecture insight in the brief.

**Routed to other agents:**

- `ai-architect` — constrain camera language in `MOTION_PROMPT_DRAFTING` /
  `SHOT_PLANNING` to a fixed, model-legible vocabulary with mandatory speed/duration
  qualifiers; add a usage-note/intent field alongside `referenceImages` on
  `Character`/`Location` so references carry instructions, not just pixels.
- `video-architect` — prompt-scoped partial regeneration ("change only X in this
  shot") as a cheaper alternative to full-take regeneration; preserve the
  "extension is a separate reviewable asset" property if extend is ever built.
- `ui-ux-engineer` — prompt-scoped editing instead of masking UI; project-scoped
  context auto-injection ("never re-upload").
- `technical-architect` — Runway's infra is Scale/Enterprise and does **not** apply
  to Narrata at MVP. Only transferable idea: size queues against a latency SLO via
  arrival-rate replay, relevant only once a worker fleet exists.
- `product-strategist` — Narrata's take-history lineage appears to be *ahead* of
  Runway's flat All-Generations model; lockable `Location` records are ahead of
  Runway's narrative product. Both are differentiation surfaces, not gaps.
