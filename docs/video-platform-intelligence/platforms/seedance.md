# Seedance — Architecture Brief

**Analysis date: 2026-09-13.** Seedance is ByteDance's video-generation line, built by the **ByteDance Seed** team and shipped through Doubao, Jimeng/Dreamina (CapCut), the **Volcano Engine** API in China and **BytePlus ModelArk** internationally. The line as of this date is **Seedance 1.0** (2025-06) → **Seedance 1.5 pro** (2025-12) → **Seedance 2.0 / 2.0 Fast / 2.0 Mini** (2026-02) → **Seedance 2.5** (2026-07-31, current flagship). Every non-trivial architectural claim is labeled **VERIFIED** (ByteDance Seed arXiv technical reports, seed.bytedance.com product/blog pages, first-party BytePlus material), **STRONG INFERENCE** (implied by observable API surface, published technique by the same authors, or official capability claims), or **HYPOTHESIS** (plausible, unconfirmed) — see `.claude/agents/video-platform-intelligence.md`'s research principle.

**Access note — and this brief's disclosure pattern is the most unusual of any platform examined so far.** ByteDance has published **four** relevant English-language arXiv reports, three of them explicitly Seedance:

| Source | Readable this session? |
|---|---|
| **Seedance 1.0** (arXiv 2506.09113) — HTML full text | **Yes, in full.** By a wide margin the most architecturally detailed video-model report read in this research programme, more detailed than Kling-Omni |
| **Seedance 1.5 pro** (arXiv 2512.13507) — abstract + Seed/HuggingFace summaries | **Partially.** arXiv has **no HTML rendering** (both `/html/…v1` and ar5iv 404 / fatal-error); the PDF could not be parsed (no local PDF renderer). Abstract, official Seed paper page and HuggingFace paper page were readable |
| **Seedance 2.0** (arXiv 2604.14148) — abstract + alphaXiv/HF summaries | **Partially**, same PDF/HTML limitation. This matters less than it sounds: the 2.0 report is itself thin (see Executive Summary #10) |
| **Long Context Tuning** (arXiv 2503.10589) — HTML full text | **Yes, in full.** ByteDance Seed–affiliated; the best available window into how native multi-shot probably works |

**What could not be read:** `docs.volcengine.com/docs/82379/*` (the Chinese-language Volcano Engine API reference) returned **empty content** on direct fetch, and `docs.byteplus.com/en/docs/ModelArk/*` returned **only its navigation shell** on every page tried (1520757 create-task, 1330310 model list, 1366799 tutorial, 2222480 Seedance 2.0 prompt guide, 2607688 Seedance 2.5 tutorial) — a client-rendered SPA, **exactly the same failure mode as `kling.ai/document-api/*` in the Kling brief.** API-parameter-level facts below therefore come from (a) a first-party **BytePlus blog** post that restates the spec in readable HTML, and (b) third-party mirrors of ByteDance's official spec — fal.ai, the `fal-ai/seedance-2.0-api` GitHub repo, and **OpenRouter**, which is Narrata's actual provider. These are labeled as such throughout. **No Chinese-language ByteDance material (Volcano Engine docs, Doubao product pages, WeChat/Zhihu engineering posts) was accessible this session** — flagged as the top open research lead, same as in the Kling brief.

---

## Executive Summary

1. **Seedance is the most architecturally legible frontier video model in this research programme — but only version 1.0 is.** The Seedance 1.0 technical report (arXiv 2506.09113, 2025-06-10, 44 authors, Yu Gao et al.) discloses the VAE compression ratios, the attention topology, the positional encoding scheme, the training objective, the text encoder used for prompt rewriting **by name**, the captioner **by name**, the distillation methods **by name**, the parallelism strategy, and a wall-clock inference figure on a named GPU. Kling published its systems engineering and withheld its topology; MiniMax published topology and withheld systems; **ByteDance published both — once.** **[VERIFIED]**
2. **The user's premise is confirmed: Seedance uses flow matching, not DDPM-style diffusion.** The report states training uses a "flow matching framework with velocity prediction," with a "resolution-aware shift, which increases the noise perturbation for videos with higher resolution and longer duration." This is a *rectified-flow / velocity-prediction* objective, which is also the precondition for the trajectory-based distillation described in point 6. **[VERIFIED — arXiv 2506.09113]**
3. **The latent representation is aggressive and precisely stated.** A temporally-causal VAE compresses `(T′+1, H′, W′, 3) → (T+1, H, W, C)` with compression ratios **`(rt, rh, rw) = (4, 16, 16)` and `C = 48` channels**, trained with L1 reconstruction + KL + LPIPS perceptual + adversarial loss against a "hybrid PatchGAN-style discriminator." 16× spatial compression is notably more aggressive than MiniMax's H3-VisualVAE (also 16×/4× but 24 channels) at double the channel count. **[VERIFIED]**
4. **The generator's attention topology is *decoupled*, not full 3D — and this is the single biggest architectural divergence from its competitors.** Seedance 1.0 uses "decoupled spatial and temporal layers": spatial layers do within-frame attention, temporal layers do cross-frame attention with "window partition within each frame in the temporal layers, allowing for a global receptive field." Text is fused via an SD3-style **MMDiT** multi-modality self-attention layer "applied exclusively in spatial layers" — "textual tokens only participate in cross-modality interaction in spatial layers." Compare Kling's 2024-disclosed *full* spatiotemporal attention. Decoupled attention is dramatically cheaper at long durations, and is the most likely structural reason Seedance can sell 30-second single-pass generation. **[VERIFIED for the topology; the cost-of-length link is STRONG INFERENCE]**
5. **Multi-shot is a property of the positional encoding, not a stitching layer.** Seedance uses **3D Multi-modal RoPE (MM-RoPE)** over "interleaved sequences of visual tokens and textual tokens," and the report states it "can be extended to training video with multiple shots, where shots are organized in the temporal order of actions and **each shot has its own detailed caption**." So a multi-shot generation is one sequence with *per-shot text conditioning interleaved into it*. This is the cleanest mechanistic explanation of native multi-shot found at any platform. **[VERIFIED]**
6. **The inference-efficiency story is fully disclosed and is the best public cost explanation in this programme after Kling's 150→10 NFE.** Named components: **Trajectory Segmented Consistency Distillation (TSCD)** for ~4× acceleration, then **score distillation from RayFlow** (ByteDance's own instance-aware flow-trajectory acceleration method, arXiv 2503.07699) on top; a purpose-built **"thin VAE decoder"** (narrowed channel widths, retrained against a frozen encoder) for **2× decode speedup with no visual-quality loss**; kernel fusion worth "a cumulative 15% improvement in inference throughput"; "fine-grained mixed-precision quantization tailored for Attention and Gemm operations"; hybrid data+sequence parallelism with communication overhead "reduced to a quarter of the level observed in Ulysses"; and CPU offloading implemented via PyTorch hooks at "less than 2%" performance cost. Net: **~10× end-to-end speedup**, and **a 5-second 1080p video in 41.4 seconds**. **[VERIFIED]**
7. **That 41.4s figure was measured on an NVIDIA L20 — and that is a strategically loaded choice that is easy to miss.** The L20 is NVIDIA's **China-export-compliant** Ada card (AD102, 48 GB GDDR6, 864 GB/s, ~59.8 TFLOPS FP32, 275 W, deliberately configured under the 4,800 TPP export threshold) — roughly an order of magnitude less capable than the H100/B200-class hardware Runway, Higgsfield and MiniMax benchmark on. ByteDance is publishing frontier-competitive latency **on deliberately throttled inference silicon**. That reframes the entire efficiency programme: it is not optimization for elegance, it is optimization under a hardware ceiling — and it is the most plausible structural reason Seedance undercuts Western models on per-second price. **[VERIFIED that the figure is on L20 and that L20 is the China-export SKU; the strategic reading is STRONG INFERENCE. The pricing implication belongs to `market-intelligence`, not analyzed here.]**
8. **High resolution is a cascaded refiner, not native — explicitly stated, unlike everywhere else.** "The base model generates 480p videos first, which are then upscaled to 720p or 1080p" by a separate diffusion refiner "initialized from the pre-trained base model" and conditioned on the low-resolution video by concatenating the upsampled LR video with noise. The refiner gets its own pre-training, SFT **and** RLHF. Where the Kling brief had to *infer* that 4K claims were upscales, ByteDance states the cascade outright. **[VERIFIED]**
9. **Prompt rewriting is a named, separately-trained model — the only platform in this programme to name its backbone.** Seedance's "Prompt Engineering (PE)" module is "initialize[d] based on **Qwen2.5-14B**" and trained in two stages: SFT on manually annotated user prompts rewritten into dense-caption format (with separate handling for T2V vs I2V), then **DPO** on "a dataset of pairs with correct and incorrect rephrased results." Kling confirmed a Prompt Enhancer exists but refused to name the backbone; MiniMax exposes prompt enrichment as an endpoint but names no model. ByteDance named it. **[VERIFIED]**
10. **Disclosure collapsed after 1.0, and the trajectory is worth recording as a method warning.** Seedance 1.5 pro's report (arXiv 2512.13507, 2025-12-15, Team Seedance + 196 authors) still discloses real architecture — a **dual-branch Diffusion Transformer with a cross-modal joint module** for native audio-video joint generation — but at a much higher level. Seedance 2.0's report (arXiv 2604.14148, 2026-04-15, Team Seedance + 170 authors) discloses essentially **nothing** architecturally: its abstract is a capability announcement ("unified, highly efficient, and large-scale architecture"), and the HuggingFace community's own top comment on the #1-ranked paper of that day is that it is "actually more like an ad for their model, no details on training/data/infrastructure/inference/architecture." **A team publishing a real technical report once does not mean it keeps doing so — architecture briefs must re-verify per version, not per vendor.** **[VERIFIED — abstracts read directly; the community characterization is secondary but converges with a direct reading of the abstract]**
11. **Audio became native and *joint* at 1.5 pro, and it is a genuinely different design from Kling's.** Seedance 1.5 pro's abstract: "Leveraging a **dual-branch Diffusion Transformer** architecture, the model integrates a **cross-modal joint module** with a specialized multi-stage data pipeline, achieving exceptional audio-visual synchronization," with "precise multilingual and dialect lip-syncing." Seedance 2.0 extends this to **binaural two-channel** output with simultaneous multi-track content (ambient, music, narration) and frame-level synchronization. Audio is produced in the same forward process as video, not dubbed on. Critically, **`generate_audio` defaults to `true` and is billed at no extra cost** on the API. **[VERIFIED for the architecture claim and the default; "no extra cost" is VERIFIED at fal, an API mirror]**
12. **Reference conditioning scaled 5× in six months and is the most permissive in the industry.** Seedance 2.0: "up to **3 video clips, 9 images, and 3 audio clips**," with a hard **12-file total** cap across modalities. Seedance 2.5: "up to **30 images, 10 video clips, and 10 audio clips** as reference materials in a single pass" — 50 assets. References are addressed **inside the prompt by positional token**: `@Image1`, `@Video1`, `@Audio1`. This is the *third independent sighting* of `@`-mention reference notation (after Kling's `@ElementName` and Higgsfield's `@`-mentions) but with a crucial difference: **Seedance's `@` refers to a positional slot in this request, not to a saved entity.** There is no Element Library equivalent. **[VERIFIED — seed.bytedance.com Seedance 2.5 blog for the 50-asset figure; fal/OpenRouter mirrors for the notation and the 12-file cap]**
13. **Long-form is handled by chained extension with real disclosed continuity intent, and the mechanism is ordinary frame-chaining.** Seedance 2.5 generates **30 seconds in a single pass** — double Kling 3.0's 15s and MiniMax H3's 15s — and supports "multiple rounds of extension," with ByteDance claiming the extension preserves "consistency of main characters, environments, and narrative pacing." The documented implementation generates "a fresh segment from the input video's last frame and a natural-language prompt," then **concatenates** original + new into one output. Extension is bidirectional (forward past the last frame, backward before the first frame) and can also **bridge two existing clips**. A **beta long-video mode reaching ~180 seconds** is claimed on ByteDance's own Dreamina surface. **[VERIFIED for the 30s single pass, the extension capability, and the ByteDance 180s claim; the last-frame-conditioning mechanism is from API mirrors — STRONG INFERENCE]**
14. **There is no runtime quality critic — making Seedance the fifth consecutive frontier platform with this gap.** ByteDance has the most sophisticated *training-time* evaluation apparatus seen anywhere: **three specialized reward models** (Foundational, built on a VLM; Motion; Aesthetic), multi-round iterative RLHF "between the diffusion model and RMs," RLHF applied to the refiner as well as the base, and a human expert benchmark (**SeedVideoBench**, evaluated by "film director experts," 300 prompts each for T2V and I2V, 5-point Likert plus Good-Same-Bad pairwise). **None of it runs at generation time.** No best-of-N, no reward-guided sampling, no PASS/REGENERATE gate is exposed or described. The only runtime gates are content moderation and watermarking. **[STRONG INFERENCE — training-time apparatus VERIFIED; runtime absence inferred from the reports, the API surface, and the absence of any candidate/selection parameter]**
15. **Seedance is already directly reachable from Narrata's existing stack, at four price points, and Narrata's video call already speaks its dialect.** OpenRouter — Narrata's actual provider — lists `bytedance/seedance-2.0-mini` (from **$0.03363/s**), `bytedance/seedance-2.0-fast` (from **$0.04035/s**), `bytedance/seedance-2.0` (from **$0.06726/s**) and `bytedance/seedance-2.5` (from **$0.1028/s**), all with `frame_images` first/last-frame conditioning, `input_references`, `generate_audio`, `seed` and `callback_url`. Narrata's `generateVideo()` in `apps/web/src/lib/ai/openrouter.ts` already sends exactly this shape — and its own code comment already cites "Seedance 2.5's model page (up to 50 image/video/audio reference assets under 'Omni Reference mode')" as the source for the `input_references` design. **This is not a hypothetical integration; it is a registry row.** **[VERIFIED — OpenRouter model pages + Narrata repository state]**

