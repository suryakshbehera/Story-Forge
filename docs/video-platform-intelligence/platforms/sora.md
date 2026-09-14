# OpenAI Sora (Sora / Sora Turbo / Sora 2 / Sora app) — Architecture Brief

**Analysis date: 2026-09-14.**

**STOP-SHIP NOTICE, read this before anything else in the brief.** OpenAI is
in the process of **discontinuing the entire Sora product line.** The Sora
web app and iOS app were **shut down 2026-04-26**. The Sora **API**
(Videos API; models `sora-2`, `sora-2-pro`, and their dated snapshots
`sora-2-2025-10-06`, `sora-2-2025-12-08`, `sora-2-pro-2025-10-06`) is
scheduled to shut down **2026-09-24 — ten days from this brief's analysis
date** — with **no replacement listed** in OpenAI's own deprecations table.
**[VERIFIED — `developers.openai.com/api/docs/deprecations`, fetched directly
this session; corroborated by `help.openai.com`'s "What to know about the
Sora discontinuation" article via search excerpt, and by TechCrunch/Axios/
the-decoder reporting the 2026-03-24 announcement]**. Reported cause: Sora
reportedly cost OpenAI roughly **$1M/day** to run against **$2.1M in total
lifetime in-app revenue**, alongside a sharp post-launch download decline and
copyright pressure; OpenAI's video-research team is reported to be
redirected toward **world-simulation work tied to robotics** rather than a
narrative-video successor. **[Cost/revenue figures and the redirection claim
are STRONG INFERENCE — sourced to WSJ-cited reporting relayed by TechCrunch/
Axios/the-decoder, not an OpenAI-published figure; the shutdown dates and
absence of a replacement are VERIFIED]**.

**What this means for the rest of this brief.** Everything below is still
worth knowing, for three reasons the user's brief explicitly anticipated:
(1) Sora's original technical report is the frontier's most explicit
"world simulator" framing and shaped how every other platform researched in
this programme talks about physics/continuity; (2) Sora 2's API surface —
Characters, Edits, Extensions, timestamp-based multi-shot prompting — is a
real, if now time-boxed, architectural data point that converges strongly
with patterns already found in Runway, Veo, and Seedance; (3) as a **build
target for Narrata, the answer is now simple and non-negotiable: do not
integrate Sora.** By the time any integration work could ship, the API will
already be gone. Treat this brief as **architectural precedent and
comparative evidence**, not as a live vendor option. Routed to
`market-intelligence` and `technical-architect` in more detail below.

Every non-trivial architectural claim is labeled **VERIFIED** (OpenAI's own
technical report, system cards, API docs, cookbook, help center),
**STRONG INFERENCE** (implied by observable API surface or documented
technique), or **HYPOTHESIS** (plausible, unconfirmed) — per
`.claude/agents/video-platform-intelligence.md`'s research principle.

