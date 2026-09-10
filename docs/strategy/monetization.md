# Narrata — Monetization Strategy

**Owner:** `monetization-strategist`
**Created:** 2026-09-10
**Status:** v1 — **Monetization Baseline.** Pre-launch framework. Nothing here is shipped.

Companion doc: [`./economics.md`](./economics.md) — cost pipeline, provider prices,
unit-economics formulas, scenario models. This file holds *decisions*; that file
holds the *math*. Do not duplicate content between them.

**Evidence labels:** `FACT` / `ASSUMPTION` / `HYPOTHESIS` / `UNKNOWN` / `DECISION`
/ `EXPERIMENT`.

> **Neither `docs/strategy/VISION.md` nor `docs/strategy/DECISION_LOG.md` exists
> yet** (`FACT`, verified 2026-09-10 — `docs/` did not exist before this file).
> This strategy therefore has **no company-vision document to align against**. It
> is written to be consistent with `company-vision`'s stated *framework*
> (continuity moat, anti-"AI wrapper", anti-commodity-positioning, anti-short-term
> optimisation), but §10's open questions must be reconciled with `VISION.md`
> once `company-vision` writes it.

---

# THE NARRATA MONETIZATION BASELINE

## 1. Current monetization state (re-verified 2026-09-10)

**There is no monetization layer.** All of the following are `FACT`, verified
directly against the repository today:

- **No billing schema.** `packages/db/prisma/schema.prisma` (878 lines) contains
  17 models — `Project`, `Story`, `StoryBible`, `SeriesBlueprint`, `Season`,
  `Episode`, `Scene`, `Shot`, `Character`, `Location`, `DialogueLine`, `Asset`,
  `Version`, `AiModelOption`, `User`, `Session`, `Invite`. There is **no**
  `Plan`, `Subscription`, `Credit`, `Usage`, or `Payment` model. `User` has
  `id / email / passwordHash / role / ownedProjects / sessions / invites` — no
  `plan`, `credits`, `stripeCustomerId`, or `subscriptionStatus`.
- **No payments SDK.** No Stripe/Razorpay/Paddle/Lemon Squeezy dependency in
  `apps/web/package.json`; no `stripe`/`billing`/`credits`/`pricing` module in
  `apps/web/src/lib/` (24 files reviewed).
- **No analytics SDK.** No PostHog/Segment/Mixpanel/GA anywhere. Zero event
  tracking for signup, generation, upgrade, or churn.
- **No per-generation cost data**, and worse — see [`./economics.md`](./economics.md) §1 —
  Narrata **discards** the `usage.cost` figure OpenRouter already returns on
  every video call (`apps/web/src/lib/ai/openrouter.ts`, `pollVideoJob` line 291,
  response parsed line 303, only `unsigned_urls[0]` read).
- **No rate limiting or quota enforcement of any kind.** A repo-wide grep for
  `rate.?limit|throttl|quota` across `apps/web/src`, `workers/`, `packages/`
  returns zero implementation matches.
- **No monetization-adjacent content** in `PHASES.md` (54 KB), `WHAT_WE_BUILT.md`,
  or `TODO-long-form-video.md`.
- **No collaboration / multi-seat capability.** No membership, team,
  organization, or workspace model exists. A `Project` is owned by exactly one
  `User`. Team and Enterprise plans are therefore not sellable — see §4.

### Two drifts from the previously assumed baseline

1. **Signup is *not* purely invite-gated.** `apps/web/src/app/api/auth/signup/route.ts`
   accepts **two** paths: a one-time `Invite` code **or** a static
   `process.env.SIGNUP_CODE`. A static shared code is a materially weaker gate
   than one-time invites — one leak makes signup effectively open, against a
   system with zero rate limiting and no per-account generation cap. This is the
   top near-term economic-attack surface (§9).
2. **`growth-strategist` and `market-intelligence` agents now exist and are
   staffed** (previously assumed empty stubs). `product-manager.md` remains
   empty (0 bytes). `market-intelligence` has its own §9 "Pricing Intelligence" —
   competitor pricing research should be **routed to it going forward**; the
   figures in §6 below were gathered directly because no persisted market
   intelligence output exists yet.