---

## Publicly Known Architecture — Product Layer

```
                    ┌───────────────────────────────────────────────────────┐
                    │                       USERS                            │
                    │  Doubao (豆包) consumer app · Jimeng / Dreamina         │
                    │  (CapCut) creators · Volcano Engine devs (CN) ·        │
                    │  BytePlus ModelArk devs (intl) · aggregator customers  │
                    │  (OpenRouter · fal · Replicate · Runway · Higgsfield)  │
                    └───────────────────────────┬───────────────────────────┘
                                                │
  ┌────────────┬────────────┬─────────────┬─────┴───────┬────────────┬──────────────┐
  │   DOUBAO   │  JIMENG /  │  VOLCANO    │  BYTEPLUS   │  THIRD-    │  SEED TEAM   │
  │            │  DREAMINA  │  ENGINE     │  MODELARK   │  PARTY     │  RESEARCH    │
  │            │  (CapCut)  │   (CN API)  │ (intl API)  │  BROKERS   │  SURFACE     │
  │ consumer   │ 30s clips  │ ark api/v3  │ ark.ap-     │ OpenRouter │ seed.byte    │
  │ chat +     │ long-video │ async tasks │ southeast   │ fal.ai     │ dance.com    │
  │ video gen  │ beta ~180s │ bearer auth │ .bytepluses │ Replicate  │ arXiv        │
  │            │ local edit │ per-model   │ .com        │ Runway     │ reports      │
  │            │ green-     │ endpoints   │ 10 concur.  │ Higgsfield │ SeedVideo-   │
  │            │ screen ref │             │ 600 RPM     │ WaveSpeed  │ Bench        │
  └────────────┴────────────┴─────────────┴─────────────┴────────────┴──────────────┘
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        │            REQUEST ASSEMBLY LAYER              │
                        │  prompt string carrying BOTH:                  │
                        │   · inline text-command flags                  │
                        │     --ratio --resolution --duration            │
                        │     --camerafixed --watermark --seed           │
                        │   · inline reference tokens @Image1 @Video1    │
                        │     @Audio1                                    │
                        │   · inline shot syntax "Shot 1:" / "Cut to"    │
                        │  + JSON fields (JSON wins on conflict)         │
                        │  + Prompt Engineering module (Qwen2.5-14B,     │
                        │    SFT → DPO) rewriting into dense-caption form│
                        └───────────────────────┬───────────────────────┘
                                                │
        ┌───────────────────────────────────────┴──────────────────────────────┐
        │                             MODEL LAYER                                │
        │  CURRENT:  Seedance 2.5 (30s, 50 refs, edit, extend, bridge)           │
        │            Seedance 2.0 · 2.0 Fast · 2.0 Mini  (4–15s, 12 refs)        │
        │  PRIOR:    Seedance 1.5 pro (dual-branch DiT, native A/V joint)        │
        │            Seedance 1.0 pro · 1.0 lite (t2v / i2v model IDs)           │
        │  ADJACENT: Seedream (image) · Seed Audio 1.0 · SeedRealtime ·          │
        │            Seed-TTS / Seed-ASR · Tarsier2 (captioner)                  │
        └────────────────────────────────────────────────────────────────────────┘
```
**[VERIFIED]** for every named surface, model, limit and flag; the grouping into "layers" is analytical framing, not a ByteDance-published diagram. The BytePlus concurrency/RPM figures are from a first-party BytePlus blog post and date from the Seedance 1.0 era.

---

## Model Stack

| Model | Role | Publicly disclosed internals |
|---|---|---|
| **Seedance 1.0** (`seedance-1-0-pro-*`, `seedance-1-0-lite-t2v-250428`, `seedance-1-0-lite-i2v-250428`) | Foundation T2V/I2V; native multi-shot; 5s/10s at 480P/1080P, 24 fps, 6 aspect ratios | **By far the best-documented.** Causal VAE `(4,16,16)`, `C=48`; decoupled spatial/temporal DiT with windowed temporal attention; SD3-style MMDiT fusing text **only in spatial layers**; 3D MM-RoPE over interleaved text/video tokens; **flow matching with velocity prediction** + resolution-aware noise shift; unified T2V/I2V via channel-concatenated clean/zero-padded frames + **binary instruction masks**; cascaded 480p→720p/1080p diffusion refiner. **[VERIFIED — arXiv 2506.09113]** |
| **Seedance 1.5 pro** | First native audio-video joint model; multilingual + dialect lip-sync; "dynamic cinematic camera control"; "enhanced narrative coherence" | **Dual-branch Diffusion Transformer** (MMDiT-based) + **cross-modal joint module**; multi-stage audio-visual data pipeline with captioning for both modalities and curriculum scheduling; SFT + RLHF with multi-dimensional reward models (reported ~3× RLHF training-speed improvement); acceleration framework ">10×" via multi-stage distillation, quantization, parallelism and reduced NFE. **[VERIFIED at abstract/summary level — arXiv 2512.13507 + seed.bytedance.com paper page; section-level internals NOT readable this session]** |
| **Seedance 2.0** (+ **Fast**, + **Mini**) | Four-modality (text/image/audio/video) unified model; **4–15s**, native **480p and 720p**; ≤3 videos + ≤9 images + ≤3 audio (12 files total); binaural stereo, multi-track audio | **Almost nothing disclosed.** Official wording is "a unified, highly efficient, and large-scale architecture for multi-modal audio-video joint generation." No parameter count, no block structure, no NFE, no training or data detail, no infrastructure. Capability taxonomy comes from **SeedVideoBench 2.0**: reference / editing / extension (forward **and** backward) / combination tasks. **[VERIFIED for limits and taxonomy; architecture NOT disclosed]** |
| **Seedance 2.5** | Current flagship. **30s in a single pass**, multi-round extension, **50 reference assets** (30 img + 10 video + 10 audio), timestamp-level editing, local re-draw, green-screen/white-model reference control, camera-perspective editing | Officially only "unified multimodal audio-video joint-generation architecture" inherited from 2.0, plus "systematic optimization of object textures, skin and eye features, lighting, and color saturation." **No technical report exists for 2.5 as of this date.** **[VERIFIED for capability; architecture NOT disclosed]** |
| **Prompt Engineering (PE) module** | Rewrites user prompts into the dense-caption distribution the generator was trained on | **Qwen2.5-14B** base; stage 1 SFT on manually annotated prompt→dense-caption pairs with separate T2V/I2V handling; stage 2 **DPO** on correct/incorrect rephrasing pairs. **[VERIFIED — the only named prompt-rewriter backbone found at any platform]** |
| **Video captioner** | Builds the training captions the whole system depends on | Trained on annotated data **with Tarsier2**; "the visual encoder is frozen and the language model is fully fine-tuned." Caption style deliberately fuses **dynamic features** (actions, camera movements) with **static features** (appearance, aesthetics, style). **[VERIFIED]** |
| **Diffusion refiner (super-resolution)** | 480p base output → 720p/1080p | Separate diffusion model **initialized from the pre-trained base**, conditioned by concatenating the upsampled LR video with noise. Receives its own **pre-training, SFT and RLHF**, with LR VAE latents as conditional input and generated HR videos scored by the reward models. **[VERIFIED]** |
| **Reward models (×3)** | Training-time only | **Foundational RM** — a **Vision-Language Model**, targeting "image-text alignment and structural stability"; **Motion RM** — "mitigate video artifacts while enhancing motion amplitude and vividness"; **Aesthetic RM** — image-space, operating on **keyframes** sampled from videos. Optimization "directly predict[s] x₀" and "directly maximizes the composite rewards from multiple RMs," with "multi-round iterative learning between the diffusion model and RMs." **[VERIFIED]** |
| **Long Context Tuning (LCT)** — research, not a shipped product | ByteDance Seed–affiliated method for scene-level multi-shot consistency | Expands a pre-trained *single-shot* model's context window to a whole scene: **full attention jointly over all text and video tokens in the scene** with no added inductive bias; **interleaved 3D RoPE** giving each shot distinct coordinates while preserving within-shot relative positions, in a `[text]-[video]-[text]-…` pattern; **asynchronous per-shot diffusion timesteps** so lower-noise shots act as visual conditions for noisier ones; optional **context-causal attention** fine-tune enabling **KV-cache autoregressive** shot-by-shot generation. Demonstrated on scenes averaging 5 shots, with emergent compositional generation from separate identity and environment images. **[VERIFIED — arXiv 2503.10589; that this is Seedance's actual multi-shot mechanism is STRONG INFERENCE, not stated anywhere]** |