**Method note on access.** `openai.com` returns HTTP 403 to this session's
direct-fetch tool for every page tried (`/index/video-generation-models-as-
world-simulators/`, `/index/sora-2/`, `/index/sora-2-system-card/`), and
`help.openai.com` also 403s. Claims sourced to those pages below come from
**search-engine indexed excerpts that quote the official pages directly**
(the same method the Runway and Veo briefs used for `help.runwayml.com` and
`docs.cloud.google.com`), and are labeled VERIFIED only where the quoted
text is unambiguously first-party phrasing repeated consistently across
independent search results. Two exceptions were directly fetchable and
**read in full**: the **Sora 2 System Card PDF** (`cdn.openai.com`, fetched
and read as a document — full text reproduced in this research pass) and
`developers.openai.com`'s **video-generation API guide**, **deprecations
table**, and **Sora 2 Prompting Guide** (all fetched directly, no 403). The
original 2024 **technical report itself could not be directly fetched**
(blocked, and not present on `web.archive.org` via this session's tooling);
its content below is reconstructed from **highly consistent, repeatedly
cross-corroborating search excerpts** that quote the report's own sentences
verbatim across many independent secondary sources (a pattern strong enough
to label VERIFIED for the specific quoted sentences, while the report's
*absence of further detail* — e.g. no disclosed parameter count, no
disclosed training compute — remains genuinely unverifiable either way).

---

## Executive Summary

1. **Sora is being shut down, in full, within days of this brief's writing.** Web/app: dead since 2026-04-26. API: dead 2026-09-24. No successor product. This is the single most important fact in the brief and changes the "should Narrata build this" answer to a firm no, unconditionally. **[VERIFIED]**
2. **Sora's original 2024 framing — "video generation models as world simulators" — is the most explicit world-model claim of any platform in this research programme**, and it is also the one OpenAI itself hedged hardest: the same report that claims "emerging simulation capabilities" also lists, in its own words, failures to model glass shattering, food-eating state changes, spatial left/right confusion, and "incoherencies that develop in long duration samples." **OpenAI's own disclosure is simultaneously the strongest world-model marketing claim and the most candid limitations section of the whole programme.** **[VERIFIED]**
3. **The "world simulator" claim rests on scale and data, not on a disclosed 3D or physics module.** No physics engine, no explicit 3D representation, no scene graph is claimed anywhere. The claimed mechanism is a patch-based, diffusion-transformer architecture trained at scale on variable-duration/resolution/aspect-ratio video, with simulation behavior framed as an **emergent** property — the same "emergence, not mechanism" answer independently found for Veo (Section: Continuity System, veo.md) and Kling. **[VERIFIED for the claim structure; "true world model" as a factual description is HYPOTHESIS]**
4. **Sora's training-time captioning technique is confirmed, and it is *not* the same thing as a mandatory inference-time prompt rewriter.** OpenAI explicitly reused the DALL·E 3 "re-captioning" technique — train a dedicated video captioner, apply it to every training video, fine-tune Sora on (video, dense-caption) pairs. This is a **training-data quality technique**. Unlike Veo (mandatory, non-disableable LLM prompt rewriter on every 3/3.1 call) and Kling (documented Prompt Enhancer), **no OpenAI source found in this session documents an automatic, inference-time expansion of the user's short prompt on every Sora call.** The ChatGPT-assisted prompt-engineering workflow that circulates widely is a **manual user habit**, not a pipeline stage. **[VERIFIED: the training-time recaptioning technique. VERIFIED BY ABSENCE (this session): no mandatory inference-time rewriter documented. This is a genuine architectural difference from Veo/Kling, not an oversight in this brief.]**
5. **Multi-shot generation is, for a fourth independent frontier platform, a prompt convention rather than an API structure.** Sora 2's own cookbook prompting guide instructs users to write timestamped shot blocks (`0.00–2.40 — "Arrival Drift"`) inside one prompt, exactly matching Veo's `[00:00-00:02]` convention and Seedance's `Shot 1:`/`Cut to` convention, independently arrived at by three different labs. **[VERIFIED]**
6. **Sora 2's Cameo feature is OpenAI's character-identity answer, and it is verification-gated rather than reference-gated.** A user records a short video+audio clip to *verify* their own likeness once; that verified cameo can then be invoked, with consent controls, across unlimited future generations. This is architecturally distinct from every other platform's reference-image mechanism — identity comes from a **one-time enrollment + consent record**, not from re-supplying reference images per generation. **[VERIFIED — system card + help center via search excerpt]**
7. **The separate `characters` API parameter is explicitly NOT for people.** It is scoped to non-human subjects (animals, mascots, objects), capped at **2 characters per video**, requires the character's name to appear verbatim in the prompt text (the ID alone does nothing), and **cannot be combined with Extensions**. Human identity consistency runs through Cameo; non-human entity consistency runs through a completely separate, more constrained mechanism. **[VERIFIED — developers.openai.com API guide]**
8. **Editing converged on the same mask-free, prompt-scoped pattern found at Runway.** Sora 2's `/v1/videos/{id}/edits` endpoint takes a video + a natural-language description of a single change ("change lighting to sunset," "same shot, switch to 85mm") with graded intensity (Strong/Mild/Subtle) and explicitly preserves camera motion/framing — the same "region-as-noun-phrase, not mask" move Runway made with Aleph 2.0, arrived at independently. **[VERIFIED]**
9. **Video continuation is forward-only in the current documented API, contradicting a widely circulated "bidirectional extend" claim.** OpenAI's own guide states Extensions add up to 20s per call, up to 6 extensions, 120s total ceiling — **and does not document backward extension**, a capability the *original* 2024 Sora explicitly had ("extending generated videos... backwards or forwards") and multiple 2026 third-party guides claim survives into Sora 2. This traces to the same aggregator-invented-capability pattern flagged repeatedly elsewhere in this research programme (Kling's "native 4K 60fps," MiniMax's "physics architecture" sentence) — **treated here as UNVERIFIED for Sora 2, not confirmed**. **[VERIFIED: forward extend, its limits, and the API's silence on backward. HYPOTHESIS: that backward extend survived from Sora 1 into the Sora 2 API — no first-party confirmation found]**
10. **Independent physics evaluation is harsh and directionally consistent with every other platform in this programme.** The Physics-IQ benchmark scored a Sora model at **8.7/100 on physical understanding** despite being rated the *most visually plausible* of the models tested — the same "looks real, isn't physically correct" gap Veo and others show. **Caveat carried over from the Veo brief and worth repeating: it is not confirmed from available excerpts whether the tested "Sora" was the 2024 model or Sora 2** — flagged as an open question rather than resolved. **[VERIFIED that the score and finding exist; WHICH Sora version was tested is NOT VERIFIED this session]**
11. **Story-level generation is, once again, generate-short-and-assemble, not single-pass long-form.** Sora's Storyboard tool (both the original Turbo-era feature and the Pro-tier Sora 2 feature reported by secondary sources) is a **timeline-assembly UI for stitching separately generated clips**, not a mechanism for a single model call to output a multi-scene narrative. A single Sora 2 generation caps at **20s via the API** (app reporting varies 15s free / 25s Pro — unreconciled, see Material Corrections). This is the fifth platform in this research programme to land on the same architecture. **[VERIFIED for the API ceiling; Storyboard-as-assembly is STRONG INFERENCE from consistent secondary description, not an OpenAI architecture diagram]**

---

## Publicly Known Architecture — Product Layer

```
                    ┌───────────────────────────────────────────────┐
                    │                     USERS                      │
                    │  ChatGPT Plus/Pro (2024 Turbo) · sora.com web  │
                    │  (2025 Sora 2, DEAD 2026-04-26) · Sora iOS app │
                    │  (social feed, DEAD 2026-04-26) · API devs     │
                    │  (Videos API, DYING 2026-09-24)                │
                    └───────────────────────┬───────────────────────┘
                                            │
   ┌────────────┬─────────────┬────────────┴────────────┬──────────────┐
   │  CHATGPT    │  SORA.COM   │      SORA iOS APP        │  VIDEOS API  │
   │  (Turbo,    │  (Sora 2,   │  (Sora 2, social feed,   │  (sora-2,    │
   │  2024)      │  DEAD)      │  Cameo enrollment, DEAD) │  sora-2-pro, │
   │  T2V, I2V   │  Remix ·    │  Cameo record/consent ·  │  DYING       │
   │  Storyboard │  Re-cut ·   │  comment/profile/DM      │  2026-09-24) │
   │  (frame-    │  Storyboard │  surfaces · in-app        │  create ·    │
   │  level      │  · Loop ·   │  reporting                │  edits ·     │
   │  timeline)  │  Blend      │                           │  extensions ·│
   │             │             │                           │  characters ·│
   │             │             │                           │  batch       │
   └────────────┴─────────────┴───────────────────────────┴──────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     │              SAFETY / MODERATION LAYER        │
                     │  input prompt + image classifiers ·           │
                     │  output frame/audio-transcript/scene-desc     │
                     │  classifiers · CSAM-specific stack · a        │
                     │  "safety-focused reasoning monitor" (custom-  │
                     │  trained multimodal reasoning model) ·        │
                     │  C2PA metadata + visible moving watermark     │
                     └──────────────────────┬──────────────────────┘
                                            │
        ┌───────────────────────────────────┴───────────────────────┐
        │                        MODEL LAYER                          │
        │  Sora (2024, "Turbo") — T2V/I2V/V2V-adjacent editing tools  │
        │  Sora 2 (2025-09-30) — video+audio, Cameo, Characters,      │
        │    Edits, Extensions                                        │
        │  Sora 2 Pro — 1080p, longer max duration tier               │
        │  Captioner model (training-time only, DALL·E-3-style        │
        │    re-captioning) — NOT a runtime component                 │
        └───────────────────────────────────────────────────────────┘
```
**[VERIFIED]** for every named surface, endpoint, and date. The "layers"
grouping is analytical framing, not an OpenAI-published diagram.