**Implication:** Narrata has **no paying customers, no conversion funnel to
instrument, and no free-tier abuse surface at scale.** Everything below is
pre-launch framework design, not a live pricing change. Per Principle 9, do not
monetize the current invite cohort — they are worth more as feedback and
word-of-mouth than as revenue.

---

## 2. Recommended value metric

```text
DECISION

Recommendation:
  A single fungible "AI credit" as Narrata's only value metric, denominated so
  that 1 credit ≈ $0.04 of provider cost ≈ one cheap-tier still image.
  Text/planning generation costs 0 credits. Assembly and export cost 0 credits.
  Video clips cost 10 / 20 / 80 credits depending on model class.
  (Full table: ./economics.md §4.)

Why:
  Narrata's per-action costs are genuinely heterogeneous by two orders of
  magnitude — a text draft, a still image, a voice line and an 8-second Veo clip
  are not comparable units (FACT, ./economics.md §7). Exposing separate meters
  for "video minutes", "image count" and "voice seconds" would make a user's
  bill unpredictable across three axes at once, failing Principle 5. A single
  credit maps 1:1 onto the cost pipeline without inventing a second abstraction,
  and it is the metric the entire competitive set has converged on — Runway,
  LTX Studio, InVideo and Google Flow all meter in credits (FACT, §6), so it
  reads as familiar rather than novel to the target user.

User value:
  One number to watch. Predictable before clicking: the cost is shown on the
  button, and the button is already an explicit manual click (FACT — Narrata is
  manual-first; nothing auto-cascades). Free text drafting means the entire
  story/bible/blueprint layer — Narrata's differentiator — is never taxed.

Revenue impact:
  Enables both subscription (monthly allowance) and expansion (credit packs)
  without a second pricing model. Breakage on unused allowance is a material
  margin contributor (./economics.md §8).

Cost impact:
  None directly. Requires the cost metadata to live in AiModelOption.config,
  extending the existing VideoModelConfig pattern — not new schema columns, and
  never a hardcoded table in application code.

Margin impact:
  Structurally margin-stable: credits are denominated in provider cost, so a
  usage spike is absorbed by the allowance rather than by margin, and a provider
  price rise re-tunes credit costs without changing retail price.

Retention impact:
  Neutral-to-positive if paired with rollover on higher tiers. Risk: a visible
  meter can suppress the exploration that makes users good long-term customers.
  Mitigated by making all text/planning and all assembly/export free — the
  meter only appears on genuinely expensive actions.

Risk:
  "Credits" may read as an opaque abstraction to non-technical storytellers.
  Needs a UX read from ui-ux-engineer before commitment.

Confidence: Medium-High

Dependencies:
  ./economics.md §1 (usage.cost capture) before credit costs are anything but
  estimates. ui-ux-engineer on comprehensibility.

Experiment required: Yes — see EXP-002 (§8).
```

**Rejected alternatives:** *video minutes* (ignores illustration mode entirely
and mis-prices the 8× spread between video model classes); *projects/episodes*
(unbounded cost per unit — an episode can cost $7 or $120, ./economics.md §7);
*storage* (costs Narrata ~nothing today — local disk on a flat-rate VPS — so
selling it fails Principle 8).

---

## 3. Recommended initial plan ladder

Deliberately **small**: one free tier, two paid tiers, and packs. Not a
seven-tier checklist. Every tier below maps to a segment that exists (§4) and a
capability the product actually has today.

| | **Free** | **Creator** | **Studio** | **Credit packs** |
|---|---|---|---|---|
| Price (USD) | $0 | **$18 /mo** ($15 annual) | **$45 /mo** ($37 annual) | $10 / 100 cr |
| Price (INR, indicative) | ₹0 | **₹1,499 /mo** | **₹3,749 /mo** | ₹849 |
| Credits | **150, one-time** | 150 / mo | 450 / mo | as purchased |
| Scene modes | `ILLUSTRATION` only | + `IMAGE_TO_VIDEO`, `TEXT_TO_VIDEO` | all | — |
| Model class | Cheap only | Cheap + Standard | + Premium | — |
| Resolution | 720p | 720p | 720p / 1080p when available | — |
| Watermark | Yes | No | No | — |
| Commercial rights | No | Yes | Yes | — |
| Credit rollover | n/a | No | Yes (1 month) | Never expire |
| Export / assembly | Free, unlimited | Free, unlimited | Free, unlimited | — |
| Text / story / bible drafting | Free, unlimited | Free, unlimited | Free, unlimited | — |