### Camera & Cinematography Control

Researched specifically. **Seedance has no parametric camera-control API. Camera direction is expressed entirely in prompt language, with exactly one boolean escape hatch.** **[VERIFIED]**

```
  THE ONE PARAMETER                    THE ACTUAL CONTROL SURFACE
  ─────────────────                    ──────────────────────────
  --camerafixed  true|false            free-text cinematographic vocabulary
    true  → frame stays fixed          inside the prompt:
    false → camera movement is           shot size: medium / close-up / wide
            generated per the prompt     moves:     push-in / pull-back / pan /
                                                    tracking / orbit / aerial /
  Official guidance is blunt:                       handheld / follow / surround
  if you are specifying camera          stability: tripod / handheld / gimbal
  movement, you must set                lens hints
  --camerafixed false.
```

Three things make Seedance's camera story distinctive:

- **The camera vocabulary is in the *captions*, by design.** The Seedance 1.0 report states the caption model was trained to fuse "dynamic features" — explicitly including **camera movements** — with static appearance features. Camera language is not a post-hoc prompting convention; it is a trained-in axis of the caption distribution, which is the mechanistic reason prompt-level camera terms work at all. **[VERIFIED]**
- **Camera control was called out as a headline capability at 1.5 pro.** The abstract names "**dynamic cinematic camera control**" as one of three differentiators, alongside multilingual lip-sync and narrative coherence. **[VERIFIED]**
- **2.5 added camera as a *post-hoc edit*.** "Supports camera perspective editing" for shot composition after generation — the same edit-rather-than-regenerate move as Runway's Aleph re-framing and Higgsfield's post-generation look-lock. **[VERIFIED — seed.bytedance.com Seedance 2.5 blog]**