---

## Model Stack

| Model / component | Role | Publicly disclosed internals |
|---|---|---|
| **Sora (2024, "Turbo")** | Original T2V/I2V, up to ~20s/1080p, launch editing tools (Remix, Re-cut, Storyboard, Loop, Blend) | Diffusion transformer over **spacetime patches** of a compressed video latent; trained jointly on video+image at variable duration/resolution/aspect ratio. No parameter count, no compute figure, no VAE architecture detail disclosed. **[VERIFIED for the architecture description as stated in the technical report; internals beyond that NOT disclosed]** |
| **Sora 2** (`sora-2`, launched 2025-09-30) | Flagship: video **+ native synchronized audio** (dialogue, SFX, ambience, lip-sync), Cameo, Characters, Edits, Extensions | "state of the art video and audio generation model" per the system card; **no architecture section in the system card at all** — the system card is a safety document, not a technical report. Whether Sora 2 is architecturally continuous with the 2024 spacetime-patch design or a new architecture is **NOT DISCLOSED**. **[VERIFIED that no architecture disclosure exists in the Sora 2 System Card; the continuity assumption is HYPOTHESIS]** |
| **Sora 2 Pro** (`sora-2-pro`) | Higher-quality tier: 1080p export, "cinematic footage," required for the largest resolutions | Positioned purely as a quality/resolution tier over Sora 2, not a separate model family, per API docs. **[VERIFIED capability tiering; internal relationship to `sora-2` NOT disclosed]** |
| **Training-time video captioner** | Produces dense captions for every training video (DALL·E-3-style re-captioning), used to fine-tune the generator on richly-captioned (video, caption) pairs | **[VERIFIED — technical report, corroborated across many independent quoting sources]**. Not shipped as a product component; does not run at inference. |
| **Safety-focused reasoning monitor** | Custom-trained **multimodal reasoning model** that evaluates generated video output post-generation for policy violations | **[VERIFIED — Sora 2 System Card, read in full]**. This is the closest thing Sora has to a runtime "critic" — but it is a **safety** gate, not a quality or continuity gate. No prompt-adherence, identity-drift, or continuity scoring is described anywhere in the system card. |

**The architecture-disclosure gap between Sora 1 and Sora 2 is itself a finding.** The 2024 technical report is OpenAI's only real architecture document for this model line. The Sora 2 System Card (the only Sora 2 document read in full this session) contains **zero architecture content** — it is entirely about data filtering, moderation classifiers, red-teaming, and safety-evaluation metrics. This mirrors the "disclosure decay" pattern the Seedance brief recorded for ByteDance (rich report at v1, near-silence later) — but taken further: **OpenAI never published a Sora 2 technical report at all**, only a safety-focused system card. **[VERIFIED by absence — the Sora 2 System Card was read page-by-page this session and contains no architecture section]**

---

## Generation Pipeline

```mermaid
flowchart TD
    U[User] --> SURF{Entry surface}
    SURF -->|2024| CHATGPT[ChatGPT Plus/Pro — Sora Turbo]
    SURF -->|2025, DEAD 2026-04-26| WEB[sora.com]
    SURF -->|2025, DEAD 2026-04-26| APP[Sora iOS app + social feed]
    SURF -->|programmatic, DYING 2026-09-24| API[Videos API]

    CHATGPT --> PROMPT
    WEB --> PROMPT
    APP --> PROMPT
    API --> PROMPT

    PROMPT[Prompt assembly:<br/>text + optional input_reference image<br/>+ optional characters[] IDs<br/>+ optional Cameo reference]

    PROMPT --> SAFE1{Input moderation:<br/>text + image classifiers}
    SAFE1 -->|blocked| REJECT[Rejected]
    SAFE1 -->|pass| GEN

    GEN[SORA 2 — diffusion transformer<br/>over spacetime-patch latents<br/>video + native audio, jointly]

    GEN --> MODE{Conditioning shape}
    MODE -->|text only| T1[text-to-video]
    MODE -->|+ input_reference| T2[image-to-video]
    MODE -->|+ characters ref, non-human, max 2| T3[character-conditioned]
    MODE -->|+ Cameo, human, consent-gated| T4[likeness-conditioned]

    T1 --> SAFE2
    T2 --> SAFE2
    T3 --> SAFE2
    T4 --> SAFE2
    SAFE2{Output moderation:<br/>CSAM classifier +<br/>custom multimodal<br/>safety-reasoning monitor}
    SAFE2 -->|blocked| REJECT
    SAFE2 -->|pass| WATERMARK[C2PA metadata +<br/>visible moving watermark]

    WATERMARK --> OUT[MP4, download window<br/>1hr sync / 24hr batch]

    OUT --> HUM{Human review}
    HUM -->|targeted change| EDIT[/v1/videos/edits<br/>single natural-language change<br/>Strong/Mild/Subtle intensity/]
    HUM -->|continue forward| EXT[/v1/videos/extensions<br/>+20s per call, ≤6 calls, ≤120s total<br/>NO characters/refs on an extension/]
    HUM -->|assemble multi-scene| SB[Storyboard tool<br/>timeline assembly of separate clips]
    EDIT --> OUT
    EXT --> OUT
    SB --> DEL[Delivery]
    WATERMARK --> DEL
```

**Evidence note.** Every node is VERIFIED as a documented Sora 2 capability or documented pipeline stage. The **output-safety-monitor** node is the one genuinely disclosed automated evaluator in Sora's entire pipeline, and it evaluates **policy compliance, not quality or continuity** — consistent with the "no runtime quality/continuity critic anywhere in the industry" finding this research programme has now confirmed across every platform examined (Runway, Kling, Veo, Hailuo/MiniMax, Higgsfield, Seedance, Wan, and now Sora — **eight for eight**). **[VERIFIED for the Sora-specific claim; the eight-for-eight framing is this research programme's cumulative finding]**

