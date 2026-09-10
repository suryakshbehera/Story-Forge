# Narrata — Feature Priorities (scored)

**Owner:** `product-strategist` · **Created:** 2026-09-10 · v1
Rationale and sequencing: [`./roadmap.md`](./roadmap.md).

Scored 1–10. **Priority** is a judgement, not the arithmetic mean — strategic
importance overrides raw score where noted.

| # | Item | User impact | Freq | Retention | Revenue | Diff. | Strategic | Feasibility | Eng. complexity | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Finish + commit illustration-timing work | 6 | 8 | 5 | 2 | 4 | 5 | 10 | LOW | **MUST BUILD NOW** |
| 2 | Deploy to VPS behind invite-only auth (+ retire `SIGNUP_CODE`, rate-limit `VIDEO_GENERATION`) | 9 | 10 | 9 | 8 | 3 | 10 | 8 | LOW–MED | **MUST BUILD NOW** |
| 3 | Reseed real voice IDs + Sarvam/Indic voice selection | 9 | 9 | 8 | 5 | 8 | 8 | 9 | LOW | **MUST BUILD NOW** (correctness bug) |
| 4 | Capture `usage.cost` + `GenerationEvent` | 2 | 10 | 3 | 10 | 5 | 10 | 9 | LOW | **MUST BUILD NOW** (highest leverage) |
| 5 | Default video model → Lite (after EXP-004) | 4 | 10 | 3 | 10 | 2 | 9 | 10 | TRIVIAL | **MUST BUILD NOW** |
| 6 | Export & Share (download, link, watermark path) | 10 | 8 | 9 | 7 | 4 | 8 | 8 | MED | **SHOULD BUILD SOON** |
| 7 | Guided first-run / time-to-first-video | 9 | 9 | 9 | 7 | 5 | 8 | 6 | MED | **SHOULD BUILD SOON** |
| 8 | Fold `/seedance` page into the registry-driven UI | 3 | 5 | 3 | 2 | 6 | 8 | 8 | LOW | **SHOULD BUILD SOON** |
| 9 | Funnel instrumentation on `GenerationEvent` | 2 | 10 | 4 | 8 | 3 | 8 | 9 | LOW | **SHOULD BUILD SOON** |
| 10 | Resumable job queue (`workers/`) | 7 | 7 | 7 | 6 | 7 | 9 | 4 | HIGH | **LATER** (next big rock) |
| 11 | Master AI Orchestrator (Phase 12) | 8 | 7 | 8 | 7 | 8 | 9 | 4 | HIGH | **LATER** (after 10) |
| 12 | Credits / billing / entitlement schema | 3 | 6 | 4 | 10 | 2 | 8 | 6 | MED–HIGH | **LATER** (after real cost data) |
| 13 | Embeddings continuity memory (Phase 13) | 7 | 4 | 7 | 5 | 9 | 9 | 5 | HIGH | **LATER** |
| 14 | Producer controls at scale (Phase 14) | 6 | 3 | 6 | 6 | 6 | 7 | 5 | MED–HIGH | **LATER** |
| 15 | Long-form chaining + re-anchoring | 7 | 3 | 6 | 6 | 8 | 7 | 3 | HIGH | **LATER** (blocked on 10) |
| 16 | EXP-004 blind Lite-vs-Standard test | — | — | — | — | — | — | — | LOW | **EXPERIMENT** (1 week, run with 2) |
| 17 | EXP-002 "do credits read as clear?" | — | — | — | — | — | — | — | LOW | **EXPERIMENT** (before 12) |
| 18 | Team / multi-seat / Enterprise | 4 | 2 | 5 | 7 | 3 | 5 | 3 | HIGH | **DO NOT BUILD** |
| 19 | Public API / white-label | 2 | 1 | 2 | 4 | 2 | 3 | 4 | HIGH | **DO NOT BUILD** |
| 20 | Translation / multi-format / distribution | 5 | 3 | 4 | 4 | 5 | 4 | 4 | HIGH | **DO NOT BUILD** (do #6 first) |
| 21 | Fraud detection / device fingerprinting | 1 | 1 | 1 | 2 | 1 | 2 | 5 | MED | **DO NOT BUILD** |
| 22 | Further per-model dedicated pages | 2 | 3 | 2 | 1 | 2 | 1 | 9 | LOW | **DO NOT BUILD** (registry drift) |

## Score overrides worth stating

- **#4 scores low on direct user impact and is still ranked top-tier.** Users never
  see it; it is the precondition for pricing, EXP-004, abuse control, and every
  quality metric. Classic infrastructure-with-outsized-optionality.
- **#6 (Export) scores highest on user impact but sits behind #2–#5.** Only because
  those are days of work each and gate real-user exposure and spend. It should be
  the first *feature* built after the deploy block.
- **#11 (Master AI) is high-scoring and still LATER.** The pipelines-before-
  orchestrator sequencing was deliberate and correct; #10 is its real prerequisite.
  Hard constraint when it lands: per-run credit ceiling + pre-run cost estimate,
  no auto-cascade past an approval gate.
