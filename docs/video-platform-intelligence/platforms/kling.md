# Kling — Architecture Brief

**Analysis date: 2026-09-13.** Kling is Kuaishou's video-generation line; its flagship as of this date is the **Kling 3.0 series (released 2026-02-05)**, built on the **Kling O1 / "Omni One"** unified model introduced 2025-12-01. Every non-trivial architectural claim is labeled **VERIFIED** (Kuaishou IR/PR Newswire releases, the Kling-Omni technical report on arXiv, official kling.ai product/API documentation), **STRONG INFERENCE** (implied by observable API surface, published technique, or official capability claims), or **HYPOTHESIS** (plausible, unconfirmed) — see `.claude/agents/video-platform-intelligence.md`'s research principle.

**Language caveat up front:** Kuaishou is a Chinese company and much of its primary material is Chinese-language. The English arXiv technical report, Kuaishou's English IR/PR Newswire releases, and the English kling.ai blog/quickstart guides were readable in full. `kling.ai/document-api/*` could **not** be read directly — the API reference is a client-rendered SPA and returned only its page shell on every fetch. API parameter details below therefore come from third-party mirrors of Kling's official spec (fal.ai, AI/ML API) and are labeled accordingly. Chinese-language Kuaishou tech-blog material on WeChat/Zhihu was not accessible this session and is flagged as an open research gap.

**Revision note (2026-09-13, same-day follow-up pass):** two soft spots were re-researched — *motion/temporal consistency within a clip* (new Continuity System Layer 5) and *long-form generation* (Executive Summary points 11–12, Model Stack). The long-form finding is a **material correction**: the earlier reading that ≤15s was Kling's real ceiling and that "2 minutes" was a legacy-2024-only figure was wrong. Every load-bearing claim added in this pass comes from a primary source (arXiv 2512.13313, arXiv 2512.16776, official kling.ai quickstart guides, Kuaishou IR) — **no Chinese-language material was required, and no secondary source was promoted to VERIFIED.** Secondary claims encountered during this pass (notably widespread assertions that Kling 3.0 uses "3D attention" and is "physics-first") are recorded as HYPOTHESIS and explicitly not used as evidence.

---

## Executive Summary