---

## The Eight User-Specified Lenses

### 1. World Modeling

OpenAI's original framing, quoted consistently across many independent sources citing the technical report: **"video generation models as world simulators."** The specific claimed capabilities:

- **3D consistency**: "Sora can generate videos with dynamic camera motion... as the camera moves and rotates, people and scene elements move consistently through three-dimensional space." **No explicit 3D representation is claimed** — this is presented as behavior the model exhibits, not a module it contains.
- **Long-range coherence and object permanence**: the report claims Sora "can sometimes model... [that] an object can leave the frame and come back in the same place" (i.e., true occlusion/re-entry permanence in the ideal case) and cites cases of the same character reappearing consistently across a clip even after leaving frame.
- **Interacting with the world**: a painter "can leave new strokes... that persist over time," and eating a burger "can leave bite marks."
- **Simulating digital worlds**: the report's most cited example — Sora "can simultaneously control the player in Minecraft with a basic policy while also rendering the world and its dynamics in high fidelity," elicited **zero-shot**, purely by prompting with the word "Minecraft."

**All of the above: [VERIFIED — technical report, quoted consistently across many independent search sources; not directly re-fetched from openai.com this session due to the 403 block, but corroboration is strong enough to label VERIFIED for these specific claimed sentences]**

**What OpenAI's own limitations section says, in the same report** (this is the part frequently dropped by secondary coverage that only repeats the "world simulator" headline):
- Does **not accurately model the physics** of many basic interactions — **glass shattering** is OpenAI's own named example.
- **Object state changes are often wrong** — eating food does not reliably yield correct object-state changes (OpenAI's own cookie-bite example: a bite may not leave a bite mark).
- **Spatial confusion** — "may confuse spatial details of a prompt, for example, mixing up left and right."
- **Long-duration incoherence** — "incoherencies that develop in long duration samples."
- **Spontaneous appearance/disappearance** of objects and characters, unprompted.

**[VERIFIED — same source, same consistency-of-quotation standard]**

**Independent evaluation, post-launch.** The Physics-IQ benchmark (INSAIT + Google DeepMind, cross-model) scored a Sora model at **8.7/100 on physical understanding** while separately rating it **the most visually plausible** of the models tested — the same "looks real, is not physically correct" finding recorded for Veo in this research programme, and now the sharpest numeric instance of it. **Caveat, carried over honestly from the Veo brief's own caveat about this same benchmark family:** it was **not confirmed** from available excerpts which Sora model version (2024 original vs. Sora 2) the 8.7 score refers to — the Physics-IQ paper predates Sora 2's September 2025 launch by enough margin that the original model is the more likely candidate, but this is not resolved. **[Score and finding VERIFIED as reported; model-version attribution NOT VERIFIED]**

**A more recent independent finding**, specific to physics-benchmark methodology rather than to Sora: a June 2026 audit ("Physics-IQ Verified") found that **57.6% of the original benchmark's own video samples were contaminated by non-physics artifacts** (lighting flicker, camera shake, compression noise) and **34.8% of its prompts were flawed** — a reminder that even the *evaluation* side of "does AI video obey physics" is immature, and single benchmark numbers (Sora's 8.7 included) should be read with real skepticism about measurement validity, not just model capability. **[VERIFIED — reported directly, this is a finding about the benchmark, not about Sora]**

**Sora 2's own claimed improvement, narrowly and honestly stated by OpenAI itself (system card, read in full):** "if a basketball player misses a shot, [Sora 1] the ball may spontaneously teleport to the hoop. In Sora 2, if a basketball player misses a shot, it will rebound off the backboard." This is OpenAI's own example of the *specific class* of improvement — failure-scenario handling — rather than a general physics-accuracy claim. The system card's own phrasing is careful: **"better about obeying the laws of physics compared to prior systems, though still imperfect."** **[VERIFIED — quoted from search excerpts of the Sora 2 launch materials, consistent phrasing across sources]**

**Narrata read.** This is the clearest first-party confirmation in this whole research programme that "world simulator" claims are about **qualitative plausibility and failure-mode handling**, not quantitative physical accuracy — precisely the same conclusion the Veo brief reached independently from DeepMind's own measured numbers. A cost-aware generation platform building on any of these vendors should never assume dynamics (fall speed, collision response, rigid-vs-soft-body behavior) are physically correct; treat "physics" marketing language across the entire industry as a claim about **visual plausibility**, not simulation fidelity.

### 2. Temporal Coherence

**Disclosed mechanism**: spacetime patches processed by a diffusion transformer over a compressed latent, trained jointly across variable durations — this is presented as the *entire* mechanism. **No separate temporal-consistency loss, optical-flow objective, or anti-flicker module is disclosed anywhere** — the same "no disclosed inference-time temporal-stability mechanism" finding recorded for Runway, Kling, and Veo, now extended to a fourth platform. **[VERIFIED by absence]**

**Duration-vs-degradation**: OpenAI's own limitations language ("incoherencies that develop in long duration samples") is a direct first-party admission that quality degrades with length — the clearest, most explicit version of a pattern every platform in this programme exhibits but few state outright. **[VERIFIED]**

**Architectural contrast with autoregressive-frame approaches**: Sora's disclosed approach denoises **spacetime patches jointly** across the whole clip (a block/window-level diffusion process), not frame-by-frame autoregressively. This is architecturally different from the frame-by-frame causal/autoregressive designs found elsewhere in this research programme (Runway's GWM-1/Worlds 2 branch is explicitly autoregressive and causal; per the Runway brief). Sora's narrative-video line has **no disclosed autoregressive variant** — that pattern (bidirectional-to-causal post-training for a real-time/world-model branch) exists at Runway (GWM) and, per the system card's own framing, may exist informally at OpenAI's post-Sora "world simulation research tied to robotics," but nothing there is architecturally documented. **[VERIFIED for Sora's block-diffusion description; the Runway comparison is this brief's own analysis; the OpenAI robotics-research claim is STRONG INFERENCE from secondary reporting on the shutdown, not an architecture disclosure]**

