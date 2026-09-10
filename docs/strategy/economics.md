# Narrata — Economics Model

**Owner:** `monetization-strategist`
**Created:** 2026-09-10
**Status:** v1 — framework + scenario models. **No measured cost data exists yet.**

Companion doc: [`./monetization.md`](./monetization.md) (pricing, plans, segments,
experiments, decisions). This file holds the *math*; that file holds the *decisions*.
Do not duplicate content between them.

**Evidence labels used throughout:** `FACT` (verified in code/schema or fetched
from a live external source, with date), `ASSUMPTION` (plausible, unverified),
`HYPOTHESIS` (belief requiring an experiment), `UNKNOWN` (missing — do not fill
with an invented number).

---

## 1. The blocking gap

> Every cost number in this document is a **scenario input**, not a measurement.

`FACT` (verified 2026-09-10): Narrata persists **zero** per-generation cost data.
`AiModelOption` carries `jobType / provider / modelId / displayName / isDefault /
isEnabled / config` and no cost field. `Asset.modelId` records which model made a
take, never what it cost. There is no `Usage`, `GenerationCost`, or `Payment`
model anywhere in `packages/db/prisma/schema.prisma` (878 lines, all 17 models
reviewed).

`FACT` (verified 2026-09-10): **Narrata already receives real per-call cost from
its main provider and throws it away.** OpenRouter's video job poll response
includes a `usage.cost` field carrying the exact USD charge for that call
(confirmed against OpenRouter's video-generation guide, 2026-09-10). In
`apps/web/src/lib/ai/openrouter.ts`, `pollVideoJob` (line 291) parses that
response at line 303 and reads only `data.unsigned_urls[0]`, discarding
`usage`. A case-insensitive grep for `usage|cost` across `openrouter.ts`,
`elevenlabs.ts` and `sarvam.ts` returns **zero matches**.

Consequence: the highest-leverage economics work in the repo is not modelling —
it is *capturing a number the provider already hands us on every call.* See
[`./monetization.md`](./monetization.md) §8 for the cross-agent ask.

---

## 2. Cost pipeline (the chain every expensive action must be reasoned along)

```text
USER ACTION            e.g. "Generate Clip" (an explicit click — manual-first)
   ↓
AiJobType              e.g. VIDEO_GENERATION
   ↓
AiModelOption          which row is isDefault for that job type
   ↓
PROVIDER COST          OpenRouter / ElevenLabs / Sarvam metered charge
   ↓
+ INFRA COST           currently ~flat (single VPS, local disk) — see §6
   ↓
+ EXPECTED RETRY COST  every "regenerate" is a fresh billable call; no retry
                       de-duplication or caching exists (FACT)
   ↓
CREDIT COST            what the action draws down (§4)
   ↓
CUSTOMER PRICE         plan price / credit pack price
   ↓
GROSS MARGIN           price − provider − infra − expected retries
```

### Where cost metadata belongs

`AiModelOption.config` (`Json?`) is **already** an established extension point —
`apps/web/src/lib/video-model-config.ts` defines `VideoModelConfig`
(`durationMode`, `fixedDurations`, `resolutions`, `supportsNativeAudio`) parsed
out of that same column. Cost parameters (`costModel`, `unitCostUsd`,
`creditMultiplier`, `modelClass`) should extend that JSON, **not** become new
top-level schema columns, until a query needs to index on them.

`DECISION` — never hardcode a credit-cost table in application code. That is the
same failure mode as the `MUSIC_GENERATION`/`SFX_GENERATION` hardcoded-provider
bug already documented in project memory.

---

## 3. Verified provider prices (external, dated)

All figures fetched 2026-09-10. Re-verify before any pricing goes live —
provider prices drift, and Principle 7 says a model set once and never revisited
is a margin leak.

| Item | Price | Evidence |
|---|---|---|
| Veo 3.1 (standard) — **Narrata's seeded default** | **from $0.40 / video-second** | `FACT` — openrouter.ai/google/veo-3.1/pricing, fetched 2026-09-10 |
| Veo 3.1 Fast | ~$0.10/s @720p w/audio; ~$0.08/s no audio | `ASSUMPTION` — search-summary aggregation, not confirmed on the model page |
| Veo 3.1 Lite | ~$0.05/s @720p w/audio; ~$0.03/s no audio | `ASSUMPTION` — search-summary aggregation, not confirmed on the model page |
| OpenRouter image models (Google/ByteDance class) | ~$0.04 / output image | `ASSUMPTION` — OpenRouter image-models collection summary |
| GPT Image 2 class (token-billed) | $8 / M input tok, $30 / M output tok | `ASSUMPTION` — search-summary; per-image cost depends on size |
| ElevenLabs Creator tier | $22/mo ≈ 100,000 chars → **~$0.00022 / char** | `FACT` — multiple 2026 pricing breakdowns, fetched 2026-09-10 |
| ElevenLabs Music v2 / SFX v2 per-generation cost | **UNKNOWN** | needs: ElevenLabs credit-cost-per-music-second table |
| Sarvam Bulbul v3 per-character cost | **UNKNOWN** | needs: Sarvam pricing page (Indic-language voice, no substitute) |
| `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`, `google/gemini-3.7-flash` token prices | **UNKNOWN** | needs: per-model OpenRouter pricing rows |
| `google/lyria-3-pro-preview` cost | **UNKNOWN** | needs: OpenRouter model page |
| USD→INR rate | ~₹83/USD cited by one 2026 source; **treat as UNKNOWN** | verify at pricing launch |

### The single most consequential fact in this document

`FACT`: `packages/db/src/seed.ts` line 46 seeds **`google/veo-3.1`** (the
$0.40/second standard model) as the default for `VIDEO_GENERATION`, with
`config: { fixedDurations: [4,6,8], resolutions: ["720p"] }`.

Veo 3.1 Standard vs. Veo 3.1 Lite is roughly an **8× swing in Narrata's dominant
cost line**, controlled entirely by which row has `isDefault: true`. No pricing
decision can be made before that row is deliberately chosen. See
[`./monetization.md`](./monetization.md) §10, Open Question 1.

---

## 4. The credit unit

`DECISION` (see [`./monetization.md`](./monetization.md) §2 for the full Decision
Format entry): **one fungible AI credit**, defined as:

> **1 credit ≈ $0.04 of provider cost ≈ one cheap-tier still image generation.**

Derived credit costs (all `ASSUMPTION`-grade until §1's `usage.cost` capture
lands, at which point every row becomes measurable):

| Action | Job type | Est. provider cost | Credits |
|---|---|---|---|
| Story / scene / shot / prompt drafting | `STORY_WRITING`, `SCENE_PLANNING`, `SHOT_PLANNING`, `IMAGE_PROMPTS`, `DIALOGUE_DIRECTION`, `NARRATION_DIRECTION`, `SCRIPT_DRAFTING`, `DURATION_RECOMMENDATION` | UNKNOWN, small | **0** (free — see note) |
| Shot image | `IMAGE_GENERATION` | ~$0.04–0.08 | **1–2** |
| Image validation | `IMAGE_VALIDATION` | UNKNOWN, small | **0–1** |
| 8s clip, Lite @720p | `VIDEO_GENERATION` | ~$0.40 | **10** |
| 8s clip, Fast @720p | `VIDEO_GENERATION` | ~$0.80 | **20** |
| 8s clip, Standard @1080p | `VIDEO_GENERATION` | ~$3.20 | **80** |
| Voice line (~200 chars) | `VOICE` | ~$0.044 | **1** |
| Music cue / SFX | `MUSIC_GENERATION`, `SFX_GENERATION` | UNKNOWN | **UNKNOWN** |
| Audio cue plan (whole-episode video-input pass) | `AUDIO_CUE_PLANNING` | UNKNOWN — video-input tokens, potentially not small | **UNKNOWN** |
| Assemble-without-audio, final render | `VIDEO` (local ffmpeg) | **~$0 marginal** (`FACT` — provider `local`, runs on the VPS) | **0** |

Two structural notes:

- **Text drafting should be free (0 credits).** It is Narrata's cheapest and
  most differentiating surface (story bible, blueprint, continuity context) and
  charging for it taxes exactly the behaviour that produces good videos. Revisit
  only if `AUDIO_CUE_PLANNING`'s video-input calls prove expensive.
- **Assembly and export must never cost credits.** `FACT`: final render is local
  ffmpeg on Narrata's own VPS — marginal cost ≈ 0. Charging for it would be
  charging for something that costs nothing, which fails Principle 6.

---

## 5. Unit economics formulas

Stated explicitly so every assumption is auditable.

```text
Contribution Margin (per user, per month)
  = Revenue − (Variable AI Cost + Variable Infra Cost)

Gross Margin %
  = (Revenue − COGS) / Revenue
  where COGS = provider cost + retry cost + attributable infra + payment fees

Blended AI cost per paid user
  = Σ(credits burned × cost per credit) + retry overhead

ARPPU  = Subscription Revenue / Paying Users
ARPU   = Total Revenue / Active Users

LTV    = ARPPU × Gross Margin % × Average Customer Lifetime (months)
       where Average Customer Lifetime = 1 / Monthly Revenue Churn Rate

Payback Period (months) = CAC / (ARPPU × Gross Margin %)

Effective Free-Tier CAC
  = (Free-tier AI cost per signup) / (Free → Paid conversion rate)

Credit Breakage %
  = 1 − (credits burned / credits granted)      ← where real margin lives

Cost per generation = provider cost × (1 + expected retry rate)
Revenue per generation = credits charged × retail price per credit
```

`Effective Free-Tier CAC` is the formula that governs free-tier design and is the
one most often skipped. At a $12 free-tier AI cost and 5% conversion, Narrata
spends **$240 of AI cost per paid customer acquired** before any marketing
spend — which is why §7's free tier is deliberately shaped around
`ILLUSTRATION` mode rather than video.

---

## 6. Infrastructure cost

`FACT` (per `technical-architect` + deployment memory): single VPS, Docker,
assets on local disk (`STORAGE_ROOT`) — **not** S3/object storage. `FACT`: the
local `storage/` directory is currently 943 MB from development use alone.

Implication: infra cost today is a **flat monthly bill**, not a per-GB/per-request
meter. Variable AI provider cost dominates COGS by an order of magnitude, so
early margin modelling can treat infra as fixed overhead.

This stops being true at whichever comes first: (a) migration to object storage,
(b) enough users that disk or egress forces a bigger VPS. `UNKNOWN`: current VPS
monthly cost, disk ceiling, and egress terms — needed from `technical-architect`
before infra enters the per-user margin formula.

Storage retention policy is therefore a **cost-deferral lever, not a revenue
lever**, until storage is metered. Do not sell "more storage" as an expansion SKU
while storage is free-at-the-margin (fails Principle 8: no meaningful perceived
value, and it is not actually a cost we incur).

---

## 7. Reference unit: what one episode costs

Reference artefact: **one 3-minute (180s) episode**, `IMAGE_TO_VIDEO` mode,
8-second clips (Veo 3.1's `fixedDurations` includes 8 — `FACT` from
`seed.ts` config), one clip per shot pair (`FACT`, per-shot-pair video design).

**Inputs**

| Input | Value | Label |
|---|---|---|
| Episode runtime | 180 s | `ASSUMPTION` (no data on real episode length) |
| Clips per episode | 23 (180 ÷ 8) | derived |
| Takes per accepted clip | 1.6 | `ASSUMPTION` — no retry data exists; this is the single most sensitive input |
| Takes per accepted shot image | 2.0 | `ASSUMPTION` |
| Speech seconds | ~108 s (60% of runtime) ≈ 1,500 chars | `ASSUMPTION` |
| Music/SFX cues | ~6 | `ASSUMPTION` |
| LLM text calls per episode | ~15 | `ASSUMPTION` |

**Cost per episode, by video model**

| Line | Veo 3.1 **Lite** | Veo 3.1 **Fast** | Veo 3.1 **Standard** |
|---|---|---|---|
| Video (180s × 1.6 takes) | $14.40 | $28.80 | $115.20 |
| Shot images (23 × 2 × $0.08) | $3.68 | $3.68 | $3.68 |
| Voice (1,500 chars × 1.5 takes) | $0.50 | $0.50 | $0.50 |
| Music / SFX | UNKNOWN (~$0.60 placeholder) | ~$0.60 | ~$0.60 |
| LLM text + audio cue plan | UNKNOWN (~$0.50 placeholder) | ~$0.50 | ~$0.50 |
| **Total provider cost** | **≈ $19.68** | **≈ $34.08** | **≈ $120.48** |
| **In credits (@ $0.04)** | **≈ 490** | **≈ 850** | **≈ 3,010** |

And the same episode in **`ILLUSTRATION` mode** (no video generation — stills,
voice, music, local assembly):

| Line | Cost |
|---|---|
| Shot images (~36 stills × 2 takes × $0.08) | $5.76 |
| Voice + music + LLM | ~$1.60 |
| **Total** | **≈ $7.36 (~185 credits)** |

> **The headline economic fact of Narrata:** a 3-minute episode costs between
> **~$7 and ~$120** in raw provider cost, and the difference is driven almost
> entirely by (a) which `AiModelOption` row is default and (b) whether the scene
> is `ILLUSTRATION` or `IMAGE_TO_VIDEO`. Both are already first-class,
> user-selectable concepts in the schema. Narrata's monetization design should
> lean on levers it already has rather than inventing new ones.

---

## 8. Scenario models

Shared inputs across scenarios, all `ASSUMPTION` or `HYPOTHESIS` — Narrata has
**no users, no conversion data, and no churn data** (`FACT`: invite/`SIGNUP_CODE`
gated, not publicly launched).

### Base scenario

| Input | Value | Label |
|---|---|---|
| Registered users | 10,000 | `HYPOTHESIS` — a planning target, not a forecast |
| MAU rate | 25% → 2,500 MAU | `ASSUMPTION` |
| Free → paid conversion | 4% of MAU → 100 paying | `HYPOTHESIS` (industry-typical band for creator tools; must be tested) |
| Blended ARPPU | $22 /mo | derived from §9 ladder mix (70% Creator / 25% Studio / 5% Pro) |
| Credit breakage | 40% (paid users burn 60% of allowance) | `ASSUMPTION` — the margin-critical input |
| Free-tier cost per activated free user | $2.00 (150 credits, ~33% burned) | `ASSUMPTION` |
| Payment processing | 3% | `ASSUMPTION` |
| Infra | $80/mo flat | `UNKNOWN` — placeholder pending `technical-architect` |
| Monthly revenue churn | 8% | `HYPOTHESIS` |

**Monthly P&L**

```text
Revenue           100 × $22.00                       =  $2,200
AI cost (paid)    100 × (allowance credits × $0.04 × 0.60 burn)
                  Creator  70 × 150cr × $0.04 × 0.60 =    $252
                  Studio   25 × 450cr × $0.04 × 0.60 =    $270
                  Pro       5 × 1300cr × $0.04 × 0.60=    $156
                                                 subtotal $678
AI cost (free)    2,400 free MAU × $2.00 amortised over
                  ~6-month free lifetime ≈ 400 new/mo × $2.00 = $800
Payment fees      3% × $2,200                        =     $66
Infra                                                =     $80
------------------------------------------------------------------
Gross profit (paid cohort only)  $2,200 − $678 − $66 − $80 = $1,376
Gross margin (paid cohort only)                            =  62.5%
Fully-loaded (incl. free-tier AI)  $1,376 − $800           =   $576
Fully-loaded margin                                        =  26.2%
```

**Read:** the paid cohort is healthy at ~62% gross margin. **The free tier eats
58% of that gross profit.** Free-tier cost is the dominant economic risk, not
paid-tier pricing.

```text
Effective Free-Tier CAC = $2.00 / 4% = $50 per paid customer
LTV = $22 × 62.5% × (1 / 0.08) = $22 × 0.625 × 12.5 = $171.88
LTV : free-tier-CAC = 3.4 : 1   (before any marketing spend)
Payback on free-tier CAC = $50 / ($22 × 0.625) = 3.6 months
```

`ASSUMPTION`: that leaves roughly $107 of headroom per customer for paid
acquisition at a 3:1 LTV:CAC target — i.e. **Narrata can afford roughly $57 blended
paid CAC** in the Base case. Hand that number to `growth-strategist` as the
acquisition budget ceiling.

### Conservative scenario

Stress-tests the margin floor: low conversion, high usage, low breakage, users
running video mode on the expensive default model.

| Input | Value vs Base |
|---|---|
| Free → paid conversion | **2%** (halved) |
| Credit breakage | **10%** (users burn 90% of allowance) |
| Free-tier cost per activated user | **$4.00** (doubled — heavier free usage) |
| Default video model | **Veo 3.1 Standard** left seeded as-is |
| Overage behaviour | users buy packs at 2.5× cost markup |

```text
Paying users      2,500 MAU × 2%                     =     50
Revenue           50 × $22.00                        =  $1,100
AI cost (paid)    Creator 35 × 150cr × $0.04 × 0.90  =    $189
                  Studio  12 × 450cr × $0.04 × 0.90  =    $194
                  Pro      3 × 1300cr × $0.04 × 0.90 =    $140
                                                 subtotal $523
AI cost (free)    400 new free/mo × $4.00            =  $1,600
Payment fees      3% × $1,100                        =     $33
Infra                                                =     $80
------------------------------------------------------------------
Gross profit (paid cohort only)                      =    $464   → 42.2% margin
Fully-loaded                                         =  −$1,136  → NEGATIVE
```

**Read:** the paid tier survives the Conservative case at ~42% margin. **The
business does not** — a doubled free-tier cost at halved conversion produces a
$1,136/month loss on 10,000 registered users, and it scales linearly with signups.
This is Principle 2 in concrete form: growth is a liability at negative
free-tier margin.

**Conservative-case guardrails that follow directly:**

1. Free-tier credits must be **one-time, not monthly** (a recurring free
   allowance turns a one-off cost into perpetual burn per user).
2. Free tier must be **`ILLUSTRATION` mode only** — video mode alone is the
   difference between $2 and $12+ per free user.
3. Free-tier generation must be **cheap-class models only** (Section 4's model
   classes), enforced through `AiModelOption`, not through UI copy.

### Scenarios not yet modelled

`Aggressive`, `Viral`, `Premium`, `Creator Economy` — deliberately deferred.
`Aggressive` presupposes cost-optimisation mechanisms (routing, caching, retry
de-duplication) that **do not exist** and would be modelling fiction today.
`Viral` cannot be honestly evaluated until the free-tier cost floor above is
measured rather than assumed. Revisit once §1's `usage.cost` capture produces
two weeks of real data.

---

## 9. Sensitivity: what breaks the model

Ranked by impact on gross margin, most sensitive first.

| Lever | Swing | Margin impact | Notes |
|---|---|---|---|
| Default video model (Standard ↔ Lite) | 8× | Catastrophic → healthy | One `isDefault` row in `AiModelOption` |
| Free-tier design (video allowed ↔ illustration only) | ~6× free-tier cost | Business-level | See Conservative scenario |
| Retry rate (1.2 ↔ 2.5 takes/clip) | ~2× video cost | Severe | **Completely unmeasured.** No retry data exists |
| Credit breakage (10% ↔ 50%) | ~1.8× AI cost | Major | Unknown until users exist |
| Free → paid conversion (2% ↔ 6%) | 3× revenue | Major | `HYPOTHESIS` |
| Provider price drift | ±30% | Moderate | Principle 7: monitor continuously |
| Infra | flat | Minor today | Until object storage or scale |

### "What happens if usage doubles?"

Because credits are cost-proportional (§4), doubled usage is **absorbed, not
suffered**: users exhaust their allowance and either stop (breakage falls, margin
compresses toward the floor in §8's Conservative row) or buy packs (margin holds
at pack markup). The design is intentionally margin-stable under demand shocks —
which is the point of a credit metric over an unlimited plan.

### "What happens if AI model costs change?"

Credits are denominated in **provider cost**, so a provider price rise raises the
credit-cost of an action without changing the retail price of a credit. That
protects the user's mental model (Principle 5) while compressing margin. The
guardrail: monitor realised cost-per-credit monthly (requires §1) and re-tune
`AiModelOption.config` multipliers when realised blended cost per credit drifts
more than 15% from $0.04.

---

## 10. Instrumentation required before any of this is real

Ordered by leverage. Specification only — nothing here is built.

1. **Capture `usage.cost`** in `apps/web/src/lib/ai/openrouter.ts` (see §1).
   Near-zero cost, immediately turns scenario inputs into measurements.
2. **`GenerationEvent` / `Usage` record** — proposal for `technical-architect`
   review; **not** a migration to run:

   ```text
   model GenerationEvent {
     id            String     @id @default(cuid())
     userId        String
     projectId     String?
     jobType       AiJobType
     provider      String
     modelId       String
     assetId       String?    // links to the produced take, when there is one
     status        String     // "succeeded" | "failed" | "timeout"
     providerCost  Decimal?   // from usage.cost where the provider reports it
     durationSec   Float?     // video seconds / audio seconds
     inputTokens   Int?
     outputTokens  Int?
     latencyMs     Int?
     createdAt     DateTime   @default(now())
   }
   ```

   Cost-of-failure is why `status` matters: a failed take still bills.
3. **Retry linkage** — enough to compute takes-per-accepted-asset, the #3
   sensitivity above.
4. **Basic product analytics** — no SDK exists (`FACT`: no PostHog/Segment/
   Mixpanel/GA in `apps/web/package.json`). Needed for every Conversion and
   Retention row of the dashboard spec in [`./monetization.md`](./monetization.md) §7.

Until (1) and (2) exist, treat every number above as a scenario input. Do not
quote them externally as Narrata's economics.