`ASSUMPTION`: INR figures use ~₹83/USD from a single 2026 source and are
**indicative only** — verify the rate and, more importantly, run India pricing as
a purchasing-power decision rather than a conversion (see §10, Open Question 4).

### Why this shape

- **The allowance is small on purpose, and the market agrees.** At $18/mo with a
  ~65% gross-margin target, the credit budget is ~$6 of provider cost ≈ 150
  credits ≈ ~96 seconds of Lite-class video, or one complete ~3-minute
  illustration-mode episode. That is *not* stingy relative to the market:
  `FACT` — Runway Standard is $15/mo for 625 credits ≈ **52 seconds** of
  Gen-4.5; Runway Pro is $35/mo for ≈187 seconds. Mainstream creator plans
  across the category buy roughly **1–3 minutes of AI video per month**.
  Narrata must not promise "an episode a month" at $18 — it would be promising
  something that costs $20–$120 to deliver (`./economics.md` §7).
- **Two paid tiers, not five.** Studio exists to avoid capping expansion revenue
  from the heaviest creators; packs handle everything in between. A third paid
  tier before there is usage data would be a price with no differentiated
  product behind it.
- **Free text drafting on every tier, forever.** It is cheap, it is the moat, and
  metering it would tax the behaviour that produces good videos.
- **Export and final assembly are free on every tier including Free.** `FACT`:
  final render is local ffmpeg on Narrata's own VPS — marginal cost ≈ $0.
  Charging for a zero-cost action fails Principle 6, and a free (watermarked)
  export is the cheapest distribution Narrata will ever get.

### Explicitly deferred

**Team, Business, and Enterprise plans are NOT recommended and are not
sellable today.** `FACT`: no membership/team/organization model exists; a
`Project` has exactly one owner. Selling seats would require
`product-strategist` and `technical-architect` to build multi-seat auth,
sharing, and admin controls first. Design *headroom* into the ladder (Studio is
positioned so a future Team tier sits above it), but do not build the tier.

Also deferred: API access, white-label, custom models, premium asset libraries —
each is a real future expansion lever, none has a product behind it.

---

## 4. Target segments — now vs. later

### NOW (serviceable today)

- **Serious individual creators** — the beachhead. People making a *series* or
  a recurring narrative, who feel the continuity problem that Narrata's
  `StoryBible` / `SeriesBlueprint` / locked character references exist to solve.
  Highest willingness to pay, and the only segment for whom Narrata's actual
  differentiator is the purchase reason.
- **Hobby storytellers** — the free tier and the top of the Creator funnel.
  Served by `ILLUSTRATION` mode at a cost Narrata can absorb.

### LATER (blocked on product, not on pricing)

- **YouTubers / short-form creators** — plausible, but blocked on export
  workflow and speed. `UNKNOWN`: whether Narrata's manual-first, per-step flow
  fits a creator shipping multiple videos a week. Ask `product-strategist`.
- **Studios** — blocked on collaboration (§3).
- **Businesses / Enterprise** — blocked on multi-seat auth, admin console, SLA,
  and security posture. There is no dedicated security agent and no SLA story.
  Recommending an Enterprise tier now would be recommending Narrata solve
  problems it has not built the product for.

`HYPOTHESIS`: Narrata's India-first signal is real and strategically material —
Sarvam AI was integrated specifically for Indic-language voice coverage
ElevenLabs lacks (e.g. Odia). That is a genuine differentiator no global
competitor in §6 offers, and it points at an underserved segment: **regional-language
serial storytellers**. This should be tested with `market-intelligence` before it
becomes a pricing decision (§10, Open Question 4).

---

## 5. Free-tier design

Designed backwards from one number: `Effective Free-Tier CAC = free-tier AI cost
÷ conversion rate` (`./economics.md` §5). At a $12 free-tier cost and 4%
conversion, Narrata would spend **$300 of AI cost per paid customer** before any
marketing. The Conservative scenario (`./economics.md` §8) shows free-tier cost
alone turning the whole business negative.