### 3. Spatial Consistency

Camera-movement handling is claimed as an emergent 3D-consistency behavior (see Lens 1) rather than a parameterized camera-control system. **There is no dedicated camera parameter anywhere in the Sora API** — camera is prompt vocabulary only, the same pattern found at Veo and post-2026-07-30 Runway. Sora 2's own cookbook prompting guide gives worked camera-vocabulary examples ("wide establishing shot at eye level," "tracking left-to-right," "aerial wide shot," "handheld ENG camera") rather than a structured parameter — a fifth confirmation of the "camera is a controlled vocabulary, not a widget" cross-platform pattern (after Runway, Veo, Higgsfield's compiled `#`-tags, and Seedance's caption-baked vocabulary). **[VERIFIED — cookbook, fetched directly]**

The technical report's reliability claim ("as the camera moves... people and scene elements move consistently through three-dimensional space") is qualitative and unquantified — unlike Veo, where DeepMind published per-scenario success rates (Section: Physics, veo.md), **no comparable quantified reliability figure for spatial consistency was found for Sora anywhere in this session's research.** **[VERIFIED by absence]**

### 4. Scene Understanding

No scene-decomposition module is disclosed. What OpenAI discloses is distributed across the same three mechanisms found at Veo, independently:

1. **Training-time dense captioning** (the DALL·E-3-style recaptioning technique) — the model's notion of "what a scene contains" is inherited from a captioner model's descriptions of training video, not from human shot annotation. **[VERIFIED]**
2. **A documented prompt-structuring convention pushed to the user** — the cookbook prompting guide's explicit advice to keep "one camera setup, one subject action, and one lighting recipe" per shot block, and to write dialogue in a "dedicated block below visual description" with consistent speaker labeling for multi-character scenes. **[VERIFIED]**
3. **Behavioral evidence of compositional understanding** in the technical report's demonstrated prompts (multiple named subjects, described interactions, described environments) — but, notably, **the report itself and the Sora 2 cookbook both flag compound-scene fragility**: "when introducing characters, expect some unpredictability... small changes in phrasing can alter identity, pose, or the focus of the scene itself" (Sora 2 cookbook, quoted directly) and the original report's own "confuse spatial details" limitation. **[VERIFIED]**

**Narrata read — direct relevance to the checklist's stated reason for prioritizing this brief.** OpenAI's public framing treats "what a scene is" as something the model infers from richly captioned training data plus prompt discipline, **not** as something decomposed by an explicit external planner before generation. Narrata's `SHOT_PLANNING`/`SCRIPT_DRAFTING` stages already do the opposite — an explicit LLM decomposition step *before* any generation call — which several other briefs (Runway's agent planner, Higgsfield's AI Director) have already validated as the frontier's actual answer to compound-scene reliability. Sora is the platform in this programme that leans hardest on **implicit, data-driven scene understanding with no explicit planner stage at all**, and its own documentation's fragility warnings ("small changes in phrasing can alter identity, pose...") are a first-party argument *for* Narrata's explicit-planner approach rather than against it.

### 5. Prompt Interpretation

**No mandatory inference-time prompt-rewriting/expansion layer was found for Sora**, in contrast to Veo (mandatory, non-disableable LLM rewriter on Veo 3/3.1) and Kling (documented Prompt Enhancer). This was searched specifically and is treated as a genuine architectural difference, not a research gap: the DALL·E-3-style technique OpenAI *does* document is **training-data recaptioning** (train a captioner, apply it to training videos, fine-tune on the richer captions) — a technique that changes what the *model has learned*, not something that runs on the *user's actual prompt* at inference time. The widely-repeated "ChatGPT expands your Sora prompt" workflow is a **documented user habit and cookbook recommendation**, not an automatic pipeline stage the API performs for you. **[VERIFIED BY ABSENCE — searched specifically; no first-party mandatory-rewriter documentation found for Sora, contra Veo/Kling where such documentation exists]**

Compositionality reliability is addressed only through **prompting discipline** in OpenAI's own guide: "one clear camera move and one clear subject action" per shot, explicit speaker labeling, named/stable color-palette anchors ("three to five colors"), and instructions to "strip it back: freeze the camera, simplify the action, clear the background" when a shot misfires. This is advisory documentation, not a technical constraint enforced by the system. **[VERIFIED]**

### 6. Story-Level Generation

Sora has **no single-call mechanism for generating a multi-scene narrative end-to-end.** The two available paths are:

- **In-prompt multi-shot via timestamp convention** — the Sora 2 cookbook's own worked example uses `0.00–2.40 — "Arrival Drift"`-style beat labels inside a single prompt, generating cuts within one API call's duration ceiling (≤20s via the API). This is the **fourth** independent frontier sighting of "multi-shot as a prompt convention, not an API structure" in this research programme (after Veo's `[00:00-00:02]`, Seedance's `Shot 1:`/`Cut to`, and Kling's per-shot-prompts-and-durations design). **[VERIFIED]**
- **Storyboard as external assembly** — both the original Turbo-era and (per consistent secondary reporting on Sora 2 Pro) current Storyboard tools are timeline UIs for **stitching separately generated clips**, i.e. generate-short-then-assemble, the same architecture found at every other platform in this programme. **[Storyboard's existence and general framing: VERIFIED for the 2024 feature via the original launch coverage; its persistence into Sora 2 Pro is STRONG INFERENCE from consistent but not first-party-confirmed secondary reporting]**

**Duration ceiling, and an unreconciled conflict worth flagging plainly.** The API guide (fetched directly) states **both `sora-2` and `sora-2-pro` support 16- and 20-second generations.** Secondary reporting on the *app* states **15s for all users, 25s for Pro subscribers.** These do not obviously reconcile (16/20 vs. 15/25), and this session could not resolve whether the discrepancy reflects an app-vs-API difference (plausible — same pattern as Veo's Gemini-API-vs-Vertex duration mismatch, flagged in the Veo brief), a version-over-time change, or a reporting error. **Do not treat either figure as authoritative without re-verification** — moot in practice given the imminent shutdown, but recorded as a method finding: **a fifth instance in this programme of app-tier and API-tier duration figures not matching cleanly** (after Veo's Vertex/Gemini-API mismatch). **[VERIFIED that both figures appear in credible sources; the reconciliation is NOT VERIFIED]**

**Narrata comparison.** This is the same "generate-short + assemble" answer Narrata's own per-shot-pair-generate-then-assemble architecture already implements, and the same answer found at Runway, Veo, Kling, Hailuo/MiniMax, Higgsfield, Seedance, and Wan — **eight for eight platforms researched in this programme now confirm no frontier vendor generates a genuinely long multi-scene narrative in one model call.** Narrata's architecture is validated as the industry-standard shape, not a limitation to apologize for.

### 7. Video Continuation

**Forward extension**: `/v1/videos/extensions` — supply a source video + a prompt describing the continuation, up to **20s added per call**, up to **6 extensions per video**, **120s total ceiling**. Uses the **full source clip as context** (per third-party developer-guide description of the mechanism; not an OpenAI architecture diagram). Extensions **cannot carry `characters` or image references** — a hard capability-exclusion rule of the same class the Hailuo/MiniMax brief found (first/last-frame ⊥ references) and the Kling brief found (`camera_control` ⊥ `image_tail`). **[VERIFIED — developers.openai.com, fetched directly]**

**Backward extension — genuinely unresolved, flagged rather than asserted either way.** The **original 2024 Sora** explicitly had backward extension ("Sora is also capable of extending videos, either forward or backward in time" — a frequently and consistently quoted sentence from the original announcement materials). Multiple 2026 third-party developer guides claim this survives into the Sora 2 API (`/v1/videos/extensions` supporting "forward (continue) and backward (go earlier) directions... great for flashbacks"). **But the first-party `developers.openai.com` API guide, fetched and read directly this session, describes only forward continuation and does not mention a backward direction, a `direction` parameter, or any flashback-style capability.** Given this research programme's repeatedly-confirmed pattern of aggregator sites inventing precise-sounding capabilities that do not survive contact with primary documentation (Kling's "native 4K 60fps," MiniMax's "physics architecture" sentence, ByteDance's "DB-DiT phoneme-level lip sync" sentence), **this brief treats "Sora 2 supports backward extend via the API" as UNVERIFIED, not confirmed** — while explicitly noting the *original* Sora's backward-extend capability at launch is itself VERIFIED. Whether OpenAI silently dropped it, moved it to a parameter not covered by the fetched guide's text, or the aggregator claim is simply wrong could not be resolved this session — and given the API's imminent shutdown, further verification has no practical value now. **[VERIFIED: original Sora had backward extend; Sora 2 API's forward extend and its limits. UNVERIFIED/CONTESTED: whether backward extend exists in the Sora 2 API.]**

**Video blending/interpolation** — the original Sora's launch materials described "Connect Videos"/Blend: taking two existing videos and generating a smooth interpolation between them, functionally similar to first-last-frame anchoring but at the *clip* level rather than the *frame* level (whole videos as the two anchors, not two still images). **No equivalent parameter was found in the Sora 2 API's documented surface** (`edits` and `extensions` are the only post-generation-transform endpoints documented) — **treated as a launch-demo/app-only capability that did not carry into the documented Sora 2 API**, distinct from the backward-extend question above where the evidence is genuinely contested. **[VERIFIED: the original capability existed. VERIFIED BY ABSENCE: no Sora 2 API equivalent documented]**

### 8. Editing / Transformation

The original Sora launch demonstrated five named tools: **Remix** (swap/remove elements in an existing video while preserving the rest), **Re-cut** (identify best frames, extend scenes), **Storyboard** (frame-by-frame timeline direction), **Loop** (trim into a perfect repeat), and **Blend/Connect Video** (merge two videos, see Lens 7). **[VERIFIED — consistent across independent launch-coverage sources describing the Turbo-era feature set]**

**What survives into the documented Sora 2 API, specifically:**
- **Remix → deprecated, explicitly, in favor of `edits`.** The current API guide states in its own words: *"Video generations could previously be edited using the remix endpoint, which is being deprecated. Use the edits endpoint for new integrations."* **[VERIFIED — fetched directly]**
- **`/v1/videos/{id}/edits`** is the living successor: natural-language, single-change edits ("add fog," "change lighting to sunset," "remove the background objects," "same shot, switch to 85mm"), with **graded intensity (Strong / Mild / Subtle)**, explicitly preserving camera motion and framing. **No mask or region parameter** — region is resolved from the noun phrase in the prompt, the same architectural move Runway made with Aleph 2.0 (mask → prompt), arrived at independently by a second frontier lab. **[VERIFIED]**
- **Storyboard**: reported to persist as a Pro-tier feature in Sora 2 (secondary sourcing, not confirmed first-party this session — see Lens 6).
- **Re-cut, Loop**: **no equivalent found documented in the Sora 2 API surface.** Likely app-only features that, per the system card's own framing ("not supporting video-to-video generation at launch"), may not have shipped at all in Sora 2's initial release regardless of API status. **[VERIFIED BY ABSENCE in the documented API; the system card's "not supporting video-to-video generation at launch" statement directly corroborates that several Turbo-era editing tools were deliberately held back from Sora 2's first release]**

**The system card's own words are the cleanest evidence for "what was launch-demo-only vs. what survived":** *"Safeguards for our initial launch include: not supporting video-to-video generation at launch, not supporting text-to-video generation of public figures, and blocking generations that include real people (other than users who consent through Sora's likeness-control cameo feature)."* This is a **safety-driven feature holdback**, not a technical limitation — v2v editing (Remix's successor, `edits`) was added back later via the API, once the safety stack matured. **[VERIFIED — read directly from the system card PDF]**

**Narrata read on the whole editing story.** Two frontier labs (Runway, OpenAI) independently converged on the same shape: **prompt-scoped, mask-free, single-change edits with graded intensity, applied to an already-generated clip.** This is now a **two-for-two confirmed pattern**, strengthening the recommendation (first made in the Runway brief) that Narrata's take-history "replace the whole shot" regeneration model should eventually grow a cheaper, prompt-scoped "change only X in this shot" sibling rather than always full-regenerating. Route to `video-architect`.