1. **Kling's 2026 architecture is the philosophical opposite of Runway's.** Runway bet on *many specialist models plus a router*; Kling bet on *collapsing generation, editing, reasoning and reference-conditioning into one model*. Kuaishou's official framing for O1 is that it "dismantles traditionally fragmented video generation, editing, and comprehension features." **[VERIFIED — Kuaishou IR / PR Newswire, 2025-12-01]**
2. **The organizing concept is MVL — "Multi-modal Vision Language."** Officially: MVL "constructs a unified input representation by combining natural language as a semantic skeleton with multi-modal descriptions." In practice the prompt is not a string; it is a *structured composite* of text, tagged reference images, reference videos, and named subjects, all encoded into one representation. The Kling 3.0 lineup is officially described as embodying this framework. **[VERIFIED — Kling-Omni technical report + Kuaishou IR]**
3. **Unlike Runway, Kling published a real technical report.** *Kling-Omni Technical Report*, arXiv 2512.16776, submitted 2025-12-18, credited to "The Kling Team" (67 authors, including Kuaishou co-founder Kun Gai). This is by far the best public window into any major Chinese video model's production stack and makes Kling more architecturally legible than Runway, Veo or Sora. **[VERIFIED]**
4. **The disclosed stack is three components, not one model:** a **Prompt Enhancer** (an MLLM, SFT'd then RL'd), the **Omni-Generator** (a diffusion transformer operating on visual+text tokens in a shared embedding space), and a **cascaded multimodal Super-Resolution module** conditioned on both low-res latents *and* the MVL signal. **[VERIFIED — technical report]**
5. **Post-training is where the effort went.** Disclosed pipeline: pre-train → SFT (curriculum "continue-training" + "quality-tuning") → **RL via DPO** (explicitly chosen because it "bypasses the computationally expensive trajectory sampling") → **two-stage distillation** (trajectory-matching then distribution-matching) cutting inference from **150 NFE to 10 NFE**. That 15× step reduction is the single most load-bearing efficiency disclosure in the report. **[VERIFIED]**
6. **Continuity is productized as a persistent, user-owned asset library, not just reference images.** The Kling **Element Library** stores reusable Elements (character/animal/prop/costume/scene/effect/other), each built from 1 main + up to 3 additional multi-angle images, or from a 3–8s video clip with **optional bound voice**. Elements are invoked in the prompt by `@name`. This is architecturally closest to Narrata's `Character`/`Location` records with `referenceImages`. **[VERIFIED — official kling.ai Element Library guide]**
7. **Multi-shot is inside the model, not a stitching layer.** Kuaishou states Video 3.0 "understands multi-scene, multi-shot instructions, dynamically adjusting camera angles and shots," with per-shot prompts and durations inside a single ≤15s generation. Continuity across cuts is therefore a property of one context window, not of frame-chaining. The 15s figure is confirmed in Kuaishou's own words — Video 3.0 "supports longer video generation up to 15 seconds in length" — but it caps *one generation*, not a finished Kling video; see point 11. **[VERIFIED for the capability and the limit; "single generation not stitching" is STRONG INFERENCE]**
8. **Native audio arrived with 3.0, in five languages with accents.** Officially: speech in English, Chinese, Japanese, Korean, Spanish, plus American/British/Indian accents, with lip movement generated jointly rather than dubbed on. Notably, **the Kling-Omni technical report contains no audio section at all** — audio appears to be a 3.0-era addition post-dating the December report. **[VERIFIED for capability; the report's silence is VERIFIED by absence]**
9. **The widely-repeated "native 4K 60fps video" claim does not survive contact with official sources.** Kuaishou's own 3.0 press release attributes **2K/4K to Image 3.0 and Image 3.0 Omni** — the *image* models — and says nothing about video 4K or 60fps. The official kling.ai Video 3.0 Omni guide states 720p standard / 1080p on paid tiers, 3–15s. Every "native 4K 60fps" citation traced back to SEO aggregator blogs. **[HYPOTHESIS at best — treat as unverified marketing drift]**
10. **Kling's older capability set was module-shaped (separate lip-sync, effects, virtual try-on, motion-brush endpoints) and is being absorbed into the unified model.** Motion Control (video→image motion transfer) is still explicitly a separate pass that "does not handle audio/lip-sync (requires separate Video 3.0 generation)." Unification is directional, not complete. **[VERIFIED — official kling.ai feature page]**
11. **Kling is not short-form-only. It has a three-tier duration story, and the top tier is genuinely long-form** *(revised 2026-09-13; supersedes the earlier reading that ≤15s was the ceiling and that "2 minutes" was a legacy-only 2024 figure)*. The three tiers are: **(a) ≤15s** — one Video 3.0 generation, holding ≤6 cuts; **(b) ≤3 min** — an *official, documented* iterative extension workflow (below); **(c) ≤5 min** — **Kling AI Avatar 2.0**, an audio-driven digital-human mode, officially described as "offering full coverage for 5-minute-long content scenes." Tier (c) is the only current Kling surface producing multi-minute output in one product operation, and it is narrow: it animates a single supplied portrait to speech, not general text-to-video. **[VERIFIED — official kling.ai Video Extension guide + Avatar 2.0 user guide]**
12. **The long-form architecture is disclosed — in a second, separate Kling Team paper the earlier pass missed.** *KlingAvatar 2.0 Technical Report* (arXiv 2512.13313, 27 authors, 2025-12-15) describes a **spatio-temporal cascade**: a low-res "blueprint" video capturing global dynamics → high-res DiT upscaling of *representative keyframes* → first-last-frame-conditioned expansion of those anchors into sub-clips → SR on the sub-clips, with an "audio-aware interpolation strategy" synthesizing transition frames between segments. The paper states this is "effectively mitigating temporal drifting artifacts." **This is a keyframe-anchored long-form generation pattern and is the single most directly transferable architecture in this brief for Narrata's long-form storytelling problem.** **[VERIFIED — arXiv 2512.13313]**

---

## Publicly Known Architecture — Product Layer

```
                    ┌───────────────────────────────────────────────────┐
                    │                     USERS                          │
                    │  60M+ creators · 30,000+ enterprise clients ·       │
                    │  Kuaishou/KuaiYing in-app users · API developers    │
                    └────────────────────────┬──────────────────────────┘
                                             │
  ┌───────────┬────────────┬────────────┬────┴────────┬───────────┬──────────────┐
  │  KLING    │  ELEMENT   │  DIRECTOR  │   MOTION    │  IMAGE    │ KLING OPEN   │
  │  VIDEO    │  LIBRARY   │   MODE     │   CONTROL   │  STUDIO   │  PLATFORM    │
  │           │            │            │             │           │   (API)      │
  │ T2V / I2V │ persistent │ multi-shot │ ref-video → │ Image 3.0 │ per-model    │
  │ first+last│ @-mentioned│ storyboard │ static image│ Image 3.0 │ endpoints    │
  │ frame     │ characters │ ≤6 cuts    │ motion xfer │   Omni    │ async tasks  │
  │ extend    │ props      │ per-shot   │ 1 subject   │ Kolors 2.1│ callbacks    │
  │ inpaint   │ scenes     │ prompts +  │ Bind Face   │ 2K / 4K   │ JWT auth     │
  │ restyle   │ costumes   │ durations  │  Subject    │ multi-ref │              │
  │ lip sync  │ + voices   │ audio ON   │             │ local edit│              │
  └───────────┴────────────┴────────────┴─────────────┴───────────┴──────────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        │        MVL ASSEMBLY LAYER                │
                        │  text + @elements + ref images/videos +  │
                        │  masks + camera config → one composite   │
                        │  multimodal instruction                  │
                        │  + Prompt Enhancer (MLLM, SFT→RL)        │
                        └────────────────────┬────────────────────┘
                                             │
        ┌────────────────────────────────────┴──────────────────────────────┐
        │                          MODEL LAYER                               │
        │  VIDEO:  Kling Video 3.0 · Video 3.0 Omni · Kling O1 Video ·       │
        │          (legacy: 2.6 / 2.5 / 2.1 / 2.0 / 1.6 / 1.5 / 1.0)        │
        │  IMAGE:  Kling Image 3.0 · Image 3.0 Omni · Kling O1 Image ·       │
        │          Kolors 2.1  (Kolors 1.x open-sourced, Apache-2.0)         │
        │  AUX:    Multimodal Super-Resolution cascade · Prompt Enhancer MLLM │
        └────────────────────────────────────────────────────────────────────┘
```
**[VERIFIED]** for every named surface, model and limit; the grouping into "layers" is analytical framing, not a Kuaishou-published diagram.

---

## Model Stack

| Model | Role | Publicly disclosed internals |
|---|---|---|
| **Kling Video 3.0** | Flagship T2V/I2V; **3–15s per generation**, chain-extendable to **≤3 min total**; multi-scene/multi-shot; native audio in 5 languages; element binding (3 elements) | MVL framework **[VERIFIED]**; internals inherited from the Kling-Omni report **[STRONG INFERENCE]** |
| **Kling Video 3.0 Omni** | All-in-one multimodal I/O: text+image+audio+video in and out; voice-driven characters; storyboards; 7 reference characters (4 if a video is also supplied) | Same **[VERIFIED for limits, via official Element Library guide]** |
| **Kling O1 / Omni One** | The unified base. Fuses reference-to-video, T2V, start/end-frame, video inpainting (insert **and** remove), video modification/transformation, style re-render, shot extension into one engine. 3s and 10s; up to 10 reference images | **Best-documented.** Prompt Enhancer (MLLM) + Omni-Generator (DiT, shared visual/text embedding space) + cascaded SR. "Multimodal Transformer with built-in multimodal comprehension and multimodal long-context" **[VERIFIED — arXiv 2512.16776 + Kuaishou IR]** |
| **Kling 1.x/2.x base (2024 disclosure)** | Historic foundation | **DiT** + Kuaishou's **self-developed 3D VAE** achieving "synchronous spatiotemporal compression," plus a "computationally efficient, full-attention mechanism as a spatiotemporal modeling module." Up to 2 min, 30fps, 1080p **[VERIFIED — Kuaishou IR, June 2024]**. *Note: the 2024 "up to 2 min" is a model-capability claim, not a productized single-generation limit; the current productized ceiling for general video is ≤15s per call and ≤3 min via chained extension. **Neither the 3D VAE nor the full-attention spatiotemporal module is restated anywhere in the 2025 Kling-Omni report** — whether 3.0 still uses them is unverified (see "What Could Not Be Verified").* |
| **Multimodal Super-Resolution** | Cascaded upscaling stage | Cascaded diffusion conditioned on **LR latents + MVL signals**; local window attention with shifted windows on odd layers; **asymmetric attention** (condition tokens self-attend only, noisy tokens attend fully) to enable **KV-cache reuse across denoising steps** **[VERIFIED]** |
| **Prompt Enhancer** | Rewrites user prompts onto the training distribution | MLLM; SFT for reasoning, then RL optimizing "factual correctness, content richness, and semantic plausibility." Backbone model **not named** **[VERIFIED that it exists; backbone NOT disclosed]** |
| **Kolors / Kolors 2.1** | Image generation lineage feeding Kling Image | Kolors is a latent-diffusion bilingual T2I model, **open-sourced under Apache-2.0** (`Kwai-Kolors/Kolors`). 2.1's internals not disclosed **[VERIFIED for open-source status]** |
| **Motion Control** | Motion/expression transfer: reference video → static character image | Mechanism **not disclosed**. Single primary subject; no audio path **[VERIFIED for constraints]** |
| **Kling AI Avatar 2.0** (model: *KlingAvatar 2.0*) | **The long-form surface.** Audio-driven digital human: portrait image + speech (uploaded audio or TTS) + optional action/expression prompt → **up to 5 minutes** of performance. Priced per second (Std 4 / Pro 8 credits/sec) | **Second-best-documented after O1.** Spatio-temporal cascade: low-res "blueprint video that captures global dynamics, content, and layout" → high-res DiT upscales **representative keyframes** ("enriching fine details while preserving identity") → low-res diffusion expands those anchors into audio-synced sub-clips via **first-last-frame conditioned generation** → high-res SR per sub-clip. Plus an "audio-aware interpolation strategy [that] synthesizes transition frames to enhance temporal connectivity, lip synchronization, and spatial consistency," and a "Co-Reasoning Director composed of three modality-specific LLM experts." **[VERIFIED — arXiv 2512.13313 + official kling.ai Avatar 2.0 guide]** |
| **Video Extension** (workflow, not a distinct model) | Iterative lengthening of an already-generated Kling clip: **+4–5s per call, repeatable, ≤3 min total**. Two modes — **Auto-Extend** (no prompt; "the model autonomously continues the video based on its interpretation of the content") and **Customized Extend** (text-directed continuation) | Mechanism **not disclosed**; O1 lists "shot extension" among its fused capabilities, and `video-extend` is an API mode. Official guidance is that the prompt "needs to be consistent with the main subject of the original video; unrelated text may cause a camera cut or transition" — i.e. continuity across extensions is **prompt-discipline-dependent, not enforced**. Model and mode are inherited from the source clip and cannot be changed mid-chain; only Kling-generated video can be extended. **[VERIFIED for the workflow and limits via official kling.ai guide; the model/mode-locking and upload restriction are STRONG INFERENCE from API-spec mirrors]** |

---

## Generation Pipeline

```mermaid
flowchart TD
    U[User / API client] --> ASM[MVL assembly:<br/>text + @elements + ref images +<br/>ref video + masks + camera config]
    EL[(Element Library:<br/>characters · props · scenes ·<br/>costumes · bound voices)] -.->|@mention| ASM

    ASM --> PE[Prompt Enhancer MLLM<br/>SFT then RL<br/>maps prompt onto training distribution]
    PE --> TOK[Unified tokenization:<br/>visual + textual tokens<br/>into shared embedding space]

    TOK --> GEN[Omni-Generator DiT<br/>3D-VAE latent space<br/>full spatiotemporal attention<br/>10 NFE after distillation]

    GEN --> TASK{Task form}
    TASK -->|T2V / I2V| V1[Base-res latents]
    TASK -->|multi-shot| V2[≤6 cuts, per-shot prompt+duration,<br/>one shared context, ≤15s]
    TASK -->|edit / inpaint / restyle| V3[Unedited regions preserved]
    TASK -->|extend / next-shot| V4[Shot extension from prior context<br/>+4-5s per call, repeatable<br/>≤3 min cumulative]

    V1 --> SR
    V2 --> SR
    V3 --> SR
    V4 --> SR
    SR[Cascaded Multimodal Super-Resolution<br/>conditioned on LR latents + MVL signal<br/>window attention · KV-cache reuse]

    SR --> AUD[Native audio + lip sync<br/>EN/ZH/JA/KO/ES + accents<br/>3.0-era, not in the Dec report]
    AUD --> DEC[3D VAE decode]
    DEC --> OUT[Task output URL<br/>async, time-limited]
    OUT --> HUM{User review}
    HUM -->|not right| ASM
    HUM -->|fix a region| V3
    HUM -->|continue the story| V4
    HUM -->|accept| DEL[Delivery / CDN]
```

**Evidence note:** the Prompt Enhancer, Omni-Generator, cascaded SR, 10-NFE inference, and the four task forms are **VERIFIED** from the technical report and official product pages. The *ordering* of audio relative to super-resolution is **HYPOTHESIS** — no source states where in the stack audio is produced. As with Runway, **no evidence was found of any automated quality or continuity critic** inside Kling's pipeline; the refinement loop is human-in-the-loop. Kling does operate an internal evaluation benchmark (**OmniVideo-1.0**, 500+ cases scoring Dynamic Quality / Prompt Following / Identity Consistency / Video Consistency), but that is a **model-development** benchmark, not a per-generation runtime gate. **[STRONG INFERENCE — benchmark presence VERIFIED, runtime absence inferred]**

### API Request Lifecycle

```
  CLIENT                   KLING OPEN PLATFORM                 BACKEND
    │                              │                              │
    ├── JWT (ak/sk, short TTL) ───►│                              │
    │                              │                              │
    ├── POST /v1/videos/{mode} ───►│                              │
    │   mode ∈ {text2video,        ├─ validate + quota ──────────►│
    │           image2video,       │                              │
    │           multi-image2video, │   model-specific endpoint    │
    │           video-extend,      │   per version; decoupled     │
    │           lip-sync, effects} │   params (3.0 API redesign)  │
    │                              │                              │
    │   model_name  prompt         │                         ┌────▼────┐
    │   negative_prompt  cfg_scale │                         │  QUEUE  │
    │   mode(std|pro)  duration    │                         └────┬────┘
    │   image / image_tail         │                              │
    │   static_mask                │                         ┌────▼────┐
    │   dynamic_masks[≤6]          │                         │ GPU pool│
    │   camera_control{...}        │                         │ FP8 ·   │
    │   callback_url               │                         │ Ulysses+│
    │                              │                         │ TP · KV │
    │◄── { task_id, status:submitted }                        │ caching │
    │                              │                         └─────────┘
    ├── GET /v1/videos/{id} ──────►│   submitted→processing→succeed/failed
    │◄── processing                │
    │◄── succeed { video.url }     │   OR push to callback_url
    └──────────────────────────────┘
```

Two constraints worth noting: **`camera_control` is mutually exclusive with `image_tail`, `dynamic_masks` and `static_mask`** — i.e. you may direct the camera *or* pin endpoints/paint motion, never both in one call. And `dynamic_masks` carry **trajectories** (normalized 0–1 coordinates with time values, max 6 masks), which is the motion brush expressed as data. **[VERIFIED at API-surface level via fal.ai and AI/ML API mirrors of the official Kling spec; kling.ai's own docs SPA could not be read directly. Queue/GPU internals are STRONG INFERENCE, though the FP8/parallelism/caching details are VERIFIED from the technical report.]**

---

## Orchestration — one model, many task heads

Kling has **no model router in the Runway sense**. There is no cost/latency/quality optimization axis, no allow/deny list, no cross-vendor brokering. Selection is explicit and user-facing.

```
                        USER CHOOSES, EXPLICITLY
                                  │
      ┌───────────┬───────────────┼───────────────┬──────────────┐
      ▼           ▼               ▼               ▼              ▼
  model_name   mode: std|pro   duration       Element bindings  feature surface
  (v3 / v3-    (quality vs     (5/10/15s)     (0–7 refs)        (Director Mode /
   omni / o1 /  price tier)                                      Motion Control /
   2.6 / ...)                                                    Lip Sync / Effects)
      │            │                │                │                │
      └────────────┴────────────────┴────────────────┴────────────────┘
                                  │
                                  ▼
               ONE UNIFIED MODEL — task disambiguated by
               the *shape of the MVL input*, not by routing
                                  │
        ┌────────────┬────────────┼────────────┬────────────┐
        ▼            ▼            ▼            ▼            ▼
     T2V          ref-to-V     edit/inpaint  extend      style
                                                          re-render
```

The design claim is that **task identity is inferred from input composition**. Give it text → T2V. Text + tagged subject images → reference-to-video. Text + video + mask → inpaint. Text + video tail → shot extension. Kuaishou's official language for O1 is that the model "interpret[s] all user inputs – whether images, video clips, specific subjects, or text – as executable prompts." **[VERIFIED for the claim; that this is literally how task dispatch works internally is STRONG INFERENCE]**

The tier system (`std` vs `pro`, and 3.0 vs Turbo variants) is the closest thing to routing, and it is **quality/price selection exposed to the user rather than decided by the platform**. **[VERIFIED — API surface]**

---

## Continuity System

Kling attacks continuity at five layers — and the layer that matters most is *durable, named, reusable entities*, which is exactly Narrata's design. Layers 1–4 are all about *identity* continuity; Layer 5, added 2026-09-13, covers *motion/temporal* continuity and is by far the least disclosed.

```
 LAYER 1 — PERSISTENT ENTITIES: the Element Library          ★ strongest layer
   Element = named, tagged, permanently stored asset
     categories: Character · Animal · Prop · Costume&Accessory ·
                 Scene · Special Effect · Other
     built from: 1 main image + up to 3 multi-angle images   (max 4)
             OR: a 3–8s single-subject video clip
     optional:   a BOUND VOICE (uploaded audio or Voice Library entry)
     assist:     AI expands one reference into extra views via Kling O1 Image
     invoked:    "@CharacterName" inline in the prompt
     reusable:   across unlimited projects, persists indefinitely
   [VERIFIED — official kling.ai Element Library guide]

 LAYER 2 — REFERENCE BUDGET PER GENERATION
   Video 3.0 .................... 3 bound elements
   Video 3.0 Omni / O1 .......... 7 reference characters
   Video 3.0 Omni / O1 + video .. 4 total images/elements
   Image 3.0 Omni / O1 .......... 10 total images/elements
   Kling O1 (launch spec) ....... up to 10 reference images
   [VERIFIED]

 LAYER 3 — IN-MODEL MULTI-SHOT
   ≤6 cuts inside ONE generation, each with its own prompt and duration,
   total ≤15s; the model "dynamically adjust[s] camera angles and shots."
   ⇒ cross-cut continuity is a property of a shared context, not stitching
   [capability VERIFIED; "shared context" STRONG INFERENCE]

 LAYER 4 — SUBJECT BINDING TOGGLE
   "Bind Subject to Enhance Consistency" — an explicit user switch that
   strengthens identity adherence during generation; Motion Control has a
   parallel "Bind Face Subject" option.
   ⇒ continuity is a USER-CONTROLLABLE DIAL, not an always-on behavior
   [VERIFIED that the control exists; mechanism NOT disclosed]

 LAYER 5 — TEMPORAL / MOTION CONSISTENCY *within* a clip    ★ weakest disclosure
   NOT an architectural mechanism. Kling addresses motion stability at three
   non-architectural points in the model lifecycle:
     DATA      filtered out "videos with excessively low action semantic
               density, thereby improving the effective training ratio for
               dynamic content"; filtering also detects "abrupt scene changes
               and incoherent shot transitions"
     TRAINING  DPO preference pairs whose "optimization objectives are
               centered on key perceptual metrics, specifically MOTION
               DYNAMICS and visual integrity"
     EVAL      OmniVideo-1.0's "Dynamic Quality" dimension: "assesses the
               temporal performance of the model, focusing on the continuity
               between frames, the stability of attributes, and the
               plausibility of motion" — incl. "naturalness of movement, the
               seamlessness of subject-background integration, and the
               adequacy of motion amplitude"
   ⇒ motion consistency is a TRAINED AND MEASURED property, not an enforced one
   [VERIFIED — arXiv 2512.16776]
```

### Clarifying note: Layer 5 is not "Motion Control"

These are two unrelated things that the word "motion" collapses, and the
earlier version of this brief only covered the second:

| | **Layer 5 — temporal/motion consistency** | **Motion Control (product feature)** |
|---|---|---|
| Question it answers | "does motion within this clip hold together frame to frame?" | "can I transfer motion from *this* video onto *that* still image?" |
| Where it lives | data curation + DPO + eval benchmark | a separate generation pass, distinct endpoint |
| User-facing? | No — invisible, always on | Yes — an explicit feature surface |
| Mechanism disclosed? | No architecture; only objectives and metrics | No |

**The substantive finding is a negative one, and it is worth stating plainly:
Kling discloses no architectural or loss-level mechanism dedicated to temporal
stability in its general video model.** There is no temporal-consistency loss,
no optical-flow or warping objective, no frame-to-frame regularizer, no
explicit anti-flicker module anywhere in the Kling-Omni report. Temporal
quality is pursued entirely through *what the model is trained on*, *what it is
preference-optimized toward*, and *what it is scored against*. **[VERIFIED by
absence across arXiv 2512.16776; the 2024-era "full-attention spatiotemporal
modeling module" and 3D-VAE "synchronous spatiotemporal compression" are the
only architecture-level temporal claims Kuaishou has ever made, they date from
June 2024, and the 2025 report does not restate them — so whether 3.0's
temporal stability rests on them is HYPOTHESIS.]**

Official 2026 marketing is correspondingly thin here: the Kuaishou 3.0 release
claims characters "remain visually coherent across frames" and "smooth,
film-like transitions," but both are *consistency-of-identity* and
*shot-transition* claims, not motion-artifact claims. No official kling.ai
source found makes an explicit anti-flicker, anti-deformation or
motion-stability claim. **[VERIFIED — Kuaishou IR 2026-02-05; absence VERIFIED
across the official blog/quickstart corpus read this session.]** Abundant
secondary commentary asserts Kling 3.0 uses "3D attention across spatial and
temporal dimensions" and is "physics-first"; **none of it traces to a primary
source and it is explicitly NOT used as evidence here. [HYPOTHESIS]**

The one place Kling *does* disclose real temporal-stability engineering is the
**KlingAvatar 2.0 cascade** (see Model Stack), where long-form drift is
controlled structurally: generate a low-res blueprint of global dynamics first,
upscale only representative **keyframes**, then regenerate the intervening
motion as **first-last-frame-conditioned sub-clips**, then interpolate
transition frames between segments. That is a genuine anti-drift architecture —
but it exists in the avatar line, not the general video model. **[VERIFIED —
arXiv 2512.13313]**

Three further structural observations.

**First, the subject-library training story is disclosed and unusual.** The technical report describes a "subject library mechanism, where multiple images of the same subject (e.g., the same person with different viewpoints, poses, expressions, or lighting conditions) can be jointly provided" — and separately describes **"automatic reverse synthesis"** to manufacture reference-to-video training pairs at scale, plus a cross-modal filtering tier that performs explicit **"character identity verification."** So multi-angle identity conditioning isn't a prompt trick bolted on; it is a trained-for capability with a purpose-built data pipeline behind it. **[VERIFIED]**

**Second, the mechanism is still not public.** Kling's product blog describes "high-dimensional vectors representing the facial structure, hairstyle, and even specific clothing textures," which reads as identity-embedding conditioning — but that phrasing appears in marketing copy, not the technical report, which never specifies how references are injected (concatenation? cross-attention? adapter?). **[STRONG INFERENCE that some form of identity-embedding/reference conditioning is used; the specific mechanism is HYPOTHESIS.]**

**Third — and this is the notable absence — Kling has no Aleph-equivalent cross-shot edit-propagation.** It has excellent *pre-generation* continuity (elements, binding) and in-context multi-shot continuity, but no "fix one frame, propagate the fix across all cuts" repair operation. Its editing capability is per-clip. **[STRONG INFERENCE — absence of evidence across official docs, blog, and the technical report.]**

---

## Probable Hidden Architecture

What the report *shows* and what it *withholds* form a clean pattern: **Kling published its systems engineering and withheld its model topology.**

```
  DISCLOSED (VERIFIED)                        WITHHELD (NOT DISCLOSED)
  ─────────────────────────────────────       ──────────────────────────────────
  3-stage system: PE → Generator → SR         DiT depth / width / parameter count
  DiT + self-developed 3D VAE                 3D VAE compression ratios
  Full spatiotemporal attention (2024)        Whether 3.0 still uses full attention
  Shared visual+text embedding space          Tokenizer, positional encoding (3D RoPE?)
  Pretrain → SFT → DPO → distillation         Text encoder identity
  150 NFE → 10 NFE                            Prompt Enhancer MLLM backbone
  Ulysses + tensor parallelism                Cluster size, GPU type, vendor
  FP8 GEMM + FP8 self-attn + FP8 comms        Reference injection mechanism
  ~2× caching speedup + cache-offload         Audio model architecture (absent entirely)
  3-tier data filtering pipeline              Training data sources / scale / compute
  OmniVideo-1.0 eval benchmark                Any runtime quality gate
```

The most reasonable reading of the inference stack:

```
      MVL composite input
              │
              ▼
     ┌──────────────────────────────────────────────────────────┐
     │  OMNI-GENERATOR  —  diffusion transformer                 │
     │                                                            │
     │  visual tokens (3D-VAE latents) ⊕ text tokens             │
     │      in ONE shared embedding space                        │
     │      "deep cross-modal interaction"  [VERIFIED phrasing]  │
     │                                                            │
     │  denoise: 10 NFE                                          │
     │    ← trajectory-matching distillation                     │
     │    ← distribution-matching distillation                   │
     │    ← DPO preference alignment before distillation         │
     │                                                            │
     │  served with: Ulysses SP + tensor parallel,               │
     │               comp/comm overlap, FP8 GEMM+attn+comms,     │
     │               step-cache (~2×) with offload               │
     └────────────────────────┬─────────────────────────────────┘
                              │  LR latents  +  MVL signal
                              ▼
     ┌──────────────────────────────────────────────────────────┐
     │  CASCADED MULTIMODAL SUPER-RESOLUTION                      │
     │   local window attention, shifted windows on odd layers    │
     │   ASYMMETRIC ATTENTION:                                    │
     │     condition tokens → self-attention only  (static)       │
     │     noisy tokens     → full attention       (evolving)     │
     │   ⇒ condition KV cached ONCE, reused every denoising step  │
     └──────────────────────────────────────────────────────────┘
```
**[VERIFIED — arXiv 2512.16776.]** The asymmetric-attention trick is the elegant part: because the conditioning tokens never change across denoising steps, their KV can be computed once and reused, which is why a cascaded SR stage is affordable at production volume. **This also strongly suggests Kling's high-resolution output is produced by the SR cascade rather than natively** — which is the direct technical reason to distrust the secondary-source "native 4K, not upscaled" claim. **[STRONG INFERENCE]**

---

## Infrastructure

| Signal | Evidence |
|---|---|
| Hybrid **Ulysses sequence parallelism + tensor parallelism** with an explicit computation–communication overlap scheme | **[VERIFIED — technical report]** |
| **FP8 hybrid quantization**: most GEMMs and self-attention in FP8, fused quant/dequant operators, **FP8 communication** | **[VERIFIED]** |
| **Step caching ~2× speedup** plus a cache-offload path for memory pressure | **[VERIFIED]** |
| **10 NFE** production inference after two-stage distillation (from 150) | **[VERIFIED]** — this is the economics of the whole product |
| Async create→poll task API with callbacks, JWT auth, per-model endpoints, std/pro quality tiers | **[VERIFIED — API surface via official-spec mirrors]** |
| Scale of operation: 60M+ creators, 600M+ videos produced, 30,000+ enterprise clients | **[VERIFIED — Kuaishou IR, 2026-02-05]** |
| Kuaishou 2026 capex guided to ~RMB 26B, targeted at compute infrastructure, foundation models and AI agents | **[Reported by financial media — business intelligence, route to `market-intelligence`]** |
| GPU vendor/model, cluster size, region topology, storage/CDN stack, orchestration layer | **NOT VERIFIABLE.** No public disclosure found. Chinese-language sources not accessible this session. |
| Kling AI's ~$3B external financing round / carve-out from Kuaishou (Tencent, Baidu participating, 2026-07) | **Business intelligence — belongs to `market-intelligence`, not reasoned about here** |

---

## UX Architecture

Six surfaces sit on the unified model: **Kling Video** (T2V/I2V, first+last frame, extend, inpaint, restyle, lip sync), the **Element Library** (persistent named assets with `@`-mention invocation and optional bound voices), **Director Mode** (multi-shot storyboarding — a Smart mode where the model decomposes one description into shots, and a Custom mode where the user sets each shot's duration, camera move and action), **Motion Control** (reference-video → static-image motion transfer), **Image Studio** (Image 3.0 / Omni / Kolors 2.1, multi-reference, local editing, series workflows), and the **Kling Open Platform** API.

Three UX patterns stand out as genuinely well-designed:

- **`@mention` as the binding syntax.** Continuity is expressed *inside the prompt* in a notation users already understand from chat apps, rather than through a separate reference-upload panel. It makes a structured MVL input feel like typing a sentence.
- **Smart vs. Custom storyboard as a single toggle.** The same feature serves "I have no idea what shots I want" and "I know exactly what shots I want," which is precisely the novice/pro split every storytelling tool has to straddle.
- **Consistency as an explicit, visible switch** ("Bind Subject to Enhance Consistency"). Users can *see* that continuity is a thing the system is doing, and can trade it off. Compare with platforms where consistency is opaque and users are left guessing why identity drifted.

---

## What Narrata Should Adopt (evidence-based, not exhaustive)

- **Multi-angle reference sets per entity, plus AI-assisted view expansion.** Kling requires 1 main + up to 3 additional angles per Element and offers automatic generation of extra views from a single reference. Narrata's `Character`/`Location` already carry `referenceImages`; the evidenced extension is **structuring those images by viewpoint role** (front/side/back/detail) rather than as a flat array, and offering an "expand to multi-angle" assist for users who only have one image. Kling's technical report shows this multi-angle subject-library approach is trained-for, not cosmetic. **[VERIFIED capability; extension is our recommendation — route to `ai-architect`]**
- **Bindable voice as part of the character entity.** Kling attaches a voice (uploaded audio or Voice Library entry) directly to a character Element. This directly corroborates Narrata's existing server-side voice-resolution design for story-wide voice consistency — it is validation of the current direction, and the evidenced extension is that the *visual* and *vocal* identity should live on the same record. **[VERIFIED — official Element Library guide]**
- **A visible consistency control rather than an invisible one.** Kling exposes "Bind Subject to Enhance Consistency" as a user-facing toggle. Narrata already has `isLocked` on `Character`/`Location`; the pattern worth borrowing is **surfacing continuity strength as something the user can see acting on a generation**, which is a `ui-ux-engineer` question more than an architecture one. **[VERIFIED pattern]**
- **Keyframe-anchored long-form generation (the KlingAvatar 2.0 cascade).** *Added 2026-09-13.* The disclosed pattern — plan global dynamics cheaply at low res, upscale only **anchor keyframes**, then generate each intervening segment as a **first-last-frame-conditioned sub-clip**, then interpolate transition frames between segments — is the most transferable architecture found in this brief. It is architecturally close to what Narrata already does (staged Shot → Scene generation with frame-chaining) but inverts the control flow: instead of chaining forward from the last frame and accumulating drift, it *pins both ends of every segment in advance*. Because both endpoints are fixed, drift cannot compound past a segment boundary — which is exactly why Kuaishou can ship 5-minute output while its general model caps at 15s. Narrata is API-first and cannot train this, but **the orchestration pattern is implementable on top of any first-last-frame-capable generation API** and is worth evaluating against the current forward-chaining approach. **[VERIFIED pattern — arXiv 2512.13313; the recommendation is ours. Route to `video-architect`.]**
- **Step-count/quality tiering as an explicit user-chosen axis.** Kling's `std`/`pro` mode is quality-vs-price selection exposed to the user, and their disclosed 150→10 NFE distillation is the reason cheap tiers are viable. Narrata's `AiModelOption`/`VideoModelConfig` registry could carry an analogous explicit tier dimension — noting Narrata is API-first, so the lever is *which* provider/model/tier is called, not step counts we control. **[VERIFIED at Kling; recommendation routes to `video-architect`]**

## What Narrata Should Avoid / Not Chase Yet

- **Do not chase a unified generate-and-edit foundation model.** Kling's whole 2026 thesis (MVL, O1, Omni) requires training a model. Narrata is API-first and this is not a buildable pattern for us — the *consumable* lesson is the **input composition** idea (structured multimodal instruction rather than a prompt string), which we can adopt at the prompt-assembly layer without owning a model.
- **Do not treat "native 4K/60fps video" as a competitive bar to match.** It is not claimed by Kuaishou for video anywhere found; the official 3.0 release attributes 2K/4K to the *image* models, and Kling's own SR-cascade architecture implies upscaling. Matching an unverified spec would be chasing a marketing artifact.
- **Do not assume Kling has solved automated quality/continuity evaluation at runtime.** They have a strong *development-time* benchmark (OmniVideo-1.0, with Identity Consistency and Video Consistency as named dimensions) but no evidence of a per-generation gate. This is now the **second** frontier platform examined (after Runway) with the same gap — the absence of a runtime video critic looks like a genuine industry-wide hole rather than a catch-up item, strengthening the case that Narrata's missing video/audio validation stage is a differentiation opportunity, not just a deficiency. **[STRONG INFERENCE, corroborated across two platforms]**

---

## What Could Not Be Verified

- The Omni-Generator's concrete topology: attention pattern (full vs. MMDiT vs. cross-attention), depth/width, parameter count, positional encoding scheme.
- The 3D VAE's compression ratios, and whether the 2024-disclosed "full attention spatiotemporal module" is still the 3.0-era design. **Re-checked 2026-09-13: the Kling-Omni report does not mention the 3D VAE, "synchronous spatiotemporal compression," or the full-attention spatiotemporal module at all** (it references "VAE/text encoder inference" only in a systems context). The only disclosed attention detail is the SR module's local window attention with shifted windows on odd layers. So there is no way to connect the 2024 temporal-architecture claims to 3.0's actual motion quality.
- **Any architectural or loss-level mechanism for temporal/motion stability in the general video model.** No temporal-consistency loss, optical-flow objective, frame-to-frame regularizer or anti-flicker module is disclosed anywhere. Motion quality appears only as a *data-filtering criterion*, a *DPO optimization objective* ("motion dynamics and visual integrity") and an *eval dimension* (OmniVideo-1.0 "Dynamic Quality"). Whether anything architectural underpins it is genuinely unresolved — this is the second most important unknown for Narrata after reference injection, because it determines whether motion stability is something a platform *buys from the model* or *engineers around it*.
- **Whether the KlingAvatar 2.0 cascade shares any components with the general Kling Video model.** The two Kling Team papers (2512.16776 and 2512.13313) were submitted three days apart and never cite each other in anything readable this session. Whether the general video line will inherit the avatar line's keyframe-anchored long-form approach is **HYPOTHESIS**.
- **Whether the ≤3 min extension ceiling is per-clip or per-plan, and which model versions support extension.** The official kling.ai guide states the 3-min total and the 4–5s increment but names no model restrictions and no cap on number of successive extensions; third-party sources claim extension is unavailable on the free tier and that model/mode are locked to the source clip, but no official confirmation was found. Also unverified: how much quality degrades across a long extension chain — widely asserted in secondary sources, never measured in a primary one.
- The text encoder and the Prompt Enhancer's MLLM backbone — both referenced, neither named.
- **How references are actually injected** (token concatenation, adapter, cross-attention, identity embedding). This is the single most important unknown for Narrata's purposes.
- The audio/lip-sync architecture for **Kling Video 3.0** — the Kling-Omni report omits it entirely. *Partially narrowed 2026-09-13:* a separate Kling Team paper, **KlingAvatar 2.0 (arXiv 2512.13313)**, does document audio-conditioned generation and lip sync for the **avatar** line (audio-synced sub-clips, audio-aware interpolation, "realistic lip-teeth rendering"). Whether Video 3.0's native audio uses the same machinery is **HYPOTHESIS**.
- Whether multi-shot truly generates all cuts in one forward pass or orchestrates several conditioned passes internally.
- Whether Video 3.0 output ever exceeds 1080p, and whether 60fps is offered at all.
- GPU vendor/count, cluster topology, storage and CDN stack.
- **Chinese-language primary sources** (Kuaishou WeChat tech posts, Zhihu engineering writeups, the Chinese klingai.com documentation) were not accessible this session. If Kling's reference-injection mechanism or audio architecture is documented anywhere publicly, that is the most likely place — this is the top open research lead.
- `kling.ai/document-api/*` could not be read directly (client-rendered SPA); API details here rest on third-party mirrors of the official spec and should be re-verified before any integration work.
- Release-date conflicts: Wikipedia dates 3.0 to 2026-02-07, Kuaishou's own release to 2026-02-05, and one aggregator to 2026-02-04; a "3.0 Turbo/Omni" update is reported for 2026-06-17 but could not be confirmed from an official source. Treat dates as ±1 week and the June update as unconfirmed.

---

## Sources

**Primary (Kuaishou / Kling official):**
- [Kling-Omni Technical Report — arXiv 2512.16776](https://arxiv.org/abs/2512.16776) · [HTML full text](https://arxiv.org/html/2512.16776v1) — *the single most important source in this brief*
- [KlingAvatar 2.0 Technical Report — arXiv 2512.13313](https://arxiv.org/abs/2512.13313) · [HTML full text](https://arxiv.org/html/2512.13313v1) (Kling Team, 27 authors, 2025-12-15) — *added 2026-09-13; source for the spatio-temporal cascade, keyframe anchoring, first-last-frame sub-clip conditioning, audio-aware transition interpolation, "temporal drifting" mitigation, and the 5-minute long-form claim*
- [Kling AI — Video Extension Guide](https://kling.ai/quickstart/ai-video-extension) — *added 2026-09-13; primary source for Auto-Extend / Customized Extend, +4–5s per call, ≤3 min total*
- [Kling AI — Avatar 2.0 User Guide](https://kling.ai/quickstart/kling-ai-avatar-2-user-guide) — *added 2026-09-13; primary source for "full coverage for 5-minute-long content scenes" and per-second credit pricing*
- [Kuaishou IR — Kling AI Launches 3.0 Model, Ushering in an Era Where Everyone Can Be a Director](https://ir.kuaishou.com/news-releases/news-release-details/kling-ai-launches-30-model-ushering-era-where-everyone-can-be) (2026-02-05) · [PR Newswire mirror](https://www.prnewswire.com/news-releases/kling-ai-launches-3-0-model-ushering-in-an-era-where-everyone-can-be-a-director-302679944.html)
- [Kuaishou IR — Kling O1 Launches as the World's First Unified Multimodal Video Model](https://ir.kuaishou.com/news-releases/news-release-details/kling-o1-launches-worlds-first-unified-multimodal-video-model-0) (2025-12-01) · [PR Newswire mirror](https://www.prnewswire.com/apac/news-releases/kling-o1-launches-as-the-worlds-first-unified-multimodal-video-model-302630646.html)
- [Kuaishou IR — Kuaishou Unveils Proprietary Video Generation Model "Kling"](https://ir.kuaishou.com/news-releases/news-release-details/kuaishou-unveils-proprietary-video-generation-model-kling) (2024-06) — source of the DiT / 3D VAE / full-attention disclosure
- [Kling AI — Element Library User Guide](https://kling.ai/quickstart/klingai-element-library-3-user-guide)
- [Kling AI Blog — VIDEO 3.0 Omni Native Lip Sync & Audio Guide](https://kling.ai/blog/kling-video-3-omni-native-lip-sync-audio-guide)
- [Kling AI Blog — VIDEO 3.0 Subject Binding: Character Consistency](https://kling.ai/blog/kling-3-subject-binding-character-consistency)
- [Kling AI Blog — IMAGE 3.0 and IMAGE 3.0 Omni: Multi-Reference, Local Editing, Series Workflows](https://kling.ai/blog/kling-image-3-vs-omni)
- [Kling AI — Motion Control feature page](https://kling.ai/feature/ai-motion-control)
- [Kling AI Open Platform — API documentation root](https://kling.ai/document-api) *(SPA; could not be read directly)*
- [Kwai-Kolors/Kolors — GitHub, Apache-2.0](https://github.com/kwai-kolors/Kolors)

**API-surface mirrors (used only for request-parameter facts, since the official docs SPA was unreadable):**
- [fal.ai — Kling Video v1.6 Pro image-to-video API](https://fal.ai/models/fal-ai/kling-video/v1.6/pro/image-to-video)
- [AI/ML API — Kling AI model reference](https://docs.aimlapi.com/api-references/video-models/kling-ai)

**Reference / context:**
- [Wikipedia — Kling AI](https://en.wikipedia.org/wiki/Kling_AI) (version timeline; cites Kuaishou's own 2024 architecture disclosure)

**Business intelligence — noted and routed to `market-intelligence`, not used for any architectural claim:**
- [CNBC — Kuaishou shares jump after Tencent joins $2.8B raise for Kling AI subsidiary](https://www.cnbc.com/2026/07/03/kuaishou-shares-fall-after-securing-tencent-funding-for-kling-ai.html)
- [SCMP — China's Kling AI nears US$3B round at US$18B valuation](https://www.scmp.com/tech/big-tech/article/3359059/chinas-kling-ai-nears-us3-billion-round-us18-billion-valuation-sources)
- [Kuaishou IR — Q2/Interim 2026 unaudited results](https://ir.kuaishou.com/news-releases/news-release-details/kuaishou-technology-announces-second-quarter-and-interim-2026)

**Secondary — consulted, explicitly NOT used for any VERIFIED claim; several are the origin of the unverified "native 4K 60fps video" claim flagged above:**
- magichour.ai, atlascloud.ai, overchat.ai, kingy.ai, chinaai.app, digitalapplied.com, seavidgen.com Kling 3.0 guides/reviews

---

## Relevant to Narrata — closing

- **Kling is the strongest available external validation of Narrata's entity-first continuity design.** A platform with 60M+ users and 600M+ videos generated converged on *persistent, named, tagged, multi-angle, voice-bound, reusable character/prop/scene records invoked by `@name`* — structurally the same thing as Narrata's `Character`/`Location` + `StoryBible`. The evidenced deltas worth handing to `ai-architect` are (a) viewpoint-typed reference images rather than a flat array, (b) AI-assisted multi-angle expansion from a single reference, and (c) voice bound to the same entity record as the visual identity.
- **Runway and Kling have now given two opposite, both-successful answers to the same problem** — Runway: many models + a router + post-hoc edit propagation; Kling: one unified model + structured multimodal input. Narrata, being API-first, can only occupy the Runway side architecturally, but should steal Kling's *input-composition* idea at the prompt-assembly layer: a generation request should be a structured composite (text + typed entity bindings + reference images + camera intent), not a rendered prompt string. That is a cheap, high-leverage change to `MOTION_PROMPT_DRAFTING`/`SHOT_PLANNING` outputs and belongs to `ai-architect`.
- **Neither Runway nor Kling appears to run a per-generation quality/continuity critic.** Kling has a development-time benchmark with explicit Identity Consistency and Video Consistency dimensions (OmniVideo-1.0) but no evidence of a runtime gate. Two frontier platforms, same gap. Narrata's missing video/voice/music validation stage — the analogue of its existing `IMAGE_VALIDATION` — is therefore better framed to `video-architect` as a **differentiation opportunity** than as catch-up work.
- **Kling's 150→10 NFE distillation disclosure is the clearest public explanation of why frontier video generation is cheap enough to sell at consumer prices**, and explains how a competitor can offer long-form/multi-shot output at low unit cost. That is a cost-architecture signal with direct pricing implications — worth handing to `market-intelligence` and `monetization-strategist` rather than reasoning about here.