```text
DECISION

Recommendation:
  Free tier = 150 one-time credits, ILLUSTRATION mode only, cheap-class models
  only, 720p, watermarked, personal use only, unlimited free text/story/bible
  drafting, unlimited free assembly and watermarked export, 90-day asset
  retention.

Why:
  ILLUSTRATION mode is the single highest-leverage cost lever Narrata already
  owns. A 3-minute illustration-mode episode costs ~$7 in provider cost versus
  ~$20–$120 for the same episode in video mode (FACT-structure,
  ASSUMPTION-magnitude — ./economics.md §7). Critically, illustration mode
  still demonstrates the actual differentiator: a locked character reference
  holding the same face across every scene of a multi-scene story. That is the
  aha moment. Motion is the upgrade.

User value:
  A free user can complete one entire creative loop — story → bible →
  characters → scenes → shots → images → voice → music → assembled, exported,
  shareable video. Not a demo of one image. That satisfies Principle/Section 10's
  requirement that the free tier reach a real finished output.

Revenue impact:
  Indirect. The upgrade trigger is built into the product's own vocabulary:
  "your story works — now make it move."

Cost impact:
  ~$2.00 per activated free user at ~33% credit burn (ASSUMPTION); $6.00
  worst case if fully exhausted. Bounded and one-time.

Margin impact:
  Bounded by construction. One-time credits mean a dormant free account costs
  $0/month forever after.

Retention impact:
  Positive. 90-day retention of a free user's assets preserves the option to
  return; deleting their first story is a hostile way to save a few MB on a
  flat-rate disk.

Risk:
  Users may perceive illustration mode as "the real product withheld".
  Mitigation is framing — an animatic/illustrated-story mode is a legitimate
  creative output, not a crippled video. ui-ux-engineer should own this framing.

Confidence: Medium-High on the economics, Medium on the product framing.

Dependencies:
  Cheap-class-only enforcement must be an AiModelOption-level guarantee, not UI
  copy. Requires the Plan/entitlement schema that does not exist yet.

Experiment required: Yes — EXP-001 (§8).
```

**Non-negotiables**, from the Conservative scenario:

1. Free credits are **one-time, never a monthly refill.** A recurring free
   allowance converts a one-off acquisition cost into perpetual per-user burn.
2. Free tier is **`ILLUSTRATION` only.** No `VIDEO_GENERATION` on free, ever.
3. Free tier is **cheap-class models only**, enforced at the model-registry layer.

---

## 6. Competitive pricing (fetched 2026-09-10 — re-verify before use)

`FACT` unless noted. Going forward this table's maintenance belongs to
`market-intelligence` (its §9), not here.

| Product | Free tier | Entry paid | Mid | Top | Metric |
|---|---|---|---|---|---|
| **LTX Studio** (closest positioning — AI storyboard-to-film) | 800 credits one-time, LTX-2 models only, **no commercial rights** | Lite $15/mo, 8,000 cr, personal use only | Standard $35/mo, 28,000 cr, commercial, Veo 2 / Kling 2.6 Pro | Pro $125/mo, 110,000 cr, **Veo 3.1**, Kling 3.0 Pro | credits (renamed from "computing seconds") |
| **Runway** | 125 credits one-time | Standard $15/mo, 625 cr ≈ **52 s** of Gen-4.5 | Pro $35/mo, 2,250 cr ≈ 187 s | Max $95/mo, 9,500 cr, credits roll over | credits |
| **InVideo AI** | yes | Plus $35/mo (or $17 annual) | Max $60/mo | Generative $120/mo; Team from $999/mo | credits; **frontier models billed at original API rates against your credits** |
| **Google Flow** | 50 credits/day, no subscription | AI Plus $4.99/mo, 200 cr | Pro $19.99/mo, 1,000 cr | Ultra $99.99–$199.99/mo, 10k–25k cr | credits; one Veo 3.1 gen = 5–100 cr |
| **Sora / OpenAI** | — | ChatGPT Plus $20/mo, 50 videos | Pro from $100/mo, up to 500 videos | — | videos/month |

### What Narrata can do differently

1. **Free tier with commercial-grade *story* tooling, not just free pixels.**
   LTX's free tier explicitly grants **no commercial rights** and Runway's is
   125 one-time credits. Nobody is giving away the *narrative* layer — story
   bible, series blueprint, character continuity — because nobody else has one
   as a first-class product surface. Narrata's cheapest, most differentiating
   asset is the one it can afford to give away free forever.