---

## Continuity System — Summary Across Layers

```
 LAYER 1 — CAMEO (human likeness)                         ★ Sora's distinctive contribution
   One-time verified enrollment (video + audio capture, identity-matched
   transcript check) → durable, consent-scoped, revocable identity record →
   invoked across UNLIMITED future generations without re-supplying
   reference images per call.
   ⇒ Identity persistence is a CONSENT-AND-VERIFICATION RECORD, not a
     per-call reference-image budget. No other platform in this research
     programme ties identity to a verification step rather than to
     reference imagery.
   [VERIFIED — system card + help center via search excerpt]

 LAYER 2 — CHARACTERS (non-human subjects only)
   Upload reference MP4 → character ID → must ALSO be named verbatim in the
   prompt text (ID alone insufficient) → max 2 per video → cannot combine
   with Extensions → human likeness uploads blocked by default.
   ⇒ a SEPARATE, more constrained mechanism from Cameo, and the ID+name
     double-binding requirement is a notable design choice absent from
     other platforms' @-mention conventions (Kling/Higgsfield's @name
     conventions don't separately require the name in prose AND an ID).
   [VERIFIED]

 LAYER 3 — IN-PROMPT SHOT/PALETTE ANCHORING (single generation only)
   Cookbook guidance: repeat descriptive phrasing across shot blocks, name
   3-5 stable palette colors, keep "lighting logic consistent" in prose.
   ⇒ continuity-by-repetition-of-prose within ONE generation's context
     window, not a structural mechanism.
   [VERIFIED]

 LAYER 4 — EXTENSIONS (sequential continuation)
   Forward-only (per the fetched API guide), full source clip as context,
   accumulating drift risk with NO stated anti-drift mechanism — same
   unaddressed-drift pattern found at Veo's extend and Runway's
   (brokered) extend.
   [VERIFIED for the capability and its limits; drift handling NOT
    disclosed]

 LAYER 5 — TEMPORAL / MOTION CONSISTENCY within a clip      ★ weakest layer,
                                                               as everywhere else
   NO disclosed inference-time mechanism. What IS disclosed is OpenAI's own
   admission that "incoherencies develop in long duration samples" — an
   honest first-party statement that this is unsolved, not a mechanism.
   [VERIFIED by absence — now confirmed at EIGHT of eight platforms
    researched in this programme]
```

**Cross-cutting confirmation, now at maximum sample size for this research programme.** *No runtime quality or continuity critic exists at any platform researched so far — eight for eight* (Runway, Kling, Veo, Hailuo/MiniMax, Higgsfield, Seedance, Wan, Sora). Sora's only disclosed runtime evaluator (the "safety-focused reasoning monitor") checks **policy compliance**, not correctness or continuity, mirroring exactly the pattern the Higgsfield brief found for its Virality Predictor (scores a different axis entirely, not quality/continuity). **Narrata's missing model-based video/audio critic (the tier-2 gap recorded in `RESEARCH_CHECKLIST.md` category 11) is now a confirmed differentiation surface across every major platform studied in this programme, not catch-up work.**

---

## What Narrata Should Adopt (evidence-based, given the shutdown)

Given the imminent shutdown, nothing here is "integrate Sora." These are **architectural patterns**, independently corroborating conclusions this research programme has already reached from other platforms:

- **Prompt-scoped, mask-free, graded-intensity editing** (`edits` endpoint) — second independent frontier confirmation of the pattern the Runway brief already recommended to `video-architect`.
- **Timestamp-based in-prompt shot structuring** — fourth independent confirmation (after Veo, Seedance, Kling) that this is the cheapest, most portable multi-shot mechanism across providers; strengthens the existing recommendation to `ai-architect` to give `MOTION_PROMPT_DRAFTING`/`SHOT_PLANNING` a constrained, timestamp-capable output format usable across whichever provider is live.
- **Verification-gated identity as a *conceptual* alternative worth knowing about, not building**: Cameo's "verify once, use consent-scoped identity across unlimited generations" model is architecturally interesting for any product with a real-person-cameo feature, but Narrata's actual character-continuity problem (fictional/illustrated characters, not user selfies) is better served by its existing `Character`/`referenceImages`/`isLocked` model — flag the pattern to `ai-architect` as *awareness*, not as a design to copy.
- **The "no mandatory prompt rewriter" data point** matters for provider-agnostic router design: if Narrata ever adds a Sora-successor-class provider, do not assume every provider silently rewrites prompts server-side the way Veo and Kling do — this must be a per-provider capability flag, not an assumption baked into prompt-length or content planning.

## What Narrata Should Avoid

- **Any integration work targeting the Sora API.** It will not exist by the time such work could ship. This is not a "wait and see" — the shutdown date and absence of a replacement are both VERIFIED from OpenAI's own deprecations table.
- **Treating "world simulator" language, from any vendor, as evidence of physically accurate dynamics.** OpenAI's own limitations section is the most explicit first-party admission in this entire research programme that this marketing framing does not mean what it sounds like.
- **Assuming Sora 2's app-reported duration figures (15s/25s) are load-bearing for anything** — they conflict with the API's own documented 16s/20s figures and the product is being discontinued regardless.

---

## What Could Not Be Verified

- Sora 2's actual architecture relationship to the original 2024 spacetime-patch design (continuous evolution vs. new architecture) — the Sora 2 System Card contains no architecture section.
- Parameter count, training compute, VAE/encoder architecture, or any numerical scaling detail for either Sora or Sora 2 — none disclosed anywhere found.
- Whether backward video extension exists in the documented Sora 2 API (contested — see Lens 7).
- Whether Storyboard, as a tool, persisted into Sora 2 as a first-party-confirmed feature (secondary reporting only).
- Which Sora model version (1 vs. 2) the Physics-IQ 8.7/100 score refers to.
- The precise mechanism by which Cameo achieves likeness fidelity (no architecture disclosed — "hard constraint in the latent diffusion process" is a third-party aggregator sentence, explicitly **not** used as a VERIFIED claim in this brief).
- Whether OpenAI's redirected video-research effort (reported as "world simulation tied to robotics") has any published output as of this analysis date — not found this session.

