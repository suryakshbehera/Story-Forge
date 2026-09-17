# Narrata — Mobile App (React Native) UI/UX Plan

**Owner:** `ui-ux-engineer`
**Created:** 2026-09-15
**Status:** v1. First mobile design plan. **No mobile code of any kind exists today** —
this is a from-scratch product/UX definition, not a review.
**Companions:** [`./ux-audit-2026-09.md`](./ux-audit-2026-09.md) (internal web audit),
[`./competitor-ux-research-2026-09.md`](./competitor-ux-research-2026-09.md) (web
competitor study), [`./roadmap.md`](./roadmap.md) (product sequencing).

> **Both companion documents describe the *web* app.** They are product context
> here, not a mobile spec. Where this plan diverges from a decision made for web,
> §6 says so explicitly and gives the reason.

Evidence labels, same discipline as the competitor study:
`FACT` (read on the vendor's own site/docs, or verified in this repo, **today**) /
`ASSUMPTION` (third-party review, or reconstructed from several sources) /
`UNKNOWN` (could not establish).

---

## 0. Method & honesty note

- **No device, no simulator, no design tool, no image generation** in this
  environment. Every layout below is a textual region-by-region description. None
  of it is a claim about rendered pixels.
- **Repo claims were verified today** by reading `apps/web/src` (routes, `lib/auth.ts`,
  `lib/storage.ts`, `proxy.ts`, page files) and the workspace config. §1 is `FACT`.
- **Competitor claims** follow the same demotion rules as the competitor study:
  vendor docs and App Store listings are `FACT`-grade for *what the vendor says the
  product does*; third-party blogs are `ASSUMPTION`. I read the App Store listings
  and vendor learning-hub pages directly rather than relying on the earlier
  document's 2024-era changelog entries — and that turned up one correction worth
  flagging (§2.2).
- **This is a planning deliverable only.** No app code, no scaffold, no dependency
  added.

---

## 1. Verified current state (2026-09-15, `FACT`)

Everything here was checked in the repo today, because the whole shape of a mobile
app depends on it.

| Fact | Detail | Why it matters for mobile |
|---|---|---|
| **One app, one package** | `pnpm-workspace.yaml` globs are `apps/*` and `packages/*`. `apps/` contains only `web`. `packages/` contains only `db`. | A mobile app at `apps/mobile` is picked up by the existing workspace with **zero config change**. `packages/db` types are already shareable. |
| **`workers/` is an empty directory** | `workers/` exists at repo root, contains **zero files**, and is **not matched by either workspace glob**. | The roadmap's "no `workers/` exists" still holds. There is no background job runner to hang push notifications off. Generation runs inline in request handlers. |
| **There is effectively no read API** | 110 `route.ts` files. Method counts: **70 `POST`, 24 `DELETE`, 22 `GET`, 15 `PATCH`, 1 `PUT`.** 15 of 17 `page.tsx` files import `@/lib/db` and query Prisma directly. **Zero `"use client"` page files.** | The web client gets its reads from Server Components. A native app cannot. **Every mobile screen needs a JSON endpoint that does not exist today.** This is the single largest technical dependency in this plan. |
| **Auth is a DB-backed httpOnly session cookie** | `narrata_session`, `httpOnly`, `sameSite: "lax"`, 30-day TTL, no sliding renewal. The `Session` row stores only a **sha256 hash of an opaque random token** (`lib/auth.ts`). | The token model is already bearer-shaped. What is *browser-specific* is the cookie transport, not the credential. Flagged to `technical-architect` (§9), not resolved here. |
| **`proxy.ts` is the entire authorization model** | Default-deny; validates the cookie once, then attaches trusted `x-user-id` / `x-user-role` headers that every downstream route reads. | Whatever mobile auth is chosen **must flow through `proxy.ts`**, or the per-project ownership resolvers are bypassed. Not a UI decision. |
| **Media is local disk, served through the app** | `LocalDiskStorageProvider` writes under `STORAGE_ROOT`; bytes are served by `GET /api/storage/[...key]`, which `proxy.ts` documents as **login-gated only, not per-owner** ("any authenticated user can fetch any key"), a deliberate flagged trade-off. | No CDN, no signed URLs, no range-optimised delivery. Mobile prefetch, offline review and save-to-camera-roll all run through one Next route on one VPS. Flagged (§9). |
| **Useful endpoints that already exist** | `GET /api/projects/[id]/jobs` (in-flight claims + `stage` + `etaSeconds`), `GET /api/projects/[id]/estimates` (observed median cost/duration), `getActiveFailures()` in `lib/generation-events.ts`, `lib/project-status.ts`. | Three of mobile's four jobs have a partial data source already. This is the cheapest part of the plan. |
| **Take-selection is uniform across every asset type** | `isSelected` + full take history on shot images, video clips, narration, dialogue audio, music, SFX, silent renders, final renders. | The mobile app's core screen has exactly **one** object model to learn. |
| **The critic writes durable verdicts** | `Asset.validationPassed` / `validationNotes` / `validationModelId` are asset-type generic; `IMAGE_VALIDATION` now also judges continuity, and `VIDEO_VALIDATION` shipped 2026-09-14. | A mobile review card can show a *reason* to reject, not just a picture. This is the difference between a feed and a review tool. |
| **Design tokens exist and dark is authored** | Complete oklch token set + a full `.dark` palette in `globals.css`; `next-themes` wired 2026-09-11 (ux-audit 3.6). | The mobile design system inherits real colour/type decisions rather than inventing a second palette. |

---

## 2. Mobile research — what comparable products actually do

### 2.1 Luma Dream Machine — the one first-class native creator app in the set

| | |
|---|---|
| `FACT` (lumalabs.ai learning hub, iOS quick start) | Home screen has three areas: **Ideas** (the whole collection of generated images and videos, bottom-right button), **Boards** (grouped project assets), **Profile Settings** (bottom-left). |
| `FACT` (same) | Creation starts from a **plus (+) button at the bottom of the screen** → new board → prompt → **Generate**, which produces **a batch of 4 images**. |
| `FACT` (same) | Review is described as: **"swipe through the generated images and select the ones you like"** — then **More Like This** or **Brainstorm** to refine. |
| `FACT` (same) | A **three-dots menu downloads to the device**; an **upwards-arrow icon generates a shareable link**. |
| `FACT` (App Store listing) | **"Reference a person by giving just a single image of their face"** to generate them "in every setting and scene." **Modify** edits an existing image/video by describing the change. |
| `UNKNOWN` | Whether the app sends push notifications on generation completion. Not stated in either source. |
| `UNKNOWN` | Whether mobile state syncs with the web product (the App Store description does not mention sync). |

**The single most useful finding in this document** is Luma's verb split:
**swipe browses, tap selects.** Not swipe-to-decide. A swipe never commits state. For
a professional tool where a wrong commit costs a real generation, that is the correct
division and Narrata should adopt it verbatim (§5.1).

### 2.2 Runway — a correction to the existing competitor doc

`competitor-ux-research-2026-09.md` §1.4 records, from the Jul 2024 changelog:
*"Mobile App Generation Feed — mobile is a feed for viewing generations, not a
production surface."* **That precedent is out of date.**

| | |
|---|---|
| `FACT` (App Store listing, read today) | The iOS app advertises **text-to-video, image-to-video and video-to-video**, image creation from prompt or reference photo, **Runway Agent** ("describe what you want in plain language and Agent plans the shots, generates them and assembles the finished video"), and **consistent characters across generations**. |
| `FACT` (same) | **"If you already have a Runway account, your work syncs between your phone and your computer automatically."** |
| `FACT` (same) | Release notes for every version from 82.0.1 (May) to 96.0.2 (today) read only "Bug fixes and performance improvements." |
| `UNKNOWN` | Whether the infinite generation feed still exists as a surface. |
| `UNKNOWN` | Push-notification behaviour. |

**Two conclusions.** (1) Cross-device sync being *advertised as a feature* is a signal
that creators expect phone and desktop to be one continuous workspace — Narrata should
plan for that from day one, not bolt it on. (2) Runway has shipped the
**agent front door on mobile**, which is exactly the pattern the competitor study
rejected for Narrata as R4. The pull toward it is strongest on a phone, where typing a
prompt is easy and everything else is hard. §6 addresses this head-on.

### 2.3 Descript — a deliberate desktop-only stance

| | |
|---|---|
| `ASSUMPTION` (third-party reviews; Descript's own help index returned no mobile page) | Descript's core workflow — editing video by editing its transcript — is **desktop-only**, framed as needing a large screen, keyboard and processing power. Mobile is characterised as review and light edits at most. |
| `UNKNOWN` | Whether a first-party iOS app currently ships. Sources directly contradict each other; Descript's own help centre index surfaced no mobile article. **I am not treating either claim as established.** |

The transferable point survives the uncertainty: **the closest analog to Narrata's
"long text-heavy authoring surface" concluded that authoring does not go on the phone.**
Narrata's Story Setup is nine free-text fields and a `rows={20}` textarea (ux-audit P3).
That is the same conclusion, for the same reason.

### 2.4 CapCut — the mobile editor norm, and why Narrata is not it

| | |
|---|---|
| `ASSUMPTION` (third-party guides; CapCut's own resource page returned HTTP 451) | Timeline anchored at the **bottom** of the screen; tools (effects, audio, text, transitions) as **labelled tabs** above it; press-and-drag to reposition clips; trim/split/speed by gesture directly on the timeline. |
| `ASSUMPTION` (same) | The flow is: import → arrange on timeline → adjust via tool panels → export. |

**Rejected as a model, but one thing is worth taking:** the *bottom* of the screen owns
the primary manipulation surface, and tool panels are labelled tabs rather than icons.
Narrata does not have a timeline (R3, still rejected — §6), but the ergonomic rule holds.

### 2.5 Canva — the cautionary case

| | |
|---|---|
| `ASSUMPTION` (third-party comparisons) | Mobile **mirrors the desktop experience**; toolbars are hidden inside **sliding bottom sheets and expandable menus**, requiring taps through sub-menus for font weight, line spacing, layer order, transparency. |
| `ASSUMPTION` (same) | Result is described as "fiddly" for photo/video editing, and sluggish on complex documents. |

This is precisely the failure mode the user named: a shrunk desktop app. Canva is a
best-in-class product and it *still* produces this outcome when the IA is inherited
rather than redesigned. Bottom sheets did not save it, because the problem was never
the container — it was that the mobile app was asked to do the desktop job.

### 2.6 ElevenLabs — audio-first mobile is a real, separate product

| | |
|---|---|
| `ASSUMPTION` (help-centre summaries and App Store listing) | ElevenReader is a **listening** app: upload a file, paste text, scan a page or paste a URL; pick a narrator from 1,000+ voices; large audiobook library; offline mode on the paid tier. Cross-device continuity between mobile and web is stated. |

The instructive part is the framing: ElevenLabs did not ship "the ElevenLabs studio on a
phone." They shipped **the consumption half** of their product as a native app, and left
production on the web. That is the same instinct this plan applies to Narrata, with
"consumption" replaced by "judgement."

### 2.7 Platform-level mobile UX constraints (grounding for §4–5)

| | |
|---|---|
| `ASSUMPTION` (multiple third-party UX sources, consistent) | Thumb reachability splits the screen into thirds: **bottom third easy, middle neutral, top a stretch**. Primary navigation belongs in roughly the bottom 40%. |
| `ASSUMPTION` (same) | **Bottom tab bars work for 3–5 primary sections**; beyond five they collapse into a "More" tab. |
| `ASSUMPTION` (same) | **Full-screen modals are a thumb-zone problem** — dismiss control lands in the hardest-to-reach corner. Bottom sheets align with thumb ergonomics and support progressive disclosure. |
| `FACT` (Expo docs) | Push notifications **require a development build — they are not available in Expo Go** — and route through **FCM (Android) / APNs (iOS)**. |
| `FACT` (Expo docs) | **Headless background notifications have no delivery guarantee.** Apple's guidance is quoted as **"not more than two or three per hour"**; Android Doze can also suppress them. On Android, a user force-stopping the app from device settings stops notifications until it is manually reopened. |
| `FACT` (Expo docs) | iOS and Android differ on termination behaviour: iOS fires `NotificationResponseReceivedListener`; Android fires that **and** a JS task. iOS requires explicit configuration for headless background notifications; Android does not. |

**The ≤2–3/hour guidance is a design input, not a footnote.** A 20-shot image batch
must never become 20 pushes. It forces batching at the *job* level (§5.3).

### 2.8 The web-platform ceiling (grounding for §7)

| | |
|---|---|
| `FACT` (MDN, `share_target` manifest member) | Marked **"Limited availability — This feature is not Baseline because it does not work in some of the most widely-used browsers"** and additionally flagged **Experimental**. |
| `FACT` (MDN, Push API) | Push API is Baseline/widely available since March 2023, **requires an active service worker**, and increases battery/resource usage. Firefox imposes a push-message quota. |
| `ASSUMPTION` (several third-party sources, mutually consistent) | On iOS, web push works **only for a PWA installed via Share → Add to Home Screen**; a normal Safari tab has no `PushManager`. Safari does **not** implement `beforeinstallprompt`, so every iOS install is a manual, user-instructed Add to Home Screen. Safari has not implemented Web Share **Target**, so an iOS PWA cannot register as a share *destination* (it can still share *out*). EU PWAs were degraded to Safari tabs with no push in 2024. |

---

## 3. Product thesis for mobile

### 3.1 The thesis

> **Narrata mobile is the surface that keeps a production alive between desk
> sessions. It is where you judge the work, watch the machine, ship the result, and
> capture raw material — not where you author the story.**
>
> Its operating rule is: **judge, don't author. Retake, don't originate.**

Web remains the **studio**: writing, structure, scene and shot planning, model
settings, assembly. Mobile is the **producer's phone**: the thing that buzzes, the
thing you pull out in a queue, the thing you post from.

### 3.2 The four jobs, in the order a session actually happens

**1. Watch — know what the machine is doing without holding a tab open.**
Today the entire feedback mechanism for a multi-minute video render is a 5-second poll
in an open tab (`GET /api/projects/[id]/jobs`). Background the tab and you get nothing;
close it and the job keeps running invisibly (ux-audit F5, partially fixed by 2.1/4.2).
A push notification is not a nicer spinner — it is a **structurally different
relationship with a long job**: start it at the desk, walk away, get told. A whole
third-party product exists solely to bolt push notifications onto web AI tools
(`ASSUMPTION`, a product called push.fwd surfaced in search; its site did not resolve
for direct verification), which is decent evidence the gap is real and widely felt.

**2. Judge — decide which take is the one.**
This is Narrata's core review mechanic, uniform across every asset type (§1), and it is
the one job a phone does **better than the web app, not merely adequately**. On web, a
shot image is a `w-40 h-24` thumbnail inside three nested cards in an unbounded scroll
(ux-audit F4, F12). On a phone it is a full-bleed, colour-accurate, retina image that
fills your visual field, one at a time, with the verdict button under your thumb. Audio
takes are stronger still: reviewing narration and music on headphones while walking is a
better judging environment than desk speakers.

**3. Ship — get the finished thing out of the building.**
The roadmap calls export "simultaneously the activation finish line, the retention proof
point, and Narrata's cheapest distribution channel" (#6), and the audit calls its absence
F2, "the journey has no ending." Web's answer (shipped as 0.1) is a Download button and a
copyable link. **On a phone the same action is one tap into the OS share sheet — into
Instagram, TikTok, WhatsApp, a client's inbox — or straight into the camera roll.** The
destination for almost every creator video is a phone. Exporting on desktop means
downloading a file you then have to move to your phone anyway.

**4. Capture — get raw material in from where it actually lives.**
Manual-first says the human writes, edits, locks and selects. It does **not** say the
human must be at a desk to contribute. A location photo, a face reference for a
character, a voice memo of a plot fix at 2am — these originate on a phone and today have
no route into a project except emailing them to yourself. Luma's "reference a person from
a single image of their face" (`FACT`) is the same insight, and Narrata already has the
receiving structure: `Character.referenceImages`, `Location` images, style reference,
lockable entities feeding the Context Engine.

### 3.3 What mobile deliberately leaves to web

Story Setup and script writing. Story Bible. Scene creation and ordering. Shot planning.
Prompt authoring and the structured Prompt Builder. Per-project model settings and the AI
model registry. The Silent → Cue Plan → Final assembly chain. Admin, invites, people.

Rationale in one line each: **long-form text input, dense multi-object comparison, and
irreversible sequencing decisions are all desk work.** Attempting them on a phone
produces Canva's outcome (§2.5).

### 3.4 The one deliberately ambiguous edge: retake

Pure review is a dead end. You reject a take and then… nothing? So mobile **can**
re-generate a slot it is already reviewing — "Retake" — but **cannot originate**: no new
scene, no new shot, no new project's worth of generation, no batch kickoff, no prompt
box that produces a video from nothing.

This is the line that keeps mobile from drifting into a production surface by accretion,
and it maps exactly onto LTX's own vocabulary — "Retake regenerates a specific shot while
holding visual consistency, instead of rebuilding the sequence" (`FACT`, recorded in the
competitor study §1.1). Rejecting and retrying is **one continuous act of judgement**.
Originating is authoring, and authoring is web.

---

## 4. Information architecture and core screens

### 4.1 Global structure

```
┌─────────────────────────────────────┐
│  (screen content — full bleed        │
│   wherever media is involved)        │
│                                      │
├─────────────────────────────────────┤
│  [ Review ]   [ Projects ]   [ Activity ] │   ← bottom tab bar, 3 tabs
└─────────────────────────────────────┘
```

Three tabs, matching the 3–5 guidance (§2.7), all inside the thumb zone.
**No hamburger, no drawer, no top-nav tabs.** Settings lives inside Projects → account
row, because it is rare.

**Launch rule (a deliberate divergence from web — see §6.5):** the app opens on
**Review** when the queue is non-empty, otherwise on **Projects**. Web's home is a
project status board because a web session begins "I sat down to work on project X." A
mobile session begins "something pulled me in" or "I have four minutes." The entry point
follows the context of use.

### 4.2 Screen: Review (the reason the app exists)

A **verdict queue**, not a feed and not a library. It contains exactly the slots across
all projects that are waiting for a human decision: a shot with unselected images, a
scene with unselected video takes, a narration line with unselected audio, a music bed, a
silent render. Ordered by pipeline position so judging in queue order walks the story
forward.

```
┌─────────────────────────────────────┐
│ ╭───────────────────────────────╮   │ ← A. Context bar (top, informational only)
│ │ Moonlit Crossing · Scene 4     │   │   project · scene
│ │ Shot 2 of 6 · Image-to-Video   │   │   position · visualMode (label, never nav)
│ ╰───────────────────────────────╯   │
│                                      │
│                                      │
│         [ FULL-BLEED MEDIA ]         │ ← B. The take. Fills the frame.
│                                      │   Image: tap-to-zoom. Video: autoplay
│          ● ○ ○ ○                     │   muted, loop. Audio: waveform + scrubber.
│        Take 1 of 4                   │   Dots = take history position.
│                                      │
│  ⚠ Continuity: Kael's jacket differs │ ← C. Critic verdict, only when present.
│    from Shot 1.            [ Why? ]  │   From Asset.validationNotes.
│                                      │
├─────────────────────────────────────┤
│  ♡ Keep    ⧉ Compare    ↻ Retake     │ ← D. Secondary row (middle/neutral zone)
│                                      │
│  ╭─────────────────────────────────╮ │ ← E. Primary verdict. Thumb zone.
│  │        Use this take             │ │   Full-width. The one obvious action.
│  ╰─────────────────────────────────╯ │
│           Skip for now  ›            │ ← F. Defer, never destructive
└─────────────────────────────────────┘
```

Region notes:

- **A. Context bar.** Answers "where am I" without navigation. The scene's
  `visualMode` appears here as a **label** because an ILLUSTRATION take and an
  IMAGE_TO_VIDEO take are judged by different criteria — the reviewer needs to know
  which. It is never a filter, never a tab, never a mode switch (§6.1).
- **B. Media.** Full-bleed is the entire point. This is the region where mobile beats
  web outright.
- **C. Critic verdict.** Present only when `validationPassed === false`. Follows
  Problem → Explanation → Action: the notes line is the problem, `[ Why? ]` opens a
  bottom sheet with the reference image the critic compared against, and the actions
  are already on screen (Retake / Use anyway / Skip). Never a bare warning.
- **D. Secondary row.** `Keep` = favourite (this is competitor-study item 6.2, a flag
  that does not exist in schema yet — flagged in §9). `Compare` is the button
  equivalent of long-press (§5.1). `Retake` opens the pre-flight sheet (§4.3).
- **E. Primary.** One action, full width, bottom. Writes `isSelected` through the
  existing take-selection endpoints.
- **F. Skip.** Advances the queue, commits nothing. Deliberately styled as the weakest
  thing on screen so it is never confused with a verdict.

**Empty state** (the queue is clear) is not "No items." It is a completion moment:
*"Everything's judged. 3 scenes have images but no video yet — continue on web."* with
the project's next pipeline step named. The empty state carries the handoff.

### 4.3 Sheet: Retake pre-flight

Triggered from `↻ Retake`. A **bottom sheet at ~50% detent**, not a full-screen modal
(§2.7 — dismiss lands in the worst corner of a full-screen modal).

```
┌─────────────────────────────────────┐
│              ──────                  │ ← drag handle
│  Retake this shot                    │
│                                      │
│  Scope    1 image                    │ ← scope first, cost second — per the
│  Typical  ~35s · ~$0.04              │   competitor study's finding that creators
│           (from your last 12 runs)   │   reason in units of work, not dollars
│                                      │
│  Change something?                   │
│  ╭─────────────────────────────────╮ │ ← single optional free-text line.
│  │ (leave empty to retry as-is)    │ │   NOT a prompt box — an amendment to an
│  ╰─────────────────────────────────╯ │   existing, human-authored prompt.
│                                      │
│  ╭─────────────────────────────────╮ │
│  │        Start retake              │ │
│  ╰─────────────────────────────────╯ │
└─────────────────────────────────────┘
```

Reads `GET /api/projects/[id]/estimates`, which already returns observed-median cost and
duration (§1). The sheet dismisses immediately on Start — **the user does not wait**;
they get a push when it lands (§5.3). That is the whole async model in one interaction.

### 4.4 Screen: Projects (list)

```
┌─────────────────────────────────────┐
│  Projects                        ⚙  │
│                                      │
│  ╭─ Inbox ─────────────────── 3 ─╮  │ ← captured-but-unfiled items (§5.4)
│  ╰────────────────────────────────╯  │
│                                      │
│  ╭────────────────────────────────╮  │
│  │ [cover] Moonlit Crossing        │  │
│  │         Scenes · 8 of 12 done   │  │ ← one pipeline-progress line
│  │         ● 6 waiting  ◐ 2 running│  │ ← the two numbers that drive action
│  ╰────────────────────────────────╯  │
│  ╭────────────────────────────────╮  │
│  │ [cover] The Salt Road           │  │
│  │         Final render ready      │  │
│  │         ✓ nothing waiting       │  │
│  ╰────────────────────────────────╯  │
└─────────────────────────────────────┘
```

Tapping the "N waiting" chip opens Review **filtered to that project**. The list is
otherwise read-only. There is **no "New Project" button on this screen** — project
creation only exists as the tail of a capture (§5.4), and it hands off to web
immediately.

### 4.5 Screen: Project detail

A vertical, mobile-shaped restatement of the web status board at `/projects/[id]`
(ux-audit 1.1, shipped) — same rows, same order, same completion semantics. Not a new
model, a **second rendering of the one that already exists**.

```
┌─────────────────────────────────────┐
│  ‹ Moonlit Crossing                  │
│  ┌─────────────────────────────────┐ │
│  │  [ latest render, tap to play ] │ │ ← hero: the most recent silent or final
│  └─────────────────────────────────┘ │   cut. The project's face is its footage.
│                                      │
│  ✓ Story          ✓ Characters (3)   │ ← pipeline rows, read-only, ticked
│  ✓ Locations (2)  ✓ Scenes (12)      │
│  ◐ Shot images    18 of 24           │
│  ● Video          6 waiting  ›       │ ← taps into Review, filtered
│  ○ Voice          not started        │
│  ○ Final render   —                  │
│                                      │
│  ╭─────────────────────────────────╮ │
│  │      Review 6 takes              │ │ ← one primary action, mirrors web's
│  ╰─────────────────────────────────╯ │   "Continue"
│                                      │
│  Renders (3)                      ›  │ ← §4.6
│  Add reference / note             +  │ ← §5.4 capture, scoped to this project
│  Continue on web                  ↗  │ ← explicit, honest handoff
└─────────────────────────────────────┘
```

Rows for steps mobile does not perform (Story, Scenes, Shot planning) are **status
only** — they show state and tapping them explains what happens on web. They are never
dead ends and never fake buttons.

### 4.6 Screen: Renders shelf (the Ship surface)

```
┌─────────────────────────────────────┐
│  ‹ Renders · Moonlit Crossing        │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │  [ video, tap to play fullscreen]│ │
│  │  Final cut · 2:14 · 1080p · 38MB │ │ ← the metadata web gained in 0.1
│  │  Selected · rendered 2h ago      │ │
│  └─────────────────────────────────┘ │
│   ⬇ Save to Photos   ↗ Share   ⧉ Link│ ← the three native actions
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ Silent picture · 2:14 · no audio │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

`Share` is the **OS share sheet**, not a Narrata-designed share dialog. That is the
entire point: the destination list is the user's actual posting apps, and the app
disappears at the moment of shipping.

### 4.7 Screen: Activity

```
┌─────────────────────────────────────┐
│  Activity                            │
│                                      │
│  RUNNING                             │
│  ◐ Scene 4 video · Rendering · ~2m   │ ← stage + ETA already exist in
│  ◐ Scene 7 narration · Queued        │   GET /api/projects/[id]/jobs
│                                      │
│  NEEDS YOU                           │
│  ⚠ Scene 2 music failed              │ ← from getActiveFailures()
│    ElevenLabs · rate limited         │   names the provider that actually ran
│    [ Retry ]  [ What happened? ]     │
│                                      │
│  DONE TODAY                          │
│  ✓ Scene 3 · 6 images   → Review     │
│  ✓ Final render         → Renders    │
└─────────────────────────────────────┘
```

Three sections, in descending order of how much they demand of the user. "Queued ≠
failed" is stated in the interface (competitor study A8). Every failure names the real
provider and model, which the web routes already echo.

### 4.8 What the object model looks like on a phone

The web hierarchy (Project → Story → Scene → Shot → Asset/take) is **preserved, not
flattened** — but mobile navigates it *bottom-up* rather than top-down. You arrive at a
take (via notification or queue) and the context bar tells you what it belongs to, with
the parent reachable by tapping it. Web arrives top-down: project → scenes page → scroll
to scene → open shots → find image.

Same tree. Opposite entry direction. That is the clearest single expression of "review
tool, not authoring tool."

---

## 5. Mobile-native interactions

Every interaction below is chosen because it is **better on a phone**, not because it is
possible on a phone.

### 5.1 Take selection: swipe browses, tap selects, hold compares

Grounded directly in Luma's documented model (§2.1) — *"swipe through the generated
images and select the ones you like."* Swipe is navigation; commitment is a tap.

| Gesture | Does | Commits state? | Visible equivalent (required) |
|---|---|---|---|
| **Swipe left/right** | Move through the take history for this slot | No | Dot indicator is tappable; `‹ ›` on tablet widths |
| **Tap `Use this take`** | Sets `isSelected` | **Yes** | — (it is the button) |
| **Long-press media** | **Compare** — holds and swaps the frame to the currently-selected take, or to shot N−1's image when the slot is a continuity-relevant shot. Release returns. | No | `⧉ Compare` button in region D |
| **Swipe up / `Skip for now`** | Next slot in queue | No | `Skip for now ›` |
| **Pinch / double-tap** | Zoom into image detail | No | — (standard platform gesture) |

Two hard rules:
1. **No gesture commits a decision.** No Tinder swipe-to-approve. In a tool where a
   mis-swipe costs a generation and silently changes the film, an invisible,
   accidentally-triggerable commit is the wrong trade. Selection is always a deliberate,
   labelled tap.
2. **Every gesture has a visible control equivalent.** Required by accessibility (§15
   of the design charter) and by discoverability — a gesture nobody finds is a feature
   nobody has.

**Why long-press-to-compare is the standout.** Narrata's hardest judgement is *"is this
the same character/place/lighting as the previous shot?"* On web that means two ~160px
thumbnails side by side. On a phone, press-and-hold swaps the **same full-screen frame**
between two images — the strongest possible way for a human eye to detect a difference,
because position, scale and surroundings are held constant. The data is already loaded:
`lib/shot-images.ts` fetches shot N−1's selected image for continuity, and the
`IMAGE_VALIDATION` critic already compares against it. **This is Narrata's continuity
differentiator finally getting an interface that suits it, and mobile is where it fits.**

### 5.2 Audio review is a first-class mode, not a fallback

Voice, narration, music and SFX takes get a dedicated card: large waveform, scrub,
loop-a-region, and A/B between takes on **headphone tap** where the platform exposes it
(`UNKNOWN` — needs a device check). Playback continues with the screen locked, with
lock-screen transport controls, so an entire scene's narration takes can be auditioned
on a walk.

This is also the natural home for the fix to ux-audit **F16** (voice identity is an
opaque free-text provider ID with no audition). The web `VoicePicker` shipped preview;
mobile makes auditioning the *default* way you encounter a voice.

### 5.3 Push notifications replace polling — with batching as a design constraint

Web's job tray polls `GET /api/projects/[id]/jobs` every 5 seconds *while the tab is
open on a project route*. Mobile inverts this: the server tells the device.

Expo's documented constraints (§2.7) drive the design, not the other way round:

| Constraint (`FACT`, Expo docs) | Design consequence |
|---|---|
| Apple: "not more than two or three per hour" | **One notification per completed job batch, never per asset.** "Scene 4: 6 images ready" — not six notifications. A batch is the unit. |
| No delivery guarantee for background notifications; Android Doze; force-stop kills delivery | **Notifications are an accelerant, never the source of truth.** Activity (§4.7) must be correct on open regardless of what was delivered. Nothing is only knowable via a push. |
| Requires a development build (not Expo Go) | Affects the build pipeline from day one — flagged to `technical-architect` (§9). |
| iOS/Android differ on cold-start handling | Deep-link routing must be tested on both from the cold-terminated state, not just foreground. |

**Notification content is a decision, not a string.** Three types only:

- **Ready** — "Moonlit Crossing · Scene 4: 6 images ready to review." → deep-links into
  Review filtered to that batch.
- **Failed** — "Scene 2 music failed — ElevenLabs rate limit." → deep-links to Activity
  with the retry in reach. Names the provider that actually ran.
- **Done** — "Final render ready · 2:14." → deep-links to Renders. This is the only one
  that should ever feel celebratory.

Plus a **quiet-hours** setting and a **per-project mute**, because a 20-scene production
generates a lot of events and the fastest way to lose notification permission is to
spend it.

### 5.4 Capture: camera, microphone and the share sheet, pointed at the pipeline

Four entry points, each landing somewhere the pipeline already understands:

| Capture | Lands as | Why the phone is the right device |
|---|---|---|
| **Camera / camera roll → reference image** | `Character.referenceImages` or `Location` images, via the existing image-upload routes | The photo of the face, the street, the jacket is already in your pocket. Luma's single-face-reference is the same insight (`FACT`, §2.1). |
| **Voice memo → note** | An audio note attached to a project or scene, with optional transcript | Manual-first's mobile form. The human is still authoring; the phone is just a faster pen. A plot fix at 2am currently has no route into the product. |
| **OS share sheet → Narrata** | Inbox item (image, video, link, or text shared from Photos, Instagram, Safari, Notes) | The single capability with **no web equivalent on iOS** (§2.8). This is a platform-exclusive, not a convenience. |
| **Quick idea → new project shell** | A `Project` with a name and the captured material attached; **immediately hands off**: "Open on web to write the story." | Captures the impulse without pretending Story Setup happens here. |

**A captured item is never auto-applied.** It lands in an Inbox, the human files it, the
human picks which character it references, the human decides whether it becomes a
reference image. Manual-first is preserved exactly: AI (or in this case the device)
supplies material into a slot the human controls.

**Open design question flagged, not answered:** captured-but-unfiled items need a schema
home. There is no "inbox" or "note" entity today. See §9.

### 5.5 Offline and the review queue

The review queue is the one surface worth making work without a connection — judging is
exactly the thing you do on a train.

- **Prefetch** the next N slots' media when on Wi-Fi. Images are cheap; video clips are
  not — clip prefetch should be Wi-Fi-only and count-capped.
- **Verdicts queue locally** and flush on reconnect, with an obvious pending indicator
  per item. Never silently.
- **Conflict rule — and it is a product decision, not a sync detail.** If the same slot
  changed on web while the device was offline, **do not last-write-wins.** Surface it:
  *"You picked Take 3 offline. Take 1 was selected on web since. Which stands?"* A
  manual-first product must not resolve a human's decision against another human's
  decision by timestamp. The human re-decides.
- **Retakes never queue offline.** They cost money and need a live pre-flight estimate.
  Offline, `Retake` is disabled with a stated reason.

### 5.6 Motion, haptics and the feel

- **Haptics carry state, never decoration.** A light impact on take change (browse), a
  success notification haptic on `Use this take` (commit), an error haptic on failure.
  The commit haptic is what makes a decision *feel* decided.
- **Motion is short and functional**: 150–200ms take transitions, a spring on queue
  advance. Everything respects Reduce Motion.
- **Dark by default.** Judging images and video against a dark surround is the correct
  environment for colour and exposure, and it is what creator tools default to — Runway
  ran dark-only until Light Mode shipped in Sep 2025 (`FACT`, recorded in the competitor
  study §1.4). The `.dark` oklch palette already exists (§1). Light mode still ships,
  the *default* just inverts relative to web.
- **Dynamic Type / font scaling supported throughout.** Region B (media) is fixed;
  regions A, C, D, E reflow.

---

## 6. Divergences from web decisions, stated explicitly

The brief asks that any departure from a web decision be named and justified. Five
relevant decisions; **three hold, one holds with a sharper edge, one diverges.**

### 6.1 Mode-first navigation (web R5: rejected) — **HOLDS, more strongly**

`visualMode` remains a per-scene narrative property, never top-level navigation. Mobile
adds one requirement web does not have: because a mobile reviewer arrives at a take
*bottom-up* (§4.8) with no surrounding page context, the mode must be **stated on the
review card** (region A). An ILLUSTRATION frame and an IMAGE_TO_VIDEO frame are judged
against different expectations, and the reviewer must know which without navigating.
A label, not a filter.

### 6.2 Infinite spatial canvas (web R2: rejected) — **HOLDS**

Order is the story; a canvas makes order ambiguous. On a 390pt-wide screen a pannable
canvas is also simply unusable. Trivially rejected.

### 6.3 Node-based workflow editor (web R1: rejected) — **HOLDS**

Asking the user to become the pipeline is the direct opposite of the charter. Not
buildable on a phone and not wanted.

### 6.4 Agent / prompt-to-video front door (web R4: rejected) — **HOLDS, and this is the live risk**

Runway has now shipped exactly this on mobile — "describe what you want in plain language
and Agent plans the shots, generates them and assembles the finished video" (`FACT`,
§2.2). The gravitational pull is strongest on a phone, because a prompt box is the only
input modality a phone makes *easier* than a desktop.

**Rejected anyway, and the app is architected so it cannot drift into it**: the "judge,
don't author / retake, don't originate" rule (§3.4) means there is no surface on mobile
that turns nothing into a video. The one free-text field in the entire app is the
"change something?" line in the retake sheet (§4.3), which amends a prompt a human
already wrote on web. If a prompt-to-video accelerator is ever wanted, it is a **web**
decision owned by `product-strategist`, and shipping it on mobile first would decide it
by accident.

### 6.5 Home = project status board (web ux-audit 1.1) — **DIVERGES**

Web's home is a project status board with one "Continue" action, and that is right for
web. **Mobile's default landing tab is Review when anything is waiting.**

*Why:* the two contexts of use are different. A web session is chosen and scheduled —
you open a laptop to work on a project. A mobile session is interrupted and short —
triggered by a notification, or by four spare minutes. Landing a notification-driven
session on a status board costs two taps before the user reaches the thing they were
told about.

*Why this is not "library as home" (web R7, rejected):* R7 rejected making a **browse
library** the home, because Narrata's unit of work is a story, not a clip. Review is not
a library — it is an ordered, finite, pipeline-sequenced **work queue that empties**. It
cannot be browsed and it has a completion state. Projects remains the structural home
and the fallback when the queue is clear.

### 6.6 Take-selection idiom: same model, different interaction — **intentional**

The conceptual model carries over exactly (one `isSelected` per slot, full history, "use
this take"). The *interaction* deliberately does not: web is a gallery of thumbnails with
a button per tile; mobile is one full-bleed take at a time with swipe-to-browse,
hold-to-compare and a single thumb-zone verdict. Same object model, opposite density.
This is the plan's central answer to "not a shrunk desktop app."

### 6.7 Read-only filmstrip (web D1, planned as 5.3) — **adapted into something better on mobile**

Web's planned filmstrip is a horizontal strip of selected frames for reviewing the
assembled sequence. On a phone the superior form is obvious: **watch the silent cut
full-screen, and tap the screen at any moment to flag that scene.** A flag files the
scene back into the Review queue with a timestamp. Same job — review the assembled
sequence, spot what is wrong — in the form the device is actually good at. Still
read-only; still not an editable timeline (R3 holds).

---

## 7. Why this, and not a responsive web UI or a PWA

The honest counter-argument first: **Narrata's web app could be given a separate,
mobile-shaped route tree.** Nothing about the four jobs in §3.2 is conceptually
impossible in a browser, and it would reuse one codebase, one deploy and one auth model.
That argument deserves to be taken seriously rather than waved away, and if the only goal
were "make the existing screens usable at 390px," a responsive pass would be the correct
and much cheaper answer. (Web ux-audit 3.4 already did the minimum version of that.)

Four things decide it the other way.

**1. Capture has no iOS web path.** The Web Share **Target** API — the thing that lets an
app appear in the OS share sheet as a *destination* — is marked by MDN as **"Limited
availability… not Baseline because it does not work in some of the most widely-used
browsers"** and **Experimental** (`FACT`, §2.8), and multiple sources agree Safari has not
implemented it (`ASSUMPTION`). "Share this photo from Instagram into Narrata as a
character reference" is a native-only capability on iOS. That is job #4 (§3.2), gone.

**2. Push on iOS is gated behind a manual install step almost nobody completes.** iOS web
push requires the site to be added to the Home Screen via Share → Add to Home Screen, and
Safari implements no `beforeinstallprompt`, so there is no one-tap install — the app must
*instruct* the user through it (`ASSUMPTION`, consistent across sources). EU PWAs were
degraded further in 2024. A notification channel whose reach depends on talking users
through a multi-step Safari install is not a foundation for job #1 (§3.2).

**3. Shipping is a native handoff.** Save-to-camera-roll and the OS share sheet as an
*outbound* target are what turn "a file exists on disk" (roadmap #7's phrasing of the
problem) into a posted video. A browser download on a phone is a file in a Files app.

**4. The cost argument is weaker than it looks.** The usual reason to pick a PWA is reuse
— but Narrata has **no read API to reuse** (§1: 22 GETs across 110 route files; 15 of 17
pages read Prisma directly in Server Components). A mobile-shaped web experience would
need the same JSON read layer a native app needs, because it would need to be a client
app to feel like one. The read-API work is a **shared, unavoidable cost of any mobile
surface**, not a native-only tax. What native additionally costs is the shell, the store
pipeline and platform QA. What it additionally buys is jobs #1 and #4 outright.

**And the design reason, which matters most.** A responsive web build inherits the web
IA by default — that is its entire economic appeal, and it is exactly the failure mode
Canva demonstrates at full scale (§2.5). The brief's instruction was that mobile be
*simpler and different*, not the same product at a smaller width. A separate app makes
that difference structural instead of a matter of discipline.

**What would change this call:** if the app is Android-first (Share Target and push both
work in Chrome on Android), or if capture and share turn out to be unwanted, the PWA
argument gets materially stronger. Worth re-testing with `product-strategist` and
`growth-strategist` before Phase M0 starts, not after.

---

## 8. Phased build plan

Rough dev-days for one engineer, matching the convention in the companion documents.
**Backend work owned by `technical-architect` is called out but not costed here** — the
read API in particular is a substantial separate item (§9).

**Sequencing precondition:** this plan should not start before the web product loop is
closed (roadmap Sprint 1–4: deploy guards, voice IDs, export, first-run). A review app
for a product with no users to review for, and a share button for a pipeline whose output
nobody has produced yet, is out of order. Flagged to `product-manager` (§9).

### Phase M0 — Foundations and the two spikes (~8–10d)

| # | Item | Est. | Notes |
|---|---|---|---|
| M0.1 | **Read-path spike.** One real screen (Projects list + project detail) against whatever read-API shape `technical-architect` chooses. Proves the shape before 40 screens depend on it. | 3d | **Blocked on §9 ask 1.** |
| M0.2 | **Auth spike.** Mobile session against the existing `Session` table, routed through `proxy.ts`'s default-deny gate. | 2d | **Blocked on §9 ask 2.** |
| M0.3 | App skeleton: 3-tab shell, navigation, dark-first token port from `globals.css`'s oklch set, typography scale, Dynamic Type. | 3d | |
| M0.4 | **Media spike.** Can a phone load `GET /api/storage/[...key]` from the VPS at acceptable speed for full-bleed review, and can it cache? | 1–2d | Informs whether M5.1 is viable at all. |

### Phase M1 — Watch (~7–9d)

| # | Item | Est. | Notes |
|---|---|---|---|
| M1.1 | Push registration, permission priming (ask *after* the first generation is started, never on launch), token storage, quiet hours, per-project mute. | 2d | Requires a dev build, not Expo Go (`FACT`). |
| M1.2 | Server-side completion notify, **batched at job level** to respect the ≤2–3/hr guidance. | 2d | Backend; shared with `technical-architect`. |
| M1.3 | Activity screen: Running / Needs you / Done today, reusing `/api/projects/[id]/jobs` (stage + ETA) and `getActiveFailures()`. | 3d | Data already exists. |
| M1.4 | Deep-link routing from all three notification types, tested from cold-terminated state on both platforms. | 1–2d | iOS/Android differ (`FACT`). |

### Phase M2 — Judge (~13–15d) — the core of the product

| # | Item | Est. | Notes |
|---|---|---|---|
| M2.1 | Verdict-queue construction (cross-project, pipeline-ordered, filterable to one project) + its endpoint. | 4d | New query shape; no equivalent exists. |
| M2.2 | Take card: full-bleed media, swipe-to-browse history, `Use this take`, `Skip`, context bar with `visualMode`. | 4d | |
| M2.3 | **Long-press compare** — against currently-selected take, and against shot N−1's continuity reference. | 2d | The signature interaction (§5.1). |
| M2.4 | Audio take review: waveform, scrub, background playback, lock-screen transport. | 2.5d | |
| M2.5 | Critic verdict surfacing (`validationPassed` / `validationNotes`) as Problem → Explanation → Action, with the compared reference in a sheet. | 1.5d | Fields already exist. |

### Phase M3 — Ship (~7–8d)

| # | Item | Est. | Notes |
|---|---|---|---|
| M3.1 | Renders shelf: every silent and final render per project, with duration / resolution / size. | 1.5d | Mirrors web 0.1's metadata. |
| M3.2 | Save to Photos + OS share sheet + copy link. | 1.5d | The activation finish line, natively. |
| M3.3 | Retake pre-flight sheet, reading `/api/projects/[id]/estimates`; fire-and-forget with push on completion. | 2d | |
| M3.4 | **Watch the cut**: full-screen silent/final playback with tap-to-flag-a-scene, filing flags into the Review queue. | 2d | §6.7. |
| M3.5 | Completion moment on first export — "you made this," not a toast. | 1d | Closes ux-audit F2 on mobile. |

### Phase M4 — Capture (~9–10d)

| # | Item | Est. | Notes |
|---|---|---|---|
| M4.1 | iOS Share Extension + Android share target: "Share to Narrata." | 3d | The native-only capability (§7). |
| M4.2 | Camera / camera roll → character or location reference image, lock-state aware. | 2d | Uses existing upload routes. |
| M4.3 | Voice memo → note on a project or scene, optional transcript. | 2d | **Needs a schema home — §9 ask 4.** |
| M4.4 | Inbox: list, file-into-project, and quick-idea → project shell with an explicit web handoff. | 2–3d | |

### Phase M5 — Offline, accessibility and polish (~7–8d)

| # | Item | Est. | Notes |
|---|---|---|---|
| M5.1 | Prefetch next N review slots (Wi-Fi-only for clips); local verdict queue with visible pending state. | 3d | Gated on M0.4's finding. |
| M5.2 | Conflict resolution UI — "changed on web while you were away," human re-decides. | 1.5d | A product rule, not a merge strategy (§5.5). |
| M5.3 | Accessibility pass: every gesture has a visible control, VoiceOver/TalkBack labels on all media and verdict controls, Reduce Motion, contrast check on the dark palette, focus order. | 2.5d | Not deferrable — the web app's F9 is a lesson. |

### Headline

**~44–50 dev-days ≈ 9–10 weeks for one engineer**, excluding the read API, push
infrastructure and any schema additions, which are owned elsewhere.

**Minimum shippable slice: M0 + M1 + M2 (~28–34d).** That is a real, defensible product
on its own — *"know what's running, and judge the takes"* — and it is the half that
contains everything mobile does better than web. M3 (Ship) is the highest-value single
phase per day and could be pulled forward ahead of M2.4/M2.5 if activation metrics are
the priority.

---

## 9. What we are deliberately NOT building

| Item | Why not |
|---|---|
| **Story Setup, script writing, Story Bible on mobile** | Nine free-text fields and a 20-row textarea. The closest analog (Descript) reached the same conclusion for the same reason (§2.3). The app names the handoff instead of faking the capability. |
| **Scene creation, scene ordering, shot planning** | Sequencing decisions with wide blast radius, made against many objects at once. Desk work. |
| **Prompt authoring / the structured Prompt Builder** | The web Prompt Builder is subject/action/camera/style/beats/ending. That is a form, and forms are the worst thing on a phone. The retake sheet's single amendment line is the deliberate, bounded exception. |
| **Model selection, AI model registry, per-project model defaults** | ux-audit F8 — AI architecture leaking into the interface — would be worse on mobile, where there is no room to explain it. Mobile shows *what ran* on failure; it never asks *what should run*. |
| **The assembly chain (Silent → Cue Plan → Final)** | A strict four-stage sequence with hard gates and expensive terminal steps. Mobile watches the result and flags scenes (M3.4); it does not drive the chain. |
| **An editable timeline / NLE** | Web R3 holds unchanged. Take-selection is the edit model, and take-selection is *better* on mobile, not worse. |
| **Prompt-to-video agent / chat front door** | Web R4, and §6.4. Rejected most firmly exactly where it is most tempting. |
| **A public generation feed or social discovery surface** | Narrata's unit of work is a story, not a clip (web R7's reasoning). A feed of other people's outputs is a different product and would reframe this one. |
| **Full offline production** | Only the review queue goes offline (§5.5). Generation needs a live estimate and a live provider. |
| **Tablet-optimised layouts** | Phone-first. The three-column web workspace (planned web 5.1) is the right tablet answer eventually, and it should be designed once that ships, not guessed at now. |
| **Admin, invites, people management** | Admin-only on web (`ADMIN_ONLY_PREFIXES` in `proxy.ts`). No mobile case. |
| **A second design system** | The oklch token set and the `.dark` palette are ported, not re-authored. Component *implementations* differ (native primitives, not shadcn); the *decisions* do not. |

---

## 10. Cross-agent asks

### Technical / platform flags — `technical-architect`

These are flagged, **not resolved**. Each one changes the plan materially.

| # | Question |
|---|---|
| 1 | **The read API is the blocking dependency.** 110 route files, only 22 `GET`s; 15 of 17 pages read Prisma directly in Server Components; zero client pages. Every mobile screen needs JSON that does not exist. Is the answer a mobile BFF (`/api/mobile/*`), extending the existing entity routes with `GET`s, or something else entirely? **M0.1 cannot start without this call.** |
| 2 | **Mobile session transport.** `narrata_session` is an httpOnly cookie, but the credential underneath is already bearer-shaped (opaque random token, sha256-hashed in the `Session` row). Does mobile get a bearer variant of the same row, or a native cookie jar? **Constraint from me, not a preference:** whatever is chosen must flow through `proxy.ts`, which is the entire authorization model (default-deny + trusted `x-user-id`/`x-user-role` injection). |
| 3 | **Media delivery.** Storage is local disk; `GET /api/storage/[...key]` is documented in `proxy.ts` as **login-gated only, not per-owner** — a flagged trade-off whose risk profile changes when there is a persistent app-side cache. Combined with no CDN and no signed URLs, this is the ceiling on M2 (full-bleed review) and M5.1 (prefetch/offline). Does this need to move before or after mobile? |
| 4 | **Two schema gaps mobile needs and web does not have.** (a) A **favourite/keep flag** on takes — competitor-study 6.2, still unbuilt; M2's `♡ Keep` depends on it. (b) A home for **captured-but-unfiled items** (M4.3/M4.4) — image, audio note, link, text, not yet attached to any parent. Neither should be invented by me in a UI plan. |
| 5 | **Push requires a server-side trigger, and generation runs inline in request handlers.** `workers/` is confirmed empty today and is not even in the workspace globs. Is completion-notify a small hook on the existing claim-release path, or does it wait on roadmap #10? **My read: it should not wait** — it is the same lightweight approach that made generation claims work without a queue. |
| 6 | **Assumed stack, for confirmation or rejection:** React Native via **Expo** (SDK 54-era), Expo Router, TypeScript, at `apps/mobile` (already matched by the `apps/*` workspace glob — zero config change), sharing types from `packages/db`. Push notifications **require a development build, not Expo Go** (`FACT`, Expo docs), so EAS Build or equivalent is a day-one dependency, not a later step. I am asserting none of this — it is the default I would design against unless told otherwise. |

### Product and strategy

| Agent | Question |
|---|---|
| `product-strategist` | Confirm the thesis: mobile = **judge, watch, ship, capture**; web keeps authoring. And confirm the ordering call in §8 — this should land *after* roadmap Sprint 1–4 closes the web loop, not instead of it. If mobile is meant to be a user-acquisition surface rather than a retention surface, the whole plan changes shape. |
| `product-strategist` | §6.4: Runway now ships an agent front door **on mobile** (`FACT`). I am holding R4. Confirm that rejection still stands as a product-identity decision, because the pressure to break it will arrive as a mobile feature request. |
| `growth-strategist` | M3.2 makes the OS share sheet Narrata's real distribution channel (roadmap #6 calls export "the cheapest distribution channel"). Does a shared video carry a watermark or attribution, and does that differ by tier? Affects M3 scope directly. |
| `monetization-strategist` | Two flags. (a) A retake tap on a phone is a much lower-friction spend than a click on web — does mobile need a tighter guard than web's confirm step, or a per-session ceiling? (b) If credits are ever sold in-app, **Apple/Google take a cut on IAP for digital goods**. That is a pricing-model constraint worth knowing *before* mobile ships, not after. |
| `video-architect` | M1.2 needs a **batch boundary** for completion notifications — given Apple's ≤2–3/hour guidance, what is the right unit? Per scene? Per generation batch? Per pipeline stage? Getting this wrong is how notification permission gets revoked. |
| `ai-architect` | M2.5 surfaces `Asset.validationNotes` to a user directly for the first time. Are those notes written to be **read by a human on a small screen** — short, specific, actionable — or are they currently model-facing prose? If the latter, the prompt needs a length and tone constraint. |
| `qa-engineer` | Three things that need deliberate, non-obvious testing: (a) **gesture regressions** — verify no gesture ever commits `isSelected`; (b) **offline conflict** — same slot decided on both surfaces, confirm the human is asked and nothing is silently overwritten; (c) **notification delivery is non-deterministic by design** (`FACT`, Expo docs) — Activity must be correct on open even when zero notifications arrived. |
| `product-manager` | §8's precondition is the real scheduling question: mobile competes for the same single engineer as web Phases 5–7. Sequence, don't parallelise. |

---

## 11a. Implementation checklist

Mirrors §8. Checked off as items ship. Added 2026-09-15 when implementation began.

### Phase M0 — Foundations and the two spikes (~8–10d) — shipped 2026-09-15

`technical-architect`'s answers landed at
[`./mobile-technical-plan-2026-09.md`](./mobile-technical-plan-2026-09.md) same day,
sequenced as B0–B9 there. B0–B4 (the ones blocking M0) are built, typechecked/linted
clean on both `apps/web` and `apps/mobile`, and live-verified against the real dev DB
(not mocked) — see that doc's §8 for exactly what each B-item did. Two real bugs were
found and fixed during verification, not just theoretical: an unsatisfiable byte-range
request 500'd instead of 416'ing (fixed), and the plan's own suggested
`disableHierarchicalLookup: true` in `metro.config.js` broke the web bundle outright
(pnpm resolves a package's transitive deps via hierarchical walk-up; removed, doc
corrected).

- [x] M0.1 Read-path spike — `lib/read/{media,project-summaries,project-detail}.ts` +
  `GET /api/mobile/v1/{me,projects,projects/:id}` (B3), plus the actual mobile-side
  spike: `apps/mobile`'s Projects screen fetches and renders this live via a typed
  `contract`-based client (`lib/api.ts`), not a placeholder. Verified via `curl` against
  real project data (correctly reproduces a genuine pre-existing data quirk in one
  project, confirming the numbers are real, not fabricated) and via `expo export -p web`
  bundling the client code that calls it. No physical device/simulator in this
  environment, so on-device behavior itself is unverified — bundle- and protocol-level
  only, same honesty-note convention as the rest of this plan.
- [x] M0.2 Auth spike — `POST /api/auth/token` + `/token/refresh` + `/token/revoke` (B1,
  bearer variant of the existing `Session` row, `proxy.ts`'s `extractToken()`), plus the
  mobile-side spike: a real login screen (`app/login.tsx`) storing the token via
  `expo-secure-store` (never `AsyncStorage`) and an Expo-Router auth-gate redirect.
  Verified live end-to-end via `curl`: issue → use on a protected route → refresh
  (rotates, old token dies) → revoke (also dies) → rate limit trips at the 6th rapid
  attempt (5/email/15min) → cookie-based web login still works unaffected. Sliding
  session renewal (B1 extra) also added, benefits web too.
- [x] M0.3 App skeleton: `apps/mobile` scaffolded (Expo + Expo Router + TypeScript),
  dark-first token port from `globals.css`'s oklch set, 3-tab shell
  (Review/Projects/Activity) — 2026-09-15
- [x] M0.4 Media spike — `GET /api/storage/[...key]` now streams with `Range`/`ETag`/304
  (B4), required before native video/audio players can scrub at all. Live-verified: full
  request, byte range, suffix range, open-ended range, 304 on matching ETag, 416 on an
  unsatisfiable range (initially 500'd — real bug, fixed and re-verified) — all against a
  real 52MB stored render, not a fixture. Load-speed/cacheability numbers themselves
  (the spike's original ask) still need a real device, per M0.1's note above.

### Phase M1 — Watch (~7–9d) — shipped 2026-09-15, one polish item open

Backend: B6 (`lib/read/activity.ts` — moved the web job tray's own query here so
it and mobile can't diverge; `lib/read/renders.ts`) and B7 (`lib/notify.ts`, hooked
into `recordGenerationEvent`) from
[`./mobile-technical-plan-2026-09.md`](./mobile-technical-plan-2026-09.md) §8.
**B7's full pipeline was live-verified end-to-end, not just typechecked**: triggered
real `recordGenerationEvent` calls against a muted and a non-muted test project,
waited out the real 90s coalescing window, and confirmed via direct DB inspection
that (a) the muted project correctly produced no send attempt and (b) the non-muted
one made a real HTTP call to Expo's push API, which correctly returned
`DeviceNotRegistered` for the fake test token — and the code's own cleanup logic
correctly deregistered the device row in response. That's about as close to
"proven correct" as this kind of async, timing-dependent logic gets without a real
phone.

- [x] M1.1 Push registration (`lib/push.ts`: `expo-notifications` + `expo-device`,
  installId persisted via `expo-secure-store`) and permission priming — but not
  from "after the first generation," since Retake (M3) doesn't exist yet on
  mobile; wired to an explicit "Enable notifications" banner on Activity instead,
  same "never on launch" rule via the nearest honest hook available. Quiet-hours
  and per-project-mute have real, tested server endpoints (`/push/prefs`) but
  **no client settings UI yet** — open polish item, not blocking.
- [x] M1.2 Server-side completion notify, batched at job level — `lib/notify.ts`
- [x] M1.3 Activity screen wired to the real `GET /api/mobile/v1/activity`
  (Running/Needs You/Done Today, matching §4.7's design) — not a placeholder
- [x] M1.4 Deep-link routing (`lib/deep-link.ts`) from notification taps, including
  cold-start (`getLastNotificationResponseAsync`) — verified via `tsc` +
  `expo export -p web`; falls back to Projects for the one deep-link target with no
  screen yet (`/renders`, M3.1)

### Phase M2 — Judge (~13–15d) — shipped 2026-09-15, one item partial

Backend: **B5**, `lib/read/review-queue.ts` + `lib/read/asset-ownership.ts` +
`GET /api/mobile/v1/review` + `POST`/`DELETE /api/mobile/v1/takes/:assetId/keep` —
the item the technical plan itself calls "the hard one." Live-verified far beyond
"doesn't 500 on empty data": real DB rows were temporarily marked unreviewed (then
restored) to prove, against actual project data, that (a) a shot-image slot
produces the exact right label/context and that `compare.previousShotUrl`
correctly resolves shot N−1's image, (b) a real 4-clip `videoBatchId` batch groups
into one take via `groupIntoTakes()` with all 4 clips' segment/pair order intact
alongside 4 other historical takes, and (c) a SERIES episode's final-render slot
resolves project/label correctly through the season→project chain. **Found and
fixed a real bug** in the keep endpoint: an admin caller bypassed ownership
checking before existence checking, so keeping a nonexistent asset 500'd instead
of 404'ing — fixed by resolving the asset's project (which requires it to exist)
*before* the admin short-circuit, not after.

- [x] M2.1 Verdict-queue construction + endpoint — see B5 above
- [x] M2.2 Take card (`app/(tabs)/index.tsx`, replacing the M0.3 placeholder):
  full-bleed media via `expo-image`/`expo-video`/`expo-audio`, swipe-to-browse take
  history (paging `FlatList`), `Use this take`, `Skip` (client-local, commits
  nothing, per §5.5), context bar
- [x] M2.3 Long-press compare — press-and-hold the media (or the equivalent
  `Compare` button, satisfying "every gesture has a visible control
  equivalent") overlays shot N−1's continuity reference, falling back to the
  selected take when no previous-shot reference exists
- [~] M2.4 Audio take review — **partial.** Play/pause and a progress bar exist
  (`components/review/TakeMedia.tsx`'s `AudioTake`) and were reused for every
  audio kind (narration/dialogue/music/sfx). **Not built:** an actual waveform
  visualization (currently a plain progress bar), tap/drag-to-scrub, background
  playback, and lock-screen transport controls — real gaps, not oversights,
  scoped out to keep this pass to a single session.
- [x] M2.5 Critic verdict surfacing — `validationPassed`/`validationNotes` (identity
  /continuity) and `qcPassed`/`qcNotes` (freeze detection) both surface as an inline
  Problem-styled row when a take fails either check; data already existed
  end-to-end, this was wiring, not new logic

### Phase M3 — Ship (~7–8d) — shipped 2026-09-15, one item deferred

Also required a Project Detail screen (`app/projects/[id]/index.tsx`) that hadn't
been built yet — a mobile restatement of the web status board (§4.5), reusing the
`GET /api/mobile/v1/projects/:id` endpoint B3 already shipped. Not its own M-item,
but necessary plumbing: Renders (§4.6) is reached from it, not from a tab.

**Found and fixed a real bug during this pass, unrelated to any web logic:**
`expo-media-library`'s own module (`class Asset extends
ExpoMediaLibraryNext.Asset`, unconditionally, at module top level) crashes
`expo export -p web` outright — that package has no web implementation at all,
unlike `expo-sharing` (fine) and the new `expo-file-system` class API (crashes the
same way, but has a working `expo-file-system/legacy` escape hatch). Fixed by
dynamically importing `expo-media-library` only inside `saveRenderToPhotos()`,
guarded by `Platform.OS === "web"`, so the module is never evaluated while
bundling for web — same pattern as `Device.isDevice`'s push-registration guard.
Found by the same `expo export -p web` check used all session, not by reading
either package's docs.

- [x] M3.1 Renders shelf (`app/projects/[id]/renders.tsx`) — every final/silent
  render take, backed by B6's already-shipped `/renders` endpoint
- [x] M3.2 Save to Photos (`expo-media-library`, native-only) + OS share sheet
  (`expo-sharing`) + copy link (`expo-clipboard`) — both Save and Share download
  the remote (auth-gated) file to cache first via `expo-file-system/legacy`, so
  the OS recognizes a real video file, not a bare URL
- [x] M3.3 Retake pre-flight sheet (`components/review/RetakeSheet.tsx`) — scope
  + observed-median cost/duration (reusing the existing, already-shipped
  `GET /api/projects/:id/estimates`, reachable over bearer auth with zero new
  backend work) + Start, dismissing immediately per §4.3. The free-text "change
  something?" field only appears for `shotImage` — verified live that the other
  7 generate routes accept only `modelId`, no amendment field exists for them yet;
  scoped honestly rather than faked
- [ ] M3.4 Watch-the-cut with tap-to-flag — **deferred, not attempted.** Filing a
  flagged scene back into the Review queue needs a real backend capability that
  doesn't exist: there is no way today to manually re-null a take's `reviewedAt`
  outside the generation/selection funnel. Building that is a legitimate small
  schema/endpoint addition, not a client-only gap — flagged for a future pass
  rather than half-built
- [x] M3.5 First-export completion moment — the Renders screen leads with a
  congratulatory header when exactly one final render exists for the project,
  instead of the plain list title

### Phase M4 — Capture (~9–10d) — mostly shipped 2026-09-15, M4.1 not attempted

Backend: **B8** — `lib/inbox.ts` + `GET/POST /api/mobile/v1/inbox` +
`POST /api/mobile/v1/inbox/:id/file` + `DELETE /api/mobile/v1/inbox/:id`. Schema
(`CaptureItem`, `Asset.captureItemId`, `AssetType.CAPTURE`) already existed from
B2 (Phase M0) — this was the API layer only. Live-verified beyond the empty-list
case: uploaded a real multipart image capture, filed it into a real character
(confirmed in the DB: `captureItemId` cleared, `characterId` set,
`type → REFERENCE_IMAGE`, `CaptureItem.filedAt/filedIntoType/filedIntoId`
stamped), confirmed filing an IMAGE into a "scene" target correctly 400s (no
generic scene-reference-image FK exists in the schema — a real, load-bearing
finding, not a bug: `fileCaptureItem` explicitly rejects that combination with
an explanatory message rather than silently doing nothing), and confirmed a
bogus target id 400s cleanly. Also reused the *existing* web
`GET /api/projects/:id/{characters,locations}` endpoints for the filing
picker's lists — zero new backend for that part, same "already flows through
proxy.ts's bearer support" pattern as the Retake sheet's `/estimates` reuse.

- [ ] M4.1 iOS Share Extension + Android share target — **not attempted.** The
  one item in the whole mobile plan that requires actual native project
  configuration (an Xcode share-extension target, Android intent filters) —
  fundamentally outside what `tsc`/`expo export -p web` can build or verify in
  this environment, unlike everything else built this session. Needs a real
  native/EAS build environment.
- [x] M4.2 Camera / camera roll → reference image (`lib/capture.ts`,
  `expo-image-picker`)
- [x] M4.3 Voice memo → note (`expo-audio`'s recorder API, reused for playback
  earlier in M2 too) — schema home was already built as part of B2/M0, ahead of
  needing it, per that item's original note
- [x] M4.4 Inbox: list (`app/inbox.tsx`), file-into-project
  (`components/inbox/FileSheet.tsx`, a real two-step project→target picker, not
  a stub). **"Quick-idea → project shell" not built** — a smaller, more optional
  sub-feature (create a new project from a capture) left out to keep this pass
  focused; the core capture→file loop is what's verified end-to-end.

### Phase M5 — Offline, accessibility and polish (~7–8d) — shipped 2026-09-15, with the honesty note this phase most needs

**This is the one phase in the whole plan where "shipped" means something narrower
than everywhere else.** Every prior phase's hard parts got live-verified against
a real dev server and a real database — this one is about behavior during an
actual network-loss transition on a real phone, and there is no phone or
simulator anywhere in this environment. What's below is real, typechecked,
bundle-verified code, reasoned through carefully — not a stub — but the
offline→online transition itself has only ever been exercised by code review,
never executed.

- [x] M5.1 Prefetch + local verdict queue — **local verdict queue built
  (`lib/offline-queue.ts`, `AsyncStorage`-backed), prefetch not built.** Judging
  offline queues a decision locally instead of calling the API immediately;
  flushing on reconnect re-checks the live queue first (§5.5's "do not
  last-write-wins" rule) before applying anything. Retake is disabled outright
  when offline, with a stated reason, per §5.5's explicit rule that retakes
  never queue. Media prefetch for the next N slots (the other half of M5.1) was
  not attempted — it's independently valuable but not required to make the
  queue itself correct, and this pass's time went to getting the conflict logic
  right instead.
- [x] M5.2 Conflict resolution UI (`app/conflicts.tsx`) — a real screen, not a
  placeholder: "Apply mine anyway" re-POSTs the offline choice, "Leave as-is"
  discards it, and neither happens automatically. Reachable from a banner on
  Review the moment a flush produces one.
- [x] M5.3 Accessibility pass — real, partial. **Fixed a promise the plan itself
  made and hadn't kept:** the take-history dots (§5.1's stated "visible
  equivalent" for the swipe gesture) were purely decorative until now — they're
  tappable and screen-reader-labeled. Added `accessibilityLabel`/`accessibilityRole`
  to every icon-only or ambiguous-text control found (audio play/pause, back
  buttons, the Inbox "+", login's text fields). Confirmed by direct calculation
  (not a device tool) that the dark-first palette's contrast is solid — foreground
  on background ≈19:1, mutedForeground on background ≈7.7:1, both well past WCAG
  AA. **Not done:** actual VoiceOver/TalkBack testing, Reduce Motion beyond
  relying on the platform's own native Modal transitions (no custom animation
  was added that could ignore it), and focus-order testing — all real gaps that
  need a device, named rather than silently skipped.

---

## 11. Open questions and UNKNOWNs

Recorded so a later reader knows what was *not* established, rather than inferring
confidence that was never there.

- `UNKNOWN` — whether Luma's app sends push notifications on completion, and whether it
  syncs with their web product. Neither source stated it. This is the closest analog and
  the answer would be informative.
- `UNKNOWN` — whether Descript currently ships a first-party iOS app. Sources directly
  contradict; Descript's own help index surfaced no mobile page. The *strategic* point
  (authoring stays on desktop) survives either way.
- `UNKNOWN` — real-world load time for full-bleed review media from a single VPS on
  mobile data. M0.4 exists specifically to answer this, and M5.1 is gated on it.
- `UNKNOWN` — whether headphone-tap A/B between audio takes is exposed by the platform in
  a way React Native can consume (§5.2). Needs a device check, not a search.
- `UNKNOWN` — the actual distribution of Narrata users across iOS and Android. If it is
  Android-heavy, §7's PWA rejection weakens noticeably (Chrome on Android supports both
  Share Target and push), and that should be re-tested before M0 rather than after.
- `ASSUMPTION` — that reviewing takes is a job users *want* to do away from the desk.
  This is the load-bearing behavioural assumption under the entire plan and there are
  currently **zero users** to check it against (roadmap §2). The cheapest possible test
  is the web app's own telemetry once deployed: if sessions are long and desk-bound with
  no gaps, the "between sessions" thesis is weaker than it looks here.