2. **Do not compete on price-per-second.** `FACT`: Runway retails its *own*
   Gen-4.5 at roughly $0.19–$0.29 per second while Narrata's seeded default
   Veo 3.1 Standard *costs* $0.40/second wholesale. Narrata cannot win a
   per-second price war on resold frontier models and must not try — that is
   `company-vision`'s "commodity positioning" drift, in numbers.
3. **Sell continuity across an episode, not clips.** Every competitor above
   meters generations. Narrata's defensible pitch is that the tenth scene still
   looks like the first — a promise measured in *episodes*, priced in credits.
4. **Indic-language voice.** No competitor in this table offers Odia-class
   Indic TTS. `HYPOTHESIS`, worth `market-intelligence` validation.
5. **Adopt InVideo's honesty about frontier models.** Its "billed at the models'
   original API rates against your credits" is exactly the cost-safe pattern for
   premium model access — pass-through, cost-proportional, no promised margin on
   an unmeasured cost.

---

## 7. Conversion moments, mapped to Narrata's real pipeline

Narrata is **manual-first**: nothing auto-cascades and every expensive step is
already an explicit user click (`FACT`; `MASTER_AI` is deliberately unbuilt).
That is a monetization gift — a credit cost shown *on the button the user is
already about to press* is additive information, not an interruption. Prefer it
over any unprompted mid-session modal.

```text
Create Story / Story Bible / Blueprint      → FREE. No meter. Ever.
        ↓
Generate Characters / Locations + refs      → cheap; free tier's core value.
        ↓                                     THE AHA MOMENT lives here:
                                              locked reference = same face
                                              in every scene.
Plan Scenes / Shots                          → FREE. No meter.
        ↓
Generate Shot Images                         → 1–2 credits. Metered, cheap.
        ↓                                     Free tier completes an entire
                                              story at this level.
┌─────────────────────────────────────────────────────────────────┐
│  Generate Video Clip  ← ★ PRIMARY PAYWALL                       │
│  10–80 credits. The cost cliff (up to 80× a still image) and    │
│  the emotional cliff ("make it move"). Gate here.               │
└─────────────────────────────────────────────────────────────────┘
        ↓
Generate Voice / Music / SFX                 → cheap; metered lightly.
        ↓
Assemble Episode (local ffmpeg)              → FREE. Costs ~$0. Never charge.
        ↓
Export                                       → FREE, WATERMARKED on free tier.
                                               ★ SECONDARY GATE: watermark
                                               removal + commercial rights.
```

**Two gates, not seven.** The primary gate at `VIDEO_GENERATION` is where cost
and desire coincide. The secondary gate at Export captures intent-to-*use*
rather than intent-to-*explore* — and gating rights/watermark rather than the
export itself means free users still export and still share, which is free
distribution.

**Anti-patterns to avoid:** metering text drafting; charging credits for local
assembly; a hard wall mid-episode that strands a half-finished story (see §9's
QA risk); upgrade prompts before the user has completed one loop.

---

## 8. Experiments

Format per §17 of the agent spec. All are **designed, none are running** — none
can run before the instrumentation in `./economics.md` §10 exists.

```text
EXP-001 — Free-tier shape
Hypothesis:   An ILLUSTRATION-only free tier that reaches a finished, exported
              video converts to paid at >= the rate of a video-enabled free
              tier, at ~1/6th the AI cost per free user.
Target:       New signups, first 30 days.
Baseline:     None (no users). Establish on first public cohort.
Change:       Free = 150 one-time credits, ILLUSTRATION only.
Success:      Free → paid conversion >= 4%.
Guardrail:    % of free users reaching first exported video >= 25%. If free
              users cannot finish, the tier is too tight regardless of cost.
Duration:     60 days post-public-launch.
Decision:     Ship / Iterate / Reject
```

```text
EXP-002 — Does "credits" read as clear or opaque?
Hypothesis:   Target users understand a single credit balance better than
              per-asset meters.
Change:       Qualitative — 5-8 moderated sessions with the invite cohort,
              before any billing is built.
Success:      >=70% correctly predict the cost of an action before clicking.
Guardrail:    Zero users report the meter discouraging exploration.
Duration:     2 weeks. Cheap, and it de-risks §2's Medium-confidence call.
Decision:     Ship / Iterate / Reject
```