Multi-shot camera direction is done with explicit in-prompt cut markers — **"Cut to," "Camera cut to," "Camera switching," and `Shot 1:` / `Shot 2:` prefixes** — with published guidance to describe the *connection* between shots and to re-describe the new scene after a cut. Guidance also warns against stacking movements: specify **one** camera movement per shot, because combining push, pull, pan and truck "will increase image instability." **[VERIFIED that the syntax works and is officially documented in BytePlus's prompt guide; the specific one-move-per-shot rule reaches this brief through secondary restatements of that guide, since the guide page itself was an unreadable SPA — STRONG INFERENCE]**

**Narrata read.** This is the third platform (after Runway and MiniMax) to converge on *constrained camera vocabulary in the prompt* rather than a camera widget — and the first to explain **why** it works (camera terms are in the training captions). Narrata's `CameraMovement` enum (`STATIC`, `ZOOM_IN`, `ZOOM_OUT`, `PAN_LEFT`, `PAN_RIGHT`, `PAN_UP`, `PAN_DOWN`) is already a closed camera vocabulary, and `preferredCameraMovements` in `VideoModelConfig` already routes on it. The evidenced gaps are (a) `STATIC` should compile to `--camerafixed true` and everything else to `--camerafixed false` when the route lands on a Seedance option — a per-provider serialization detail, not a schema change — and (b) Narrata's enum has no *speed/stability* qualifier, which both Runway and ByteDance treat as mandatory. Route to `ai-architect`.

### Reference-to-Video Conditioning

Researched specifically. This is Seedance's strongest and most rapidly-evolving capability, and the one most directly relevant to Narrata.

```
  SEEDANCE 2.0                              SEEDANCE 2.5
  ────────────                              ────────────
  ≤ 9 images   (≤30 MB each)                ≤ 30 images
  ≤ 3 videos   (2–15s combined, <50 MB,     ≤ 10 videos
                480p–720p)                  ≤ 10 audio
  ≤ 3 audio    (≤15s combined, ≤15 MB)      ─────────────
  ─────────────────────────────────         = 50 reference assets
  HARD CAP: 12 files TOTAL across             in a single pass
            all modalities
                                            plus: green-screen and
  addressed inline:                                "white-model" reference
    @Image1 … @Image9                              control for character
    @Video1 … @Video3                              movement, spatial
    @Audio1 … @Audio3                              location, interactions

  documented reference semantics (fal, mirroring ByteDance's spec):
    @Image → identity          @Video → motion / camera language
    @Audio → rhythm, voice, atmosphere
  capabilities unlocked: stylized generation, style transfer, lip-sync,
    motion transfer, character consistency, multi-scene composition,
    timestamp-based pacing control
```
**[VERIFIED for the 2.5 counts — seed.bytedance.com; VERIFIED for the 2.0 counts and the 12-file cap — arXiv 2604.14148 abstract corroborated by fal; the per-modality *semantics* are from fal's documentation of ByteDance's spec — API-mirror evidence]**

Two structural observations.

**First, and this is the important one: Seedance's `@` is positional, not nominal.** `@Image1` means "the first URL in `image_urls`," not "the character named Maya." There is **no Element Library, no saved reference, no named entity, no lock, no persistence between requests**. Every generation re-uploads its own world. This is the same statelessness the Hailuo/MiniMax brief found — and it means **Narrata's lockable `Character`/`Location` records with `referenceImages` are, again, ahead of a frontier vendor's shipping product on durable identity.** What ByteDance has that Narrata does not is *reference capacity* (50 assets) and *cross-modal* references (video and audio, not just images). **[VERIFIED by absence across seed.bytedance.com, the arXiv abstracts, and every API mirror read]**

**Second, "white-model control" is a genuinely novel conditioning modality worth naming.** A white model (untextured 3D blocking geometry) or a green-screen plate is supplied as a reference video to specify "character movement, spatial location, and interactions" while leaving appearance to the prompt and image references. That is a clean **separation of blocking from look** — closer to a previz pipeline than to a prompt. No other platform in this programme exposes anything equivalent. **[VERIFIED — ByteDance's own Dreamina Seedance 2.5 page. Note the Wikipedia entry records that green-screen fight-choreography reference videos shown on Seedance's site raised questions about how much of the showcased output is generation versus video-to-video transformation — a provenance caveat, not an architecture finding.]**

### Video Extension, Bridging and Long-Duration

Researched specifically. Seedance has the most complete duration story of any platform examined.

```
  TIER 1 — SINGLE PASS
    Seedance 2.0 .......... 4–15s   (480p / 720p native)
    Seedance 2.5 .......... 4–30s   ← longest single-pass generation found
                                      at any frontier platform in this
                                      programme (Kling 15s, MiniMax 15s,
                                      Runway ~1 min multi-shot, Aleph 30s edit)
    within one pass, 2.5 organizes "multiple logically connected shots" with
    "setup, development, turning points, and resolution"   [VERIFIED]

  TIER 2 — MULTI-ROUND EXTENSION
    "smoothly append subsequent shots to existing video outputs" preserving
    "consistency of main characters, environments, and narrative pacing"
    THREE DIRECTIONS:
      forward  — continue past the last frame
      backward — generate the moment before the first frame
      bridge   — generate between two existing clips
    Mechanism (per API mirrors): new segment generated from the input video's
    LAST FRAME + a natural-language prompt, then original and new segment are
    CONCATENATED into a single returned output.
    Aspect ratio is locked to the input video; extension duration is settable.
    [capability VERIFIED — seed.bytedance.com; mechanism STRONG INFERENCE]

  TIER 3 — LONG-VIDEO MODE (beta)
    ~180 seconds, claimed on ByteDance's own Dreamina surface, described as
    holding subject and scene consistency. No technical description exists.
    [claim VERIFIED as a ByteDance claim; mechanism NOT disclosed — HYPOTHESIS]
```

**Two contrasts that matter for Narrata.**

- **Seedance returns the joined clip; Runway returns only the delta.** Runway's extend "output contains only the new footage… and your original video is unchanged," leaving assembly to the user and keeping the extension an independently reviewable asset. Seedance concatenates server-side. Runway's choice is architecturally better for a take-history system like Narrata's, because the extension stays separately regenerable. If Narrata ever routes an extend through Seedance, it will need to **treat the returned concatenation as opaque** or avoid the endpoint in favour of explicit frame-chaining it controls. **[VERIFIED on both sides]**
- **Bridge mode is now the third independent sighting of first-last-frame anchoring**, after KlingAvatar 2.0's keyframe-anchored cascade and Higgsfield's "Bridge" extend mode. Three independent frontier teams converging on *pin both ends, generate the middle* is strong evidence that this is the correct answer to long-form drift — considerably stronger than when the Kling brief first flagged it from one source. **[STRONG INFERENCE, now corroborated three ways]**

### Inference Optimization — the fullest public account in this programme

```
  TRAINING-TIME                            SERVING-TIME
  ─────────────                            ────────────
  flow matching, velocity prediction       TSCD  → ~4× acceleration
  resolution-aware noise shift             + RayFlow score distillation
                                             (ByteDance's own method,
  decoupled spatial/temporal attention        arXiv 2503.07699)
    ⇒ cost grows far more slowly in        ─────────────────────────────
      duration than full 3D attention      thin VAE decoder → 2× decode,
                                             no visual-quality loss
  causal VAE (4,16,16), C=48               kernel fusion → +15% throughput
    ⇒ 4× temporal, 256× spatial            fine-grained MIXED-PRECISION
      token reduction before the DiT         quantization for Attention
      ever runs                              and GEMM specifically
                                           hybrid DATA + SEQUENCE parallelism,
  hybrid sharded data parallel (HSDP)        comms cut to 1/4 of Ulysses
  CPU offload via PyTorch hooks            async offloading, <2% perf drop
  recomputation
                                           ══════════════════════════════
                                           NET: ~10× end-to-end speedup
                                           5s @ 1080p in 41.4s on ONE
                                           NVIDIA L20 (China-export SKU)
```
**[VERIFIED — arXiv 2506.09113 for every item; RayFlow's ByteDance authorship VERIFIED via arXiv 2503.07699; L20's export-compliance status VERIFIED via NVIDIA product-line reporting.]** Seedance 1.5 pro's abstract claims the acceleration framework "boosts inference speed by over 10X," consistent with 1.0's figure, though 1.5's NFE counts were not readable. **No inference-time figures at all have been published for Seedance 2.0 or 2.5** — circulating "30–90 seconds for 5s at 1080p" numbers are secondary-source benchmark blogs and are **HYPOTHESIS**.

The comparison with Kling is instructive and they are *not* the same strategy:

| | **Kling** | **Seedance** |
|---|---|---|
| Headline lever | Step reduction: **150 NFE → 10 NFE** via two-stage distillation | **Layered**: distillation *plus* decoder surgery *plus* kernel/quant/parallelism work |
| Attention | Full spatiotemporal (2024 disclosure) | **Decoupled** spatial/temporal with windowed temporal attention |
| High-res | Cascaded SR with asymmetric attention + KV-cache reuse | Cascaded refiner initialized from the base model, LR-concatenated conditioning |
| Hardware framing | Not disclosed | Benchmarked on **export-throttled L20** |
| Net published claim | 15× step reduction | **~10× end-to-end**, with a wall-clock number |

**[VERIFIED on both columns from their respective technical reports.]**

### Audio / Video Synchronization

**Supported, natively, from Seedance 1.5 pro onward.** **[VERIFIED]**

- **Architecture:** "dual-branch Diffusion Transformer" with a "cross-modal joint module," described as MMDiT-based, enabling "deep cross-modal interaction" across T2VA, I2VA and unimodal tasks. Audio and video emerge from one process rather than one conditioning the other post hoc. **[VERIFIED at abstract/summary level]**
- **Lip sync:** "precise multilingual and dialect lip-syncing" (1.5 pro); frame-level lip-sync alignment (2.0). API convention: **wrap dialogue in quotes in the prompt** to trigger lip-synced speech. **[VERIFIED for the claims; the quoting convention is API-mirror evidence]**
- **Audio content at 2.0:** binaural/two-channel stereo, with simultaneous multi-track output (ambient + music + narration) and frame-level event synchronization (footsteps landing on frame).
- **Evaluation:** SeedVideoBench 1.5 scores audio on prompt adherence, audio quality, **audio-visual synchronization**, and expressiveness — distinct from the video dimensions. **[VERIFIED]**
- **Commercially:** `generate_audio` defaults to `true` and, per fal, "audio generation incurs no extra cost regardless of the `generate_audio` setting." **[VERIFIED at fal — an API mirror]**

**Narrata read.** Narrata generates voice, music and SFX through **separate providers** (ElevenLabs / Sarvam / OpenRouter-Lyria) and assembles them over silent video — an architecture that gives Narrata something no native-audio model offers: **a named, story-wide-consistent voice per character, resolved server-side**. Seedance's native audio would produce a *different, uncontrolled* voice per generation. The correct read is **not** "adopt native audio"; it is that `VideoModelConfig.supportsNativeAudio` should keep defaulting to **off** for narrative work on Seedance routes, and that native audio is interesting only for **ambience and diegetic SFX**, where per-shot variation is harmless and free. That is a concrete, cheap opportunity: free, frame-synchronized SFX on a route Narrata already pays for. Route to `video-architect`.

---

## Generation Pipeline

```mermaid
flowchart TD
    U[User / API client] --> REQ[Request assembly:<br/>prompt string + inline --flags<br/>+ @Image/@Video/@Audio tokens<br/>+ Shot n: / Cut to markers<br/>+ JSON fields JSON wins]

    REQ --> PE[Prompt Engineering module<br/>Qwen2.5-14B, SFT then DPO<br/>rewrite into dense-caption form<br/>separate T2V and I2V handling]

    PE --> TOK[Tokenization:<br/>causal VAE 4,16,16 C=48<br/>interleaved text+video tokens<br/>3D MM-RoPE, per-shot captions]

    REF[(Per-request references:<br/>up to 9 img / 3 vid / 3 aud 2.0<br/>up to 30 / 10 / 10 for 2.5<br/>positional, NOT persisted)] -.->|@Image1 @Video1| REQ

    TOK --> GEN[Base DiT at 480p<br/>decoupled spatial + temporal layers<br/>MMDiT text fusion in SPATIAL only<br/>windowed temporal attention<br/>flow matching, velocity prediction<br/>distilled: TSCD + RayFlow]

    GEN --> TASK{Task form<br/>disambiguated by input shape}
    TASK -->|T2V| V1[zero-padded frames<br/>+ binary instruction mask]
    TASK -->|I2V / first+last frame| V2[clean frames concatenated<br/>on channel dim + mask]
    TASK -->|reference-to-video| V3[multimodal refs bound to<br/>@tokens in the prompt]
    TASK -->|multi-shot| V4[one sequence, per-shot captions<br/>interleaved via MM-RoPE]
    TASK -->|edit / local re-draw 2.5| V5[timestamp-scoped modification]
    TASK -->|extend fwd / back / bridge| V6[conditioned on last or first frame<br/>concatenated server-side]

    V1 --> RF
    V2 --> RF
    V3 --> RF
    V4 --> RF
    V5 --> RF
    V6 --> RF
    RF[Cascaded diffusion refiner<br/>480p to 720p / 1080p<br/>init from pre-trained base<br/>LR video concat with noise<br/>own pre-train + SFT + RLHF]

    RF --> AUD[Joint audio branch 1.5 pro+<br/>dual-branch DiT + cross-modal<br/>joint module; binaural, multi-track<br/>frame-level lip-sync]
    AUD --> DEC[Thin VAE decoder<br/>2x faster, no quality loss]
    DEC --> MOD[Content moderation + watermark<br/>--watermark toggle]
    MOD --> OUT[Async task output URL]
    OUT --> HUM{User review}
    HUM -->|not right| REQ
    HUM -->|fix one element| V5
    HUM -->|continue the story| V6
    HUM -->|accept| DEL[Delivery / CDN]
```

**Evidence note.** Every node from `PE` through `DEC` is **VERIFIED** from the Seedance 1.0 technical report, except: the audio branch (VERIFIED from 1.5 pro's abstract, but its *position* relative to the refiner is **HYPOTHESIS** — no source states the ordering); the edit and extend task forms (VERIFIED as capabilities of 2.0/2.5 from seed.bytedance.com, but that they route through the same base model is **STRONG INFERENCE** from the "unified architecture" framing); and moderation/watermark (VERIFIED that a `--watermark` flag exists; that moderation is a distinct pipeline stage is **STRONG INFERENCE**).

**Critically, the review loop is human.** As with Runway, Kling, MiniMax and Higgsfield, **no automated per-generation quality or continuity critic was found.** ByteDance's three reward models and SeedVideoBench are **training-time and development-time** apparatus respectively. See "Quality Control" below.

### API Request Lifecycle

```
  CLIENT              VOLCANO ENGINE / BYTEPLUS MODELARK            BACKEND
    │                              │                                   │
    ├── Bearer token ─────────────►│                                   │
    │                              │                                   │
    ├── POST /api/v3/contents/ ───►│                                   │
    │        generations/tasks     ├─ validate + quota ───────────────►│
    │                              │  BytePlus defaults (1.0 era):     │
    │   {                          │    10 concurrent tasks / account  │
    │     "model": "seedance-…",   │    600 RPM task creation          │
    │     "content": [             │                                   │
    │       { "type": "text",      │                              ┌────▼────┐
    │         "text": "prompt      │                              │  QUEUE  │
    │           --resolution 1080p │                              └────┬────┘
    │           --duration 10      │                                   │
    │           --ratio 16:9       │                              ┌────▼────┐
    │           --camerafixed false│                              │ GPU pool│
    │           --watermark false  │                              │ L20-    │
    │           --seed 42" },      │                              │ class + │
    │       { "type": "image_url", │                              │ FP8/INT8│
    │         … first_frame }      │                              │ mixed   │
    │     ]                        │                              │ precis. │
    │   }                          │                              │ DP + SP │
    │                              │                              └─────────┘
    │◄── { id / task_id }          │                                   │
    ├── GET  …/tasks/{id} ────────►│   queued → running → succeeded/failed
    │◄── running                   │
    │◄── succeeded { video_url }   │   OR push to callback_url (OpenRouter)
    └──────────────────────────────┘
```

**Two design quirks worth recording, because they are unusual.**

**1. Parameters live inside the prompt string.** Seedance's canonical parameterization is **`--flag value` text commands appended to the prompt text** — `--ratio`, `--resolution`, `--duration`, `--framepersecond`, `--camerafixed`, `--watermark`, `--seed`. Where a broker also exposes a matching JSON field, **the JSON field takes precedence**. No other platform in this programme parameterizes through the prompt string. It is architecturally coherent with the rest of Seedance's design — references are `@`-tokens in the prompt, shot structure is `Shot n:` / `Cut to` in the prompt, camera is vocabulary in the prompt — **Seedance's real interface is the prompt string, and JSON is an overlay on it.** **[VERIFIED that the flags exist and that JSON wins on conflict — first-party BytePlus blog + API mirrors; the "prompt is the real interface" reading is our characterization]**

**2. Brokers disagree about resolution, and one of the disagreements is with ByteDance itself.** Seedance 2.0's own arXiv abstract says "native output resolutions of **480p and 720p**"; fal's reference-to-video page lists 480p/720p/1080p with 1080p on the Standard tier only; OpenRouter exposes 480p/720p for 2.5; ByteDance's **own Dreamina consumer page headlines "4K."** The reconciliation that fits all the evidence: **native generation is 480p, the refiner produces 720p/1080p, and consumer-surface "4K" is a further upscale that is not exposed on the API.** This is the same marketing-drift pattern the Kling brief flagged for "native 4K 60fps" — except here the drift originates on a **first-party** ByteDance surface, which makes it more dangerous, not less. **[Conflict VERIFIED by direct comparison of sources; the reconciliation is STRONG INFERENCE, resting on the report's explicit 480p-base cascade disclosure]**

---

## Orchestration — one model, task disambiguated by input shape

Seedance has **no model router**. Like Kling, and unlike Runway, model selection is explicit and user-facing; there is no cost/latency/quality optimization axis, no allow/deny list, no cross-vendor brokering.

```
                          USER (or broker) CHOOSES, EXPLICITLY
                                        │
    ┌───────────┬────────────┬──────────┴────────┬────────────┬──────────────┐
    ▼           ▼            ▼                   ▼            ▼              ▼
 model ID    endpoint     tier                resolution   duration     generate_audio
 (1.0 lite/  (t2v /       (Pro / Standard /   (480p /      (4–15s 2.0/  (default TRUE,
  pro, 2.0,   i2v /        Fast / Mini)        720p /       4–30s 2.5)   no extra cost)
  2.0-fast,   ref2vid /                        1080p)
  2.0-mini,   extend /
  2.5)        edit)
    │            │             │                   │             │              │
    └────────────┴─────────────┴───────────────────┴─────────────┴──────────────┘
                                        │
                                        ▼
                    ONE UNIFIED MODEL PER VERSION — the task is
                    disambiguated by the SHAPE OF THE INPUT, not
                    by routing. The Seedance 1.0 report states the
                    mechanism literally: noisy inputs are channel-
                    concatenated with clean or zero-padded frames,
                    and BINARY MASKS indicate which frames are
                    "instructions to follow."
                                        │
        ┌───────────┬───────────────────┼──────────────┬──────────────┐
        ▼           ▼                   ▼              ▼              ▼
      T2V     I2V / first+last     ref-to-video    multi-shot    edit / extend
   (zero pad)  (clean frames)      (@-bound refs)  (per-shot     (2.0 / 2.5)
                                                    captions)
```

**[VERIFIED — the binary-mask unified formulation is stated outright in arXiv 2506.09113; the tier/endpoint enumeration is VERIFIED from API mirrors.]**

Two orchestration notes:

- **The tier ladder is the only routing-like surface, and it is unusually wide.** Mini → Fast → Standard → Pro spans roughly **3× in per-second price on OpenRouter** ($0.0336 → $0.1028) with documented capability differences (Fast caps at 720p; Mini caps at 15s/720p; 2.5 alone reaches 30s and 50 references). Like Kling's `std`/`pro`, this is quality-vs-price selection *exposed to the caller*, not decided by the platform.
- **The video-input price multiplier is a routing signal no one else publishes.** fal documents a **0.6× price multiplier when a video reference is supplied** — i.e. video-conditioned generation is *cheaper* per second than text- or image-conditioned generation on the same model. That inverts the intuition (and inverts MiniMax's finding, where reference-heavy conditioning was an order-of-magnitude *cost multiplier*). A cost-aware router cannot assume "more conditioning = more expensive." **[VERIFIED at fal — API-mirror evidence; the dollar figures belong to `monetization-strategist`]**

---

## Continuity System

Seedance attacks continuity at five layers. Unlike Kling, **none of them is a persistent entity store** — every layer is per-request or in-model.

```
 LAYER 1 — IN-MODEL MULTI-SHOT VIA POSITIONAL ENCODING       ★ strongest layer
   3D MM-RoPE over interleaved [text]-[video] token sequences, extended so
   that "shots are organized in the temporal order of actions and EACH SHOT
   HAS ITS OWN DETAILED CAPTION."
   Training data: clips up to 12s that "may contain one or multiple
   temporally coherent shots" — multi-shot is learned from real cut footage,
   not synthesized.
   ⇒ cross-cut continuity is a property of ONE sequence with per-shot
     conditioning, not of stitching or of a continuity check
   [VERIFIED — arXiv 2506.09113]

 LAYER 2 — PER-REQUEST MULTIMODAL REFERENCES (positional, not named)
   2.0: ≤9 img + ≤3 video + ≤3 audio, 12 files total
   2.5: ≤30 img + ≤10 video + ≤10 audio = 50 assets
   Addressed inline as @Image1 / @Video1 / @Audio1.
   Documented division of labour: image → identity, video → motion and
   camera language, audio → rhythm/voice/atmosphere.
   ⇒ continuity as retrieval-into-context, rebuilt from scratch every call
   [counts VERIFIED; per-modality semantics are API-mirror evidence]

 LAYER 3 — FRAME CONDITIONING
   first_frame, and first+last frame, on every current version.
   Extension conditions on the source clip's last frame (forward), first
   frame (backward), or BOTH ENDS (bridge).
   ⇒ the anti-drift primitive; third independent frontier sighting of
     first-last-frame anchoring
   [first/last VERIFIED via OpenRouter + fal; bridge VERIFIED as a
    capability via seed.bytedance.com; mechanism STRONG INFERENCE]

 LAYER 4 — PHYSICAL / BLOCKING CONDITIONING            ★ most novel layer
   "Green screen film or white model references for more precise control of
   character movement, spatial location, and interactions."
   Seedance 2.0's launch framing leads with "Stable Rendering of Complex
   Motions & Interactions, True to Physical Laws."
   ⇒ blocking and staging separated from appearance — previz-shaped, not
     prompt-shaped. No equivalent at any other platform examined.
   [VERIFIED — ByteDance Dreamina page + Seed 2.0 launch blog]

 LAYER 5 — POST-HOC LOCAL REPAIR (2.5 only)
   "Edit specific video regions without regeneration. Refine only the parts
   of a video that need adjustment instead of recreating the entire scene,"
   plus "timestamp-level control for targeted editing of audio and video"
   and camera-perspective editing.
   ⇒ continuity as a repair operation — same family as Runway's Aleph
     edit-and-propagate, but scoped to ONE clip; NO cross-shot propagation
     equivalent was found
   [VERIFIED for the capability; mechanism NOT disclosed]
```

**What is conspicuously absent, and it is the same absence as MiniMax's.** There is **no persistent entity**: no saved character, no named element, no `@name` that survives a request, no lock, no library, no project scope. ByteDance's answer to "make this character the same across twelve shots" is *put more reference images in every single call* — which works, scales to 50 assets, and costs a re-upload every time. **[VERIFIED by absence across seed.bytedance.com, the arXiv abstracts, and OpenRouter/fal/Replicate schemas]**

**And a second, load-bearing absence: ByteDance discloses no architectural mechanism for identity preservation.** Nowhere in the 1.0 report is there an identity embedding, an IP-Adapter-like module, a reference cross-attention path, a face encoder, or an identity loss. References enter the same way everything else does — **as tokens in the shared sequence, bound to `@` markers in the text.** If that is genuinely the whole mechanism, it is an important and slightly startling finding: **Seedance's character consistency may be entirely a function of in-context conditioning plus training data plus RLHF, with no dedicated identity machinery at all.** The Seedance 1.0 report *does* disclose a preservation-specific evaluation dimension (I2V "Preservation": "subject consistency, stylistic coherence, material fidelity"), which shows consistency is *measured* — but measured is not enforced. This mirrors the Kling brief's Layer-5 finding about temporal stability almost exactly. **[STRONG INFERENCE of absence — no such mechanism appears in the one fully-readable report; 1.5/2.0/2.5 internals were not readable, so this cannot be asserted for current versions]**

---

## Probable Hidden Architecture

What ByteDance showed and what it withheld, **by version** — because the answer changes per version, which is itself the finding:

```
  SEEDANCE 1.0 (2025-06)                     SEEDANCE 2.0 / 2.5 (2026)
  ────────────────────────                   ─────────────────────────
  DISCLOSED:                                 DISCLOSED:
    VAE ratios (4,16,16), C=48                 "unified … architecture"
    decoupled spatial/temporal DiT             input/output limits
    MMDiT, text in spatial layers only         capability taxonomy
    3D MM-RoPE, multi-shot extension           SeedVideoBench 2.0 dimensions
    flow matching + velocity pred.             reference/edit/extend counts
    resolution-aware noise shift
    binary-mask unified T2V/I2V              WITHHELD:
    cascaded 480p→720p/1080p refiner           parameter count
    Qwen2.5-14B PE module + DPO                block structure / depth / width
    Tarsier2-based captioner                   NFE, steps, sampler
    3 reward models, multi-round RLHF          whether the 1.0 topology survives
    TSCD + RayFlow distillation                training data, scale, compute
    thin VAE decoder, 2x                       infrastructure, cluster, GPUs
    kernel fusion +15%                         inference latency
    mixed-precision quant (attn + GEMM)        the audio branch's internals
    DP + SP, comms 1/4 of Ulysses              how 30s single-pass is afforded
    HSDP, CPU offload <2% cost                 how the ~180s beta mode works
    41.4s for 5s@1080p on ONE L20              identity-conditioning mechanism

  WITHHELD EVEN AT 1.0:
    parameter count · number of DiT blocks · text-encoder identity for the
    GENERATOR (Qwen2.5-14B is the prompt rewriter, NOT confirmed as the
    generator's text encoder) · training-set size · training compute ·
    cluster topology · the serving stack above the kernel level
```

The most reasonable reading of the current inference stack:

```
      prompt string (flags + @refs + shot markers)
              │
              ▼  Qwen2.5-14B PE module (SFT → DPO) → dense caption
      ┌────────────────────────────────────────────────────────────┐
      │  BASE GENERATOR  —  DiT at 480p, flow matching             │
      │                                                             │
      │  causal VAE latents (4,16,16) C=48  ⊕  text tokens          │
      │      interleaved, 3D MM-RoPE, per-shot captions             │
      │                                                             │
      │  SPATIAL layers  : within-frame attn + MMDiT text fusion    │
      │  TEMPORAL layers : cross-frame attn, WINDOW-PARTITIONED     │
      │                    per frame → global receptive field       │
      │      ⇒ text never enters the temporal path directly         │
      │      ⇒ duration cost grows sub-quadratically vs full 3D     │
      │                                                             │
      │  few-step sampling ← TSCD (≈4×) ← RayFlow score distill.    │
      │  served with: mixed-precision quant on attn+GEMM,           │
      │               data + sequence parallelism (comms ¼ Ulysses),│
      │               async CPU offload (<2%)                        │
      └──────────────────────────┬─────────────────────────────────┘
                                 │ 480p latents
                                 ▼
      ┌────────────────────────────────────────────────────────────┐
      │  CASCADED DIFFUSION REFINER                                 │
      │   initialized FROM THE BASE MODEL                           │
      │   conditioned by concatenating upsampled LR video + noise   │
      │   own pre-train → SFT → RLHF (LR latents in, HR out,        │
      │   HR output scored by the same reward models)               │
      └──────────────────────────┬─────────────────────────────────┘
                                 ▼
      ┌────────────────────────────────────────────────────────────┐
      │  THIN VAE DECODER — narrowed channels, retrained against a  │
      │  FROZEN encoder → 2× decode, no visual-quality loss          │
      └────────────────────────────────────────────────────────────┘
```
**[VERIFIED — arXiv 2506.09113, for Seedance 1.0. Whether any of it survives into 2.0/2.5 is HYPOTHESIS.]**

The elegant part is the **thin decoder**: rather than distilling the whole model harder, ByteDance identified that VAE decoding was a separable serving cost, shrank *only the decoder*, and retrained it against a frozen encoder so the latent space — and therefore the entire trained generator — was untouched. It is a surgical optimization of a component nobody else discusses, and it is the sort of move that only shows up when you are optimizing under a hardware ceiling.

**The strongest hypothesis in this brief, stated as such: Seedance's native multi-shot is LCT or a descendant of it.** *Long Context Tuning* (arXiv 2503.10589) is authored by ByteDance Seed staff including **Lu Jiang**, who leads ByteDance's video-generation work, and was published three months before Seedance 1.0. It solves exactly the problem Seedance 1.0 claims natively ("coherent multi-shot storytelling with stable view transitions while maintaining consistent subject representation"), using exactly the primitive Seedance 1.0 discloses (**interleaved 3D RoPE with per-shot text**). LCT adds two mechanisms Seedance's report does not mention: **asynchronous per-shot diffusion timesteps** (so already-clean shots condition still-noisy ones, giving joint *and* sequential generation from one model) and an optional **context-causal attention** fine-tune enabling KV-cached autoregressive shot-by-shot generation. **Neither ByteDance report cites LCT as the mechanism, and no source connects them. [HYPOTHESIS — but a well-supported one, and the most useful architectural idea in this brief for Narrata's purposes.]**

---

## Quality Control — what exists, and what does not

The user asked specifically about a "generation → evaluation → retry → best-result selection" pipeline. **Researched directly. It exists — entirely at training time.**

```
  TRAINING TIME (rich, VERIFIED)          RUNTIME (essentially absent)
  ──────────────────────────────          ────────────────────────────
  3 reward models:                        content moderation
    Foundational RM (a VLM)                 (failure mode, not a quality gate)
      "image-text alignment and            --watermark toggle
       structural stability"               ───────────────────────────
    Motion RM                              NOT FOUND, anywhere:
      "mitigate video artifacts while        · best-of-N candidate generation
       enhancing motion amplitude            · reward-guided sampling
       and vividness"                        · any PASS/REGENERATE decision
    Aesthetic RM                             · any candidate-selection param
      image-space, on KEYFRAMES              · any quality score in the response
                                             · any automatic retry
  Feedback learning:                         · any continuity check
    "directly predict x0"
    "directly maximizes the composite      The only loop is the HUMAN one:
     rewards from multiple RMs"            look at it, change the prompt,
    "multi-round iterative learning        regenerate — or use 2.5's local
     between the diffusion model and RMs"  re-draw to repair one element.
  Applied to the REFINER too, not just
  the base model.

  DEVELOPMENT TIME (VERIFIED)
  ───────────────────────────
  SeedVideoBench 1.0 → 1.5 → 2.0
    300 prompts each T2V / I2V
    evaluated by FILM DIRECTOR EXPERTS
    5-point Likert (absolute) + Good-Same-Bad (pairwise)
    video dims: Motion Quality (structural accuracy, motion plausibility,
                  motion stability, motion vividness)
                Prompt Following (action responsiveness, subject description
                  fidelity, stylistic conformity)
                Aesthetic Quality (visual texture, PERCEPTIBILITY OF AI SENSE,
                  material detail fidelity)
                Preservation, I2V only (subject consistency, stylistic
                  coherence, material fidelity)
    audio dims (1.5+): prompt adherence, audio quality, AUDIO-VISUAL SYNC,
                  expressiveness
    2.0 task taxonomy: reference / editing / extension (fwd + back) /
                  combination
```
**[Training- and development-time apparatus VERIFIED — arXiv 2506.09113 + 2512.13507/2604.14148 summaries. Runtime absence is STRONG INFERENCE, from the reports, the OpenRouter/fal/Replicate schemas, and the total absence of any candidate or scoring parameter.]**

**This is now five for five.** Runway: none found. Kling: a development benchmark (OmniVideo-1.0) with no runtime gate. MiniMax: no benchmark disclosed at all, continuity as human doctrine. Higgsfield: an automated evaluator that scores *virality*, not correctness. ByteDance: the most rigorous evaluation apparatus of any of them — **and none of it runs when a user presses generate.** The conclusion recorded in the Hailuo brief stands and strengthens: **a runtime quality/continuity critic is an open industry gap, and Narrata's missing video/voice/music validation stage is a differentiation surface rather than catch-up work.**

**One correction to the standing framing, from repository state.** The agent brief's premise that "nothing analogous to `IMAGE_VALIDATION` exists yet for video" is **now out of date**. `apps/web/src/lib/scene-video.ts` contains `checkSegmentFrozen()`, a **deterministic, advisory** video QC: for any shot whose `CameraMovement` is not `STATIC`, it probes clip duration and ffmpeg-detected frozen seconds, and flags the segment when frozen time reaches `FREEZE_FLAG_FRACTION` (0.6) of duration — catching "the model likely just returned the starting image with a codec wrapper around it, the most common image-to-video failure mode." It is explicitly advisory (`qcPassed: boolean | null`, never blocking) and persisted per-`Asset` alongside `qcNotes`. So Narrata already has **tier 1** of a video critic. What it does not have is the **model-based** tier — prompt adherence, identity drift, continuity against the Story Bible. Seedance's SeedVideoBench dimension list is, notably, a **ready-made rubric** for exactly that tier.

**Narrata read.** SeedVideoBench's four video dimensions, decomposed into their named sub-criteria and evaluated by film directors, are the most rigorous public rubric for video quality found in this programme. They map almost directly onto what a Narrata video critic would need to score, and they arrive pre-validated by a frontier lab. Handing `video-architect` a rubric is considerably more useful than handing it "build a critic." One dimension in particular is worth stealing verbatim: **"perceptibility of AI sense."**

---

## Infrastructure

| Signal | Evidence |
|---|---|
| **Hybrid data + sequence parallelism**, with communication overhead "reduced to a quarter of the level observed in Ulysses" | **[VERIFIED — arXiv 2506.09113]** |
| **Hybrid Sharded Data Parallelism (HSDP)** for memory-efficient weight sharding; CPU offloading via **PyTorch hooks**; recomputation; async offloading at "<2%" performance cost | **[VERIFIED]** |
| **Fine-grained mixed-precision quantization "tailored for Attention and Gemm operations"** (not blanket quantization) | **[VERIFIED]** |
| **Kernel fusion → "a cumulative 15% improvement in inference throughput"** | **[VERIFIED]** |
| **TSCD (≈4×) + RayFlow score distillation → ~10× end-to-end**; thin VAE decoder → **2× decode** | **[VERIFIED]** |
| **5s @ 1080p in 41.4s on a single NVIDIA L20** | **[VERIFIED]** — and the L20 is NVIDIA's **China-export-compliant** Ada SKU (AD102, 48 GB, 864 GB/s, ~59.8 TFLOPS FP32, 275 W, configured under the 4,800 TPP threshold) **[VERIFIED via NVIDIA product-line reporting]**. That ByteDance optimizes for and benchmarks on export-restricted silicon is **[STRONG INFERENCE]** with real cost implications |
| Async create→poll task API; bearer-token auth; per-model endpoints; `callback_url` webhooks (exposed via OpenRouter) | **[VERIFIED — first-party BytePlus blog + OpenRouter model page]** |
| **BytePlus default quotas (Seedance 1.0 era): 10 concurrent tasks per account, 600 RPM for task creation, 2M free tokens per account ID** | **[VERIFIED — first-party BytePlus blog]** |
| Token-based billing: `tokens = (width × height × fps × duration) / 1024`; BytePlus quoted $0.0025/1K tokens for 1.0-lite; fal quotes $0.014/1K for 2.0 and $0.0214/1K for 2.5 | **[VERIFIED as published formulas; the dollar figures belong to `monetization-strategist` / `market-intelligence`]** |
| Regional API split — `ark.ap-southeast.bytepluses.com` (BytePlus, international) vs Volcano Engine (China) | **[VERIFIED — endpoint hostname]**; that this is a data-residency/regulatory split is **[STRONG INFERENCE]** |
| GPU fleet size, cluster topology, scheduler, orchestration layer, storage/CDN stack, serving runtime | **NOT VERIFIABLE.** No public disclosure found. The 1.0 report covers kernels, quantization and parallelism — never the serving fabric above them. Chinese-language sources inaccessible this session. |
| Copyright actions from Disney, Paramount Skydance and the MPA following Seedance 2.0's release; ByteDance's 2026-02-16 response committing to "strengthen the safeguards used to prevent the violation of intellectual property rights"; US Senate calls for shutdown | **Business/legal intelligence — belongs to `market-intelligence`, not reasoned about here.** Flagged only because it is a **provider-continuity risk** on any route Narrata might add. |
| Seedance's presence as a brokered model inside **Runway** (Seedance 2.5 powers Runway's Generative Extend) and **Higgsfield** | **[VERIFIED — cross-referenced from this repo's `runway.md` and `higgsfield.md`]**. Competitive-structure implications belong to `market-intelligence` |

---

## UX Architecture

Seedance's user-facing surfaces are split across ByteDance's own consumer apps and a developer API, with no unified "studio" of the Runway/Higgsfield kind.

**Consumer:** **Doubao** (ByteDance's assistant app, where video generation is one capability among many) and **Jimeng / Dreamina** (the CapCut-adjacent creation tool, and the surface where the richest Seedance features land first — 30s clips, the beta ~180s long-video mode, local region editing, green-screen and white-model reference control). **Developer:** Volcano Engine (China) and BytePlus ModelArk (international), plus very wide third-party distribution (OpenRouter, fal, Replicate, WaveSpeed, Segmind, and embedded inside Runway and Higgsfield).

Four UX patterns stand out:

- **The prompt string is the entire interface.** Parameters (`--resolution`), references (`@Image1`), shot structure (`Shot 1:`, `Cut to`), camera language, and dialogue (quoted, for lip-sync) all live in one text field. This is the most extreme version of the "collapse control surfaces into prompts" pattern the Runway brief identified — and it directly contradicts Higgsfield's expansion into parametric widgets. Seedance resolves the tension the same way Higgsfield's notation layer does, but from the opposite direction: **rather than compiling widgets down into prompt tokens, Seedance never builds the widgets.**
- **Local re-draw as the default repair.** "Edit specific video regions without regeneration. Refine only the parts of a video that need adjustment instead of recreating the entire scene." Combined with timestamp-level targeting, this makes *partial repair* — not regeneration — the primary correction verb.
- **Blocking references as a pro affordance.** Offering green-screen plates and untextured "white model" geometry as conditioning inputs is a previz-literate feature that assumes a user who thinks in staging, not in prompts. It is the most production-pipeline-shaped feature found at any platform in this programme.
- **Extension framed narratively, not mechanically.** ByteDance describes 2.5 as organizing "setup, development, turning points, and resolution" inside 30 seconds, and extension as preserving "narrative pacing." The vocabulary is dramaturgical rather than technical — which is exactly the register Narrata's product operates in.

Route the interaction-pattern implications (prompt-as-interface vs. structured builder; partial repair as the default correction verb) to `ui-ux-engineer`.

---

## How Seedance Could Fit Narrata's Model Router

This section is grounded in repository state, not generic advice.

**What is already true in Narrata's code:**
- `apps/web/src/lib/ai/openrouter.ts` → `generateVideo()` POSTs to `https://openrouter.ai/api/v1/videos` with `model`, `prompt`, `duration`, `generate_audio`, `resolution`, `frame_images` (`first_frame` / `last_frame`) and `input_references`. **This is, field for field, the shape OpenRouter exposes for Seedance.**
- That file's own comment already cites Seedance as the design source: *"Confirmed via OpenRouter's own video-generation docs and Seedance 2.5's model page (up to 50 image/video/audio reference assets under 'Omni Reference mode')."* The `input_references` path was built against Seedance's spec.
- `apps/web/src/lib/video-model-config.ts` → `VideoModelConfig` already carries `durationMode` (`fixed` | `range`), `fixedDurations`, `min/maxDurationSeconds`, `resolutions`, `supportsNativeAudio`, `supportsLastFrame`, and `preferredCameraMovements`.
- `apps/web/src/lib/scene-video.ts` → `resolvePairModel()` already routes **per shot pair**: manual `Shot.videoModelId` override → `CameraMovement` rule → scene-level fallback.
- `apps/web/src/lib/video-segmentation.ts` → `planVideoSegments()` already snaps a target duration onto a model's fixed or range duration profile.

**What Seedance would slot into, with no new architecture:**

| `VideoModelConfig` field | Seedance 2.5 | Seedance 2.0 | Seedance 2.0 Fast | Seedance 2.0 Mini |
|---|---|---|---|---|
| `durationMode` | `range` | `range` | `range` | `range` |
| `min/maxDurationSeconds` | 4 / **30** | 4 / 15 | 4 / 15 | 4 / 15 |
| `resolutions` | `["480p","720p"]` | `["480p","720p"]` | `["480p","720p"]` | `["480p","720p"]` |
| `supportsNativeAudio` | true (**recommend leaving off** — see Audio section) | true | true | true |
| `supportsLastFrame` | **true** | **true** | **true** | **true** |
| OpenRouter slug | `bytedance/seedance-2.5` | `bytedance/seedance-2.0` | `bytedance/seedance-2.0-fast` | `bytedance/seedance-2.0-mini` |
| from-price (OpenRouter) | $0.1028/s | $0.06726/s | $0.04035/s | $0.03363/s |

**[VERIFIED — repository state for the schema; OpenRouter model pages for slugs, limits and from-prices. Every value above should be re-verified live before an admin enters it, because provider pages drift and `AiModelOption.config` is admin-entered.]**

**Three router extensions the Seedance evidence actually justifies** — all framed as extensions to the existing registry, and all decisions belonging to `video-architect`:

1. **A *duration-capability* routing dimension, not just duration snapping.** Narrata's `planVideoSegments()` snaps a target onto a model's profile; it does not *choose* a model because of the target. Seedance 2.5's 30-second ceiling is double every other frontier model's, which makes "this shot pair needs a long continuous take" a genuine routing input rather than a segmentation input. This is the single clearest new dimension the research supports.
2. **A *reference-budget* routing dimension.** `VideoModelConfig` has no field for how many `input_references` a model accepts, yet Narrata already sends them and the spread across vendors is enormous (Seedance 2.5: 50; Seedance 2.0: 12 total across modalities; MiniMax S2V-01: exactly 1). A shot carrying a locked `Character` **and** a locked `Location` **and** a prop reference will silently over-send on most routes. This corroborates the Hailuo brief's recommendation to replace the parameter map with a **capability matrix carrying limits and exclusion rules**, and adds a concrete second data point.
3. **A *draft/final* tier axis.** The 3× per-second spread between `seedance-2.0-mini` and `seedance-2.5` at OpenRouter, on a single vendor with a consistent API shape, makes deferred-resolution/deferred-quality (draft cheap → review → re-run keepers expensive) unusually easy to implement: **same call site, same parameters, different registry row.** This is the Hailuo brief's deferred-resolution recommendation, now available inside one vendor family rather than across vendors.

**One thing the evidence does *not* justify:** building a `MASTER_AI`-style orchestrator to exploit Seedance's multi-shot. Seedance's multi-shot lives *inside a single generation* and is driven by in-prompt `Shot n:` / `Cut to` markers — it is a **prompt-assembly** capability, reachable from `SHOT_PLANNING` and `MOTION_PROMPT_DRAFTING` outputs, not an orchestration capability. Consistent with the recorded sequencing decision, this is a per-stage improvement, not an argument for a top-level orchestrator.

---

## What Narrata Should Adopt (evidence-based, not exhaustive)

- **Add the Seedance family to the `AiModelOption` registry as a cost/duration tier ladder — this is a registry-row change, not a build.** Four models, one API shape, a 3× price spread, `first_frame`+`last_frame` support on all of them, and a 30-second ceiling at the top end that no other vendor matches. Narrata's `generateVideo()` already emits exactly the right request. **[VERIFIED — route to `video-architect`]**
- **Steal SeedVideoBench's rubric for the model-based half of Narrata's video critic.** Narrata already has the deterministic half (`checkSegmentFrozen`). The missing half needs a scoring schema, and ByteDance has published one validated by film directors: **Motion Quality** (structural accuracy / motion plausibility / motion stability / motion vividness), **Prompt Following** (action responsiveness / subject description fidelity / stylistic conformity), **Aesthetic Quality** (visual texture / *perceptibility of AI sense* / material detail fidelity), **Preservation** (subject consistency / stylistic coherence / material fidelity). A vision-model call scoring these four axes against the shot's prompt and the locked `Character`/`Location` references would produce exactly the PASS / REGENERATE / PARTIAL-REPAIR / USER-REVIEW signal Narrata lacks — and `IMAGE_VALIDATION`'s existing result shape is the obvious template. **[Rubric VERIFIED; the application is our recommendation — route to `video-architect`]**
- **Compile `CameraMovement` per-provider rather than emitting prose.** `STATIC` → `--camerafixed true`; every other value → `--camerafixed false` plus the movement term. Add a **speed/stability qualifier** to the camera vocabulary, which both Runway and ByteDance treat as mandatory and which Narrata's enum currently lacks. Seedance also supplies the *reason* this works — camera terms are baked into the training captions — which raises confidence that a closed vocabulary beats free-written camera prose. **[VERIFIED — route to `ai-architect`]**
- **Express multi-shot intent in the prompt as structure, where the route supports it.** `Shot 1:` / `Shot 2:` / `Cut to` with per-shot descriptions, and per-shot captions that fuse dynamic (action, camera) with static (appearance, style) features — which is precisely the caption style Seedance was trained on. For a Narrata scene whose shots are short and continuous, this is potentially **one call instead of N**, with cut continuity handled in-model. That is both a quality and a cost lever. Note the countervailing constraint: it forfeits per-shot take history, so it suits *scene-level* generation, not shot-level iteration. **[Syntax VERIFIED; the tradeoff is our analysis — route to `ai-architect` and `video-architect`]**
- **Treat first-last-frame anchoring as the preferred long-form primitive, now on three independent confirmations.** KlingAvatar 2.0's keyframe-anchored cascade, Higgsfield's Bridge mode, and Seedance 2.5's bridge extension all pin both endpoints and generate the middle. Narrata's `chainNextFrame` loop currently chains *forward* from its own last frame and accumulates drift; because Narrata's Image→Video mode **already has both endpoint images** (consecutive shot stills), bridge-shaped generation is available essentially for free — `supportsLastFrame` is already in `VideoModelConfig` and `frame_images` already carries `last_frame`. The evidenced change is to prefer both-ends conditioning over forward chaining wherever a pair has two stills. **[Pattern VERIFIED three ways — route to `video-architect`]**
- **Use free native audio for ambience and SFX only, never for character voice.** `generate_audio` defaults true at no extra cost on Seedance routes. Narrata's server-side voice resolution exists precisely to keep a character's voice constant across a story; a native-audio model would re-invent it per clip. But frame-synchronized diegetic SFX and room tone are exactly the class of audio where per-shot variation is harmless — and Narrata currently pays ElevenLabs for some of it. **[VERIFIED that audio is free and joint; the split recommendation is ours — route to `video-architect`]**

## What Narrata Should Avoid / Not Chase Yet

- **Do not treat "4K" or "1080p native" as a Seedance capability.** ByteDance's own report says the base model generates **480p** and a refiner upscales; the 2.0 abstract says native output is **480p and 720p**; OpenRouter exposes 480p/720p. The "4K" on ByteDance's Dreamina page is a consumer-surface claim not reachable through any API Narrata uses. Entering `"4k"` into an `AiModelOption` config would produce silent failures or silent downgrades.
- **Do not adopt Seedance's reference model over Narrata's entity model.** Fifty per-request positional references are a *capacity* advantage, not an *architecture* advantage. `@Image1` has no identity; `Character.referenceImages` with `isLocked` does. The right move is to use Seedance's capacity to send *more* of Narrata's already-structured references, not to flatten Narrata's entities into positional slots.
- **Do not route extension through Seedance's server-side concatenation.** It returns original + new joined into one asset, destroying the independently-regenerable-take property that Narrata's take history depends on (and that Runway deliberately preserves by returning only the delta). If extend-like behaviour is wanted, drive it from Narrata's own frame-chaining, which already controls the seam.
- **Do not assume a technical report will exist for the next version.** ByteDance disclosed richly at 1.0, less at 1.5, and effectively nothing at 2.0 — while shipping its biggest capability jumps. Any Seedance-derived architectural assumption should be dated to 1.0 and treated as possibly stale for the models Narrata would actually call.
- **Do not treat a single vendor's price advantage as strategy.** Seedance's per-second pricing is attractive partly because of genuine efficiency engineering and partly because of factors — hardware constraints, regional positioning, an active IP dispute with major US studios — that are not Narrata's to reason about. The pricing and provider-risk analysis belongs to `market-intelligence` and `monetization-strategist`; the architectural read here is only that **provider-agnosticism in `AiModelOption` is worth protecting**, because this particular provider carries non-technical risk.

---

## What Could Not Be Verified

- **Whether Seedance 1.0's disclosed architecture survives into 2.0 / 2.5.** This is the largest unknown in the brief. Every concrete architectural fact here — decoupled attention, the VAE ratios, flow matching, MM-RoPE multi-shot, the cascaded refiner, the Qwen2.5-14B PE module — is from the **June 2025** report. The 2.0 report discloses no architecture at all, and 2.5 has no report. It is entirely possible the 2.x line is a substantially different model.
- **Seedance 1.5 pro's and 2.0's section-level internals.** Neither has an arXiv HTML rendering (`/html/…v1` 404s; ar5iv reports a fatal conversion error), and the PDFs could not be parsed in this environment (no local PDF renderer). Findings for these versions rest on abstracts plus official Seed and HuggingFace paper-page summaries. **A machine with `poppler-utils` would resolve this immediately — it is the single cheapest open lead in this brief.**
- **Parameter count, DiT depth/width, number of denoising steps, and the sampler** — for every version.
- **The generator's text encoder.** Qwen2.5-14B is VERIFIED as the *prompt-rewriting* model. Whether it, or something else, encodes text for the generator is **not disclosed** and must not be conflated.
- **Any identity-conditioning mechanism.** No identity embedding, adapter, reference cross-attention, face encoder or identity loss is described anywhere readable. Whether character consistency is purely in-context conditioning + data + RLHF, or whether undisclosed machinery exists, is unresolved — and it is the most important unknown for Narrata's purposes, exactly as it was in the Kling brief.
- **Whether LCT is Seedance's multi-shot mechanism.** Strong circumstantial case (shared authorship, shared primitive, three-month lead time, exactly matching capability claim); zero direct evidence. **HYPOTHESIS.**
- **How 30-second single-pass generation is afforded**, and how the ~180-second beta long-video mode works. Decoupled attention is the obvious candidate explanation for the former; nothing explains the latter.
- **The extension mechanism.** "Generated from the last frame, then concatenated" comes from API mirrors and secondary guides, not from ByteDance. Whether bridge mode conditions on both endpoints simultaneously or runs two passes is unknown.
- **Audio-branch internals.** "Dual-branch DiT with a cross-modal joint module" is the entire public description. No audio VAE spec, no sample rate, no channel/latent-rate figures (contrast MiniMax, which publishes both).
- **Whether any runtime quality gate exists.** Absence of evidence, not evidence of absence — though five platforms now show the same absence.
- **Inference latency for 2.0 / 2.5.** Only the 1.0 figure (41.4s, 5s@1080p, L20) is first-party. Circulating "30–90s" figures are secondary benchmark blogs. **HYPOTHESIS.**
- **Serving infrastructure above the kernel level**: cluster size, GPU counts and models in production (the L20 figure is a *benchmark*, not a disclosed production fleet), scheduler, orchestration, storage, CDN.
- **Chinese-language primary sources.** `docs.volcengine.com/docs/82379/*` returned empty content; no ByteDance Chinese engineering blog material was reachable. If reference injection, the audio architecture, or 2.x internals are documented publicly anywhere, that is the most likely place. **Top open research lead**, same as in the Kling brief.
- **`docs.byteplus.com/en/docs/ModelArk/*` could not be read directly** (client-rendered SPA — five distinct pages returned only navigation shells). Every API-parameter fact here rests on a first-party BytePlus *blog* post plus fal/OpenRouter/Replicate mirrors, and must be re-verified live before integration.
- **Date precision.** Seedance 2.0's China release is variously "early February 2026" (its own abstract), 2026-02-12 (Seed launch blog) and "February 2026" (Wikipedia); its arXiv report post-dates release by two months. Treat release dates as ±1 week and remember that **report date ≠ release date** for this vendor.

---

## Sources

**Primary (ByteDance / ByteDance Seed official):**
- [Seedance 1.0: Exploring the Boundaries of Video Generation Models — arXiv 2506.09113](https://arxiv.org/abs/2506.09113) · [HTML v1](https://arxiv.org/html/2506.09113v1) · [HTML v2](https://arxiv.org/html/2506.09113v2) — *the single most important source in this brief; source for the VAE ratios, decoupled attention, MMDiT, MM-RoPE multi-shot, flow matching, binary-mask unified T2V/I2V, cascaded refiner, Qwen2.5-14B PE module, Tarsier2 captioner, the three reward models, TSCD + RayFlow, thin VAE decoder, the parallelism/quantization/offload stack, the 41.4s L20 figure, and SeedVideoBench 1.0*
- [Seedance 1.5 pro: A Native Audio-Visual Joint Generation Foundation Model — arXiv 2512.13507](https://arxiv.org/abs/2512.13507) *(abstract read; no HTML rendering available)* · [ByteDance Seed paper page](https://seed.bytedance.com/en/public_papers/seedance-1-5-pro-a-native-audio-visual-joint-generation-foundation-model) · [HuggingFace paper page](https://huggingface.co/papers/2512.13507)
- [Seedance 2.0: Advancing Video Generation for World Complexity — arXiv 2604.14148](https://arxiv.org/abs/2604.14148) *(abstract read; no HTML rendering available)* · [HuggingFace paper page](https://huggingface.co/papers/2604.14148) · [alphaXiv page](https://www.alphaxiv.org/abs/2604.14148)
- [Long Context Tuning for Video Generation — arXiv 2503.10589](https://arxiv.org/abs/2503.10589) · [HTML full text](https://arxiv.org/html/2503.10589v1) — *ByteDance Seed–affiliated (Ceyuan Yang, Ziyan Yang, Zhibei Ma, Zhijie Lin, Lu Jiang, all ByteDance Seed; Zhenheng Yang, ByteDance); source for interleaved 3D RoPE, asynchronous per-shot timesteps, and context-causal KV-cached autoregressive shot generation*
- [RayFlow: Instance-Aware Diffusion Acceleration via Adaptive Flow Trajectories — arXiv 2503.07699](https://arxiv.org/abs/2503.07699) — *ByteDance; the score-distillation method Seedance 1.0 names*
- [ByteDance Seed — Seedance 1.0 product page](https://seed.bytedance.com/en/seedance)
- [ByteDance Seed — Seedance 2.0 product page](https://seed.bytedance.com/en/seedance2_0)
- [ByteDance Seed — Seedance 2.5 product page](https://seed.bytedance.com/en/seedance2_5)
- [ByteDance Seed Blog — Official Launch of Seedance 2.0](https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0) (2026-02-12)
- [ByteDance Seed Blog — One-Take Creation, Flexible Referencing: Introducing Seedance 2.5](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5) (2026-07-31) — *source for the 30s single pass, 30 img + 10 video + 10 audio references, multi-round extension, timestamp-level editing, camera-perspective editing*
- [Dreamina (CapCut / ByteDance) — Seedance 2.5](https://dreamina.capcut.com/seedance/seedance-2-5) — *first-party consumer surface; source for the "4K" and ~180s beta long-video claims, and for green-screen / white-model reference control*
- [BytePlus Blog — Seedance 1.0 Pro Explained: What It Is and How to Use the Video Generation API](https://www.byteplus.com/en/blog/seedance-1-0-pro-guide-api-pricing) — *first-party; the only readable BytePlus source for model IDs, the `ark.ap-southeast.bytepluses.com/api/v3` endpoint, the `--flag` text commands, and the 10-concurrent / 600-RPM / 2M-free-token quotas*
- [BytePlus ModelArk — API and prompt-guide documentation root](https://docs.byteplus.com/en/docs/ModelArk/1099455) *(SPA; pages 1520757, 1330310, 1366799, 2222480, 2607688 all returned navigation shells only)*
- [Volcano Engine — video generation API docs](https://docs.volcengine.com/docs/82379/1520757) *(returned empty content; Chinese-language, not readable this session)*

**API-surface mirrors (used only for request-parameter facts, since the official docs SPAs were unreadable):**
- [OpenRouter — Seedance 2.5](https://openrouter.ai/bytedance/seedance-2.5) · [Seedance 2.0](https://openrouter.ai/bytedance/seedance-2.0) · [Seedance 2.0 Fast](https://openrouter.ai/bytedance/seedance-2.0-fast) · [Seedance 2.0 Mini](https://openrouter.ai/bytedance/seedance-2.0-mini) · [Video model collection](https://openrouter.ai/collections/video-models) — *most load-bearing mirror in this brief, because OpenRouter is Narrata's actual provider*
- [fal.ai — `fal-ai/seedance-2.0-api` (GitHub)](https://github.com/fal-ai/seedance-2.0-api) — *full parameter tables for t2v / i2v / reference-to-video, the 12-file cap, the 0.6× video-input multiplier*
- [fal.ai — Seedance 2.0 Reference-to-Video](https://fal.ai/models/bytedance/seedance-2.0/reference-to-video) — *`@Image1`/`@Video1`/`@Audio1` semantics, capability list, tier resolution caps*
- [fal.ai — Seedance 2.5 Text-to-Video](https://fal.ai/models/bytedance/seedance-2.5/text-to-video) — *4–30s duration range, quoted-dialogue lip-sync convention*
- [fal.ai — Seedance 1.0 Pro Text-to-Video](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/text-to-video)
- [Replicate — bytedance/seedance-1-pro](https://replicate.com/bytedance/seedance-1-pro)
- [AI/ML API — Seedance 1.0 Lite (Text-to-Video)](https://docs.aimlapi.com/api-references/video-models/bytedance/seedance-1.0-lite-text-to-video)

**Reference / context:**
- [Wikipedia — Seedance 2.0](https://en.wikipedia.org/wiki/Seedance_2.0) (version timeline; the green-screen-reference provenance caveat; the "50 multimodal references" and 3-minute long-video figures)
- [NVIDIA L20 specification and export-compliance context](https://flopper.io/gpu/nvidia-l20-48gb) · [NVIDIA's China product line and the 4,800 TPP threshold](https://www.guru3d.com/story/nvidia-introduces-new-product-line-for-china-adhering-to-us-export-regulations/)
- This repository's own [`runway.md`](./runway.md) and [`higgsfield.md`](./higgsfield.md) — both independently confirm Seedance 2.0/2.5 is brokered inside competitor platforms, and `runway.md` confirms Seedance 2.5 powers Runway's Generative Extend

**Business / legal intelligence — noted and routed to `market-intelligence`, not used for any architectural claim:**
- Copyright actions and correspondence from Disney, Paramount Skydance and the Motion Picture Association following Seedance 2.0's release; ByteDance's 2026-02-16 response; US Senate calls for shutdown (per the Wikipedia entry's cited correspondence and news reporting)
- All per-second and per-token pricing figures in this brief (BytePlus $0.0025/1K tokens; fal $0.014–$0.0214/1K tokens, $0.24–$0.47/s; OpenRouter $0.0336–$0.1028/s) — recorded as **cost-architecture inputs only**; unit economics belong to `monetization-strategist`

**Secondary — consulted, explicitly NOT used for any VERIFIED claim:**
- hedra.com, mindstudio.ai, imagine.art, digitalapplied.com, layer3labs.io, kie.ai, magichour.ai, invideo.io, wavespeed.ai, promeai.pro, seedance2.so, apiyi.com, kingy.ai, leadde.ai, evolink.ai, morphic.com, pixo.video, orcarouter.ai Seedance guides, reviews and benchmark posts. These are the origin of the unverified 2.x latency figures and of several precise-sounding architectural sentences (notably "DB-DiT enabling phoneme-level lip synchronization") that **do not appear in any ByteDance source** — the same failure mode recorded in the Kling brief ("native 4K 60fps") and the Hailuo brief ("physics architecture" sentence).

---

## Relevant to Narrata — closing

- **Seedance is the first platform in this programme that Narrata can act on without building anything.** Four models, already on OpenRouter, already matching the request shape `generateVideo()` emits, already cited in Narrata's own source comments as the design reference for `input_references`. Adding them is registry rows plus live verification of the config table above. The 30-second ceiling on 2.5 and the $0.0336/s floor on 2.0-mini are the two facts most likely to change routing decisions.
- **The decoupled-attention finding reframes what "long" costs.** Kling, MiniMax and Runway all cap general generation at 15s–1min; Seedance ships 30s single-pass and claims a ~3-minute beta. The disclosed reason is plausible and structural — text never enters the temporal attention path, and temporal attention is window-partitioned rather than full — which means duration is *architecturally* cheaper here than at competitors, not just commercially discounted. For a long-form storytelling product, that is the most strategically relevant technical fact in the brief. **[Topology VERIFIED; the cost-of-length inference is ours]**
- **Three independent confirmations now support first-last-frame anchoring over forward chaining.** KlingAvatar 2.0, Higgsfield Bridge, Seedance 2.5 bridge. Narrata's Image→Video mode *already holds both endpoint stills* for every shot pair and already has `supportsLastFrame` plumbed. The gap between current forward-chaining (`chainNextFrame`) and both-ends conditioning is small, and the evidence for closing it is now three-deep. This is the highest-confidence pipeline recommendation in this brief for `video-architect`.
- **Narrata's continuity architecture is ahead of ByteDance's, for the third time.** Runway has no `Location` entity; MiniMax has no saved references at all; Seedance's `@Image1` is a positional slot, not a name. Narrata's lockable `Character`/`Location` records with `referenceImages` remain a differentiation surface. What Seedance demonstrates is the **capacity** ceiling worth growing into — 50 assets per call, spanning image, video and audio — and that reference *count* now needs to be a modelled capability, not an assumption.
- **The video critic is the clearest build opportunity, and ByteDance just published the rubric.** Five frontier platforms, zero runtime quality gates. Narrata already has the deterministic tier (`checkSegmentFrozen`'s freeze detection). SeedVideoBench's four dimensions and their named sub-criteria — validated by film directors, including the wonderfully blunt "perceptibility of AI sense" — are a ready-made scoring schema for the model-based tier, and `IMAGE_VALIDATION`'s existing result shape is the template. Route to `video-architect`.
- **The disclosure-decay pattern is a method finding worth carrying forward.** ByteDance published a genuinely excellent technical report for Seedance 1.0, a thinner one for 1.5, an advertisement for 2.0, and nothing for 2.5 — while capability grew fastest at the end. Architecture briefs in this repository should be **versioned against the model version they describe**, not the vendor, and a vendor's past transparency should never be treated as a forward guarantee.