---

## Sources

**Primary (OpenAI, read directly or via full-document fetch):**
- Sora 2 System Card PDF (`cdn.openai.com/pdf/.../sora_2_system_card.pdf`) — **fetched and read in full, page by page, this session.**
- `developers.openai.com/api/docs/guides/video-generation` — fetched directly (twice, different extraction passes).
- `developers.openai.com/api/docs/deprecations` — fetched directly; exact shutdown table reproduced above.
- `developers.openai.com/cookbook/examples/sora/sora2_prompting_guide` — fetched directly.

**Primary (OpenAI, accessed via search-indexed excerpts due to 403 on direct fetch — method matches the Runway/Veo briefs' handling of similarly blocked first-party pages):**
- `openai.com/index/video-generation-models-as-world-simulators/` (the original 2024 technical report)
- `openai.com/index/sora-2/` ("Sora 2 is here")
- `help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation`
- `help.openai.com` — cameo-creation guidance article

**Reputable reporting (business/context, largely routed to `market-intelligence`, not reasoned about architecturally here):**
- TechCrunch — "OpenAI's Sora was the creepiest app on your phone — now it's shutting down" (2026-03-24)
- Axios — "OpenAI to discontinue Sora video app" (2026-03-24)
- the-decoder.com — "OpenAI sets two-stage Sora shutdown with app closing April 2026 and API following in September"
- WSJ-cited cost/revenue figures (~$1M/day cost vs. $2.1M lifetime revenue), relayed via the above

**Independent evaluation:**
- Physics-IQ (INSAIT + Google DeepMind) — cross-model physics benchmark including a Sora model at 8.7/100
- "Physics-IQ Verified" (June 2026 audit) — benchmark-methodology critique (57.6% contaminated samples, 34.8% flawed prompts)

**Secondary — explicitly flagged as NOT used for any VERIFIED claim:**
- Aggregator/guide sites claiming Sora 2 API backward-extend, "hard constraint... latent diffusion process" cameo mechanism, and precise Storyboard-in-Sora-2 mechanics beyond what consistent secondary reporting supports.

---

## Routed to Other Agents

- **`market-intelligence`** — (1) the **shutdown itself and its stated cause** (~$1M/day cost vs. $2.1M lifetime revenue, reported download collapse, copyright pressure, IPO-adjacent profitability focus) is a first-party-adjacent data point about the actual unit economics of running a frontier consumer video-generation product at scale — useful context for any competitive narrative about how expensive this category is to operate, independent of any single vendor's API pricing; (2) OpenAI's reported redirection of its video-research effort toward **robotics/world-simulation** rather than a narrative-video successor is the *third* frontier lab (after Google/Gemini Robotics and Runway/GWM) to structurally separate "narrative video product" from "world-model research," which may be a durable industry pattern worth tracking for positioning purposes.
- **`technical-architect`** — **awareness only, no action required.** Confirms nothing to build here: Sora was API-only (no self-hostable weights ever existed), and it is being withdrawn regardless. The only transferable infrastructure-adjacent fact is that even a well-capitalized, technically excellent frontier lab found the compute cost of hosted video inference at consumer scale (~$1M/day, per reporting) unsustainable against realized revenue — a data point for any future build-vs-API-vs-self-host cost modeling, not an action.
- **`ai-architect`** — (1) confirms (do not build) a mandatory inference-time prompt-rewriter is *not* universal across providers — Sora is the negative case against Veo/Kling's positive case, so any future provider-adapter design must treat "does this provider auto-rewrite my prompt" as a per-provider capability flag; (2) the timestamp-based shot-block convention (fourth independent confirmation) further strengthens the existing recommendation that `MOTION_PROMPT_DRAFTING`/`SHOT_PLANNING` output should be structured with explicit per-beat timing, since this is now the most cross-provider-portable multi-shot mechanism found in the whole research programme; (3) OpenAI's own documented compositional fragility ("small changes in phrasing can alter identity, pose, or the focus of the scene itself") is first-party evidence *for* keeping Narrata's explicit LLM decomposition stages (`SHOT_PLANNING`/`SCRIPT_DRAFTING`) rather than leaning on a single model's implicit scene understanding, which is the opposite bet Sora's own architecture makes.
- **`video-architect`** — (1) second independent frontier confirmation (after Runway's Aleph 2.0) that prompt-scoped, mask-free, single-change editing with graded intensity is the industry's converged answer to "edit an existing generation" — strengthens the existing recommendation to eventually add a cheaper, prompt-scoped correction path alongside full-take regeneration; (2) the Extensions-vs-references exclusion rule (`characters`/image-refs cannot combine with an extension call) is another data point for the capability-exclusion-matrix pattern already recommended from the Hailuo/MiniMax and Kling briefs — a provider-agnostic adapter needs exclusion rules, not just a parameter map; (3) eighth-of-eight confirmation that no frontier platform runs a quality/continuity critic at generation time — Narrata's missing tier-2 (model-based) video critic remains the single highest-leverage, most differentiated gap identified across this entire research programme.
- **`company-vision`** — the Sora shutdown is a useful cautionary data point for any future discussion of Narrata's own long-term generation-cost exposure: a frontier lab with effectively unlimited capital killed a product doing real user-facing volume specifically because inference cost outpaced realized revenue. Nothing here changes the recorded `MASTER_AI` sequencing decision, but it is a concrete real-world instance of the exact risk that decision is designed to avoid getting ahead of.
- **`monetization-strategist`** — the reported ~$1M/day cost figure, if roughly accurate, is a useful order-of-magnitude anchor for what "video generation at real consumer volume" costs a well-capitalized frontier lab even with in-house models (i.e., presumably *below* what an API-consumer like Narrata pays per generation) — worth keeping in mind as a sanity check when modeling unit economics, though it is reported-secondhand and should not be treated as precise.
- **`growth-strategist`** — Sora's social-app layer (comments, profiles, messaging, a public feed, Cameo-based friend-swapping) was a genuine distribution/virality bet distinct from its generation technology, and its shutdown alongside — not because of — the underlying model's capability is a useful cautionary example that a social/distribution layer bolted onto a generation product does not by itself solve unit economics.