```text
EXP-003 — Annual billing
Hypothesis:   Annual billing raises LTV without hurting activation.
Guardrail:    30-day retention must not drop vs. monthly-only.
Status:       Deferred until there is a monthly baseline to compare against.
```

```text
EXP-004 — Default video model class
Hypothesis:   Users cannot reliably distinguish Veo 3.1 Lite from Standard
              output at 720p in Narrata's use case (short narrative clips
              anchored to a fixed reference image).
Why it matters: This is an 8x swing in Narrata's dominant cost line
              (./economics.md §3). If true, Narrata's margin problem is
              largely solved by one AiModelOption row.
Change:       Blind A/B of generated clips with the invite cohort.
Success:      <60% correct identification (i.e. near chance).
Duration:     1 week. Highest ROI experiment available today.
Decision:     Ship / Iterate / Reject
```

---

## 9. Abuse and economic-risk posture

**Current posture: LOW urgency, ONE real hole.**

Signup requires either a one-time `Invite` or the static `SIGNUP_CODE` env var
(`FACT`). One-time invites are a genuinely strong abuse guard that most consumer
SaaS never gets for free. **The static `SIGNUP_CODE` is not.** A shared or leaked
code makes signup effectively open against a system with **zero rate limiting
anywhere in the codebase** (`FACT`) and no per-account generation cap — i.e. an
unbounded ability to spend Narrata's OpenRouter balance.

```text
NOW (while gated, pre-launch)
  - Do NOT build device fingerprinting, aggressive rate limiting, or custom
    fraud detection. There is no threat at this scale and it would be friction
    against the exact early users whose feedback is the point (Principle 9).
  - DO treat SIGNUP_CODE as a credential: rotate it, keep it out of any public
    surface, and prefer one-time invites for anyone outside the core circle.
  - DO capture usage.cost (economics.md §1) — you cannot detect anomalous spend
    you do not record. This is a security control as much as an economics one.

NEXT (must land BEFORE public signup opens)
  - Retire or gate SIGNUP_CODE. Open signup + no rate limit + no quota = an
    uncapped provider bill.
  - Per-account generation rate limits on VIDEO_GENERATION specifically (the
    expensive job type). Nothing exists today.
  - A hard per-account credit ceiling enforced server-side, in the same
    transaction that debits credits (never client-side).
  - Credit-pack purchase-velocity checks.
  - Payment fraud: use what the provider already gives you (e.g. Stripe Radar)
    before building anything custom.

LATER (only once the pattern is observed)
  - Referral-abuse controls (no referral program exists).
  - Bot-workload detection.
```

**Structural protection worth naming and defending:** Narrata's manual-first
design means no agent runs away spending money unsupervised. `MASTER_AI` — the
only thing that could auto-spend across many steps — is deliberately unbuilt.
**Any future proposal to remove a manual approval step from an expensive
generation, or to ship `MASTER_AI` with auto-cascade, is a cost-control
regression and must be evaluated as one**, not as a neutral UX improvement. If
`MASTER_AI` is built, it needs a per-run credit ceiling and a pre-run cost
estimate shown to the user, as a hard requirement rather than a nicety.

**Ask `qa-engineer`** about two specific risks before any of this is built: (a) a
credit-balance race condition allowing double-spend under concurrent generation,
and (b) a paywall that blocks or discards an already-paid-for in-progress
generation.

---

## 10. Open questions requiring founder or `company-vision` input

**1. Which video model should be the default? (Highest priority — decide first.)**
`FACT`: `seed.ts` line 46 seeds `google/veo-3.1` (the $0.40/second Standard
model) as default. Lite is ~8× cheaper. This one row determines whether a
3-minute episode costs ~$20 or ~$120, which determines whether *any* consumer
subscription is viable. This is a quality-vs-economics tradeoff only the founder
and `video-architect` can settle. See EXP-004.

**2. Is Narrata a Premium product or a Creator-Economy product?**
The §3 ladder assumes creator-economy (volume, $18–$45). The alternative — a
smaller audience at $99–$199/mo with premium models unlocked — fits a
manual-first, continuity-focused, quality-over-volume product arguably *better*,
and sidesteps the free-tier cost problem entirely. `company-vision` should
decide this before pricing is set, because it is a positioning question wearing
a pricing question's clothes. **I do not recommend resolving it unilaterally.**

**3. What is Narrata's North Star metric?**
`company-vision`'s framework rejects vanity metrics and lists candidates
(completed stories, recurring creators, creator LTV). My recommendation:
**recurring creators who complete a second project** — it is the metric most
predictive of revenue and least gameable. `HYPOTHESIS`, and `company-vision`'s
call to make in `VISION.md`.

**4. Is Narrata India-first or global-first?**
Sarvam integration for Indic languages is a real, deliberate, differentiating
investment. If India-first, pricing must be a purchasing-power decision (₹ as
the primary denomination, not a converted USD price) — but Narrata's costs are
USD-denominated and unavoidably so, which compresses margin at INR price points
that feel fair locally. This tension is real and needs an explicit answer, with
`market-intelligence`.

**5. When does public signup open?**
Everything in §9's "NEXT" block is gated on this date, and none of it is built.
Monetization cannot ship before it, and public signup should not ship before
§9's guards. `product-manager` (currently unstaffed) would normally own this
sequencing.

**6. Should storage be a priced dimension at all?**
Recommendation: **no**, not while assets sit on local disk at flat cost. Revisit
when object storage lands. Needs `technical-architect` input on the VPS's actual
disk ceiling.

---

## Cross-agent asks

Ranked. **#1 is the single highest-leverage ask in this document.**

1. **`ai-architect` + `technical-architect` — capture `usage.cost`.**
   `apps/web/src/lib/ai/openrouter.ts`'s `pollVideoJob` already receives
   OpenRouter's exact USD charge per video call and discards it at line 303.
   Capturing it, plus a `GenerationEvent` record (draft schema in
   `./economics.md` §10), converts *every* estimate in these two documents into
   a measurement. This is a small change with disproportionate leverage — it is
   not "build a cost model", it is "stop throwing away the number the provider
   already hands us."
2. **`video-architect` — settle the default video model.** Open Question 1. An
   8× cost swing on Narrata's dominant cost line, and a one-week experiment
   (EXP-004) resolves it.
3. **`ui-ux-engineer`** — does "credits" read as clear or opaque to a
   storyteller, and where does a balance indicator live without breaking flow?
   (EXP-002.)
4. **`company-vision`** — Open Questions 2 and 3. Write `VISION.md`; this
   strategy currently has nothing to align against.
5. **`market-intelligence`** — own §6's competitor pricing table going forward,
   and validate the Indic-language segment hypothesis (§4).
6. **`growth-strategist`** — Base scenario implies roughly **$57 of affordable
   blended paid CAC** at a 3:1 LTV:CAC target (`./economics.md` §8). Treat that
   as the acquisition budget ceiling until real data replaces it.
7. **`qa-engineer`** — the two risks named in §9.
8. **`product-strategist`** — is the manual-first, per-step flow compatible with
   the YouTuber/short-form segment's velocity needs (§4)?

---

## Decision log

| Date | Decision | Status | Confidence |
|---|---|---|---|
| 2026-09-10 | Value metric = single AI credit, 1 cr ≈ $0.04 provider cost (§2) | Proposed | Medium-High |
| 2026-09-10 | Ladder = Free / Creator $18 / Studio $45 / packs (§3) | Proposed | Medium |
| 2026-09-10 | Free tier = ILLUSTRATION-only, 150 one-time credits (§5) | Proposed | Medium-High |
| 2026-09-10 | Beachhead = serious individual creators (§4) | Proposed | High |
| 2026-09-10 | No Team/Business/Enterprise tier until multi-seat exists (§3) | Proposed | High |
| 2026-09-10 | Text drafting, assembly, and export never cost credits (§2, §7) | Proposed | High |
| 2026-09-10 | Storage is not a priced dimension while on local disk (§10 Q6) | Proposed | Medium-High |
| 2026-09-10 | Primary paywall at VIDEO_GENERATION; secondary at Export rights (§7) | Proposed | Medium-High |
| 2026-09-10 | Do not monetize the current invite cohort (§1, Principle 9) | Proposed | High |
