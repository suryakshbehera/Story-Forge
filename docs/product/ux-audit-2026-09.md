# Narrata — UI/UX Audit & Improvement Plan

**Owner:** `ui-ux-engineer`
**Created:** 2026-09-10
**Status:** v1. First dedicated UX review of the app.
**Companion:** [`./roadmap.md`](./roadmap.md) (sequencing),
[`./feature-priorities.md`](./feature-priorities.md).

Evidence labels: `FACT` (read in the source today) / `ASSUMPTION` / `UNKNOWN`.

**Method & honesty note.** Every finding below comes from reading
`apps/web/src` (all page files, all 40 non-`ui/` components, `globals.css`,
`proxy.ts`), including the uncommitted local state of `scene-manager.tsx`,
`scene-voice-panel.tsx`, `shot-manager.tsx`, `shots.ts`, `video-assembly.ts`.
The dev server was confirmed running and serving (`GET /` → `307 /login?next=/`
on `:3002`). **No visual/browser verification was possible** — this environment
has no browser or screenshot capability, so nothing here is a claim about
rendered pixels, only about structure, states, and behaviour in code.

---

## 1. What is already working well

Not filler — these are the things a redesign must not break.

- **One coherent asset model, everywhere** (`FACT`). Story versions, shot
  images, video takes, audio takes, silent renders and final renders all use
  the same `isSelected` + take-history idiom with the same "Use this take"
  affordance. That conceptual consistency is rare in AI tools and is Narrata's
  strongest UX asset.
- **Manual-first is honoured in the interface, not just the docs** (`FACT`).
  AI drafts *into* editable fields and never auto-applies: motion prompt
  "draft and review", duration "suggest and review", Audio Cue Plan
  review-then-Apply-All, document ingest's explicit "Preview — nothing is
  saved yet".
- **Model registry with no hardcoding** (`FACT`). Every `ModelSelect` reads
  `/api/ai-models`, auto-selects the registry default, and degrades to a
  readable "No models configured" instead of hanging on "Loading models…".
- **Cross-reload generation recovery exists — once** (`FACT`).
  `shot-manager.tsx` + `lib/shot-image-generation.ts` do this properly:
  server-side claim, `409` on double-fire, poll until idle, stale-claim rule.
  This is the right pattern and it is already in the codebase.
- **Copy teaches the domain instead of labelling it** (`FACT`). "each is its
  own continuity frame, not an alternate of the others"; "Locked characters
  are always included in the Context Engine". This is good writing.
- **Failure and precondition surfacing is above average** (`FACT`). Unmatched
  character names after scene generation, illustration timing mismatch
  warnings, missing-reference-image warnings, and explicit *reasons* on
  disabled generate buttons ("Generate and select an image for every shot
  above first").
- **The Seedance Studio is the best generation UI in the product** (`FACT`).
  Structured prompt builder (subject/action/camera/style/beats/ending),
  visible cast references, and a symptom→fix failure table. The route name is
  drift (roadmap #8), but the *interface* should be generalised, not deleted.
- **Solid primitive layer** (`FACT`). Base UI + shadcn with real
  `focus-visible` rings, a complete oklch token set, and a `dark` palette
  already authored.

---

## 2. Findings, ranked

### P0 — Critical (blocks activation)

**F1. There is no first run.**
Signup → `/` → an empty card reading "No projects yet." → New Project (name +
type) → dropped directly into Story Setup: nine free-text fields, two Generate
cards, and no statement of what Narrata does or what happens next (`FACT`).
Nothing communicates the pipeline. The first moving picture is ~10 surfaces
away. Ties directly to roadmap #7.

**F2. The journey has no ending.**
Final Assembly renders a `<video>` tag, a "Use this render" button and a
delete button (`FACT`, `video-assembly-panel.tsx`). No Download, no share
link, no filename, no duration/size/resolution readout, no "you made this"
moment. The one outcome the user came for is not represented as an object.
Confirms roadmap #6.

**F3. No "where am I / what's next" anywhere in the product.**
`ProjectNav` is five flat, unordered tabs (Story, Scenes, Characters,
Locations, Seedance 2.5) with no sequence, no completion state, no gating hints
(`FACT`). `/projects/[id]` is a bare redirect with no overview page (`FACT`).
The real pipeline — Story → Characters/Locations → Scenes → Shots → Images →
Voice → Music/SFX → Silent → Cue Plan → Final — is invisible, and six of those
steps are nested inside a single scrolling page.

**F4. The Scenes page is one unbounded scroll of always-open forms.**
Every `SceneRow` renders `ShotManager` + `SceneVideoPanel` + `SceneVoicePanel`
+ `SceneAudioPanel` fully expanded, unconditionally — no collapse, no focus
view, no scene rail (`FACT`, `scene-manager.tsx` L684–735). A 20-scene episode
is tens of thousands of pixels of open textareas. Made worse by three
`window.location.reload()` calls used as a state-sync mechanism (cue plan
apply, story chat apply, document ingest apply — `FACT`), each of which throws
away the user's scroll position on exactly that page.

### P1 — Important

**F5. Long-running AI jobs have durable state in exactly one place.**
Video generation, voice, music/SFX, silent assembly and the final ffmpeg render
are all inline `fetch` calls whose entire feedback is a button label
("Generating…", "Assembling…") (`FACT`). Reload or navigate away and the UI
forgets; the job continues server-side; a finished render only reappears on a
later full page load. No progress, no stage, no elapsed time, no cancel. The
*longest and most expensive* jobs have the *weakest* feedback, while the
correct pattern already exists for shot images.

**F6. Zero loading, error or not-found boundaries.**
No `loading.tsx`, `error.tsx`, `not-found.tsx` or `global-error.tsx` anywhere
under `app/` (`FACT`). Every page is `force-dynamic` with heavy Prisma includes
(scenes + shots + images + every audio and video take), so navigating to Scenes
leaves the previous page frozen with no feedback, and any server throw drops
the user on Next's default error screen.

**F7. `ModelSelect` fan-out — ~150+ duplicate requests per page.**
23 static call sites (`FACT`), but instances are per-scene *and per dialogue
line*: an ILLUSTRATION scene with 4 dialogue lines mounts ~10 `ModelSelect`s,
each independently fetching `/api/ai-models`. A 20-scene episode fires roughly
150–200 identical requests on load, plus one `/voice-duration` fetch per scene.
There is no shared cache or provider.

**F8. AI architecture leaks into the interface.**
The user is asked to choose a model for story, scene planning, shot planning,
image prompts, image generation, image validation, script drafting, narration
direction, dialogue direction, voice (*per line*), motion prompt, duration
recommendation, video generation, music, SFX, cue planning, chat and assembly
(`FACT`). Defaults auto-fill, which rescues it functionally — but the surface
reads as a model control panel, not a studio. Complexity belongs inside the
system.

**F9. Accessibility gaps.**
Six `aria-label`s exist in the entire app outside `ui/` (`FACT`). Icon-only
reorder and delete buttons across `scene-manager`, `shot-manager` and
`scene-voice-panel` have no accessible name. Shot images are
`<img alt="">` inside `role="button"` divs rather than real buttons, and their
delete affordance is `hidden group-hover:block` — unreachable by keyboard and
by touch (`FACT`, `shot-manager.tsx` L519–552). Image validation state is an
icon whose meaning lives only in a `title` tooltip. No skip link, no landmarks
beyond `<main>`.

**F10. Dark mode is dead code.**
A complete `.dark` token block exists in `globals.css`; no `ThemeProvider`, no
toggle, and `.dark` is never applied (`FACT`). `ui/sonner.tsx` calls
`useTheme()` with no provider mounted, so toasts can render dark against a
permanently light app.

**F11. Design-system drift.**
15 native `confirm()` dialogs (unstyled, blocking, unbrandable) against an
existing `Dialog` component; `variant="destructive"` used once while
`variant="ghost" className="text-destructive"` is used 14 times; raw
`<input type="number">` / `<input type="range">` instead of the `Input`
primitive in `scene-voice-panel` (×2) and `scene-audio-panel`;
`groupIntoTakes`/`clipLabel` duplicated between `scene-video-panel` and
`seedance-studio`; a private `Field` helper redefined in six files (`FACT`).

**F12. Mobile is unhandled.**
`SiteHeader` (brand + two settings links + full email + logout) and
`ProjectNav` (five tabs, `flex gap-1`, no overflow scroll) both overflow at
phone widths. Scene cards nest three levels of `Card` with fixed `w-40 h-24`
media and `w-36` selects. Nothing is restructured or hidden for small screens
(`FACT`).

### P2 — Improvement

**F13. SINGLE and SERIES have different information architectures for the same
job.** Single Video splits Story and Scenes across two pages; a Series episode
page stacks Episode editor + Context Engine Preview + Story Chat + Scenes +
three assembly panels into one route (`FACT`).

**F14. Developer surfaces sit in the product.** "Context Engine Preview" dumps
the raw assembled context into a `<pre>` on the episode page; the Seedance page
instructs the user to paste a raw JSON model config into Settings (`FACT`).

**F15. A model name is in the primary navigation.** `Seedance 2.5` appears in
`ProjectNav` for *every* project, including illustration-only ones (`FACT`).
Roadmap #8 already calls this drift — the fix should preserve the studio's
interface pattern.

**F16. Voice identity is an opaque free-text field.** Character voice and
narrator voice are hand-typed provider IDs ("ElevenLabs voice ID or Sarvam
speaker name") with no picker, no audition/preview, and no validation that the
ID matches the provider chosen at generation time (`FACT`). Story-wide voice
consistency is a stated differentiator gated behind pasting a GUID correctly.

**F17. Terminology load is front-loaded.** Visual Mode, take, shot-vs-alternate,
Silent Picture, Audio Cue Plan, Blueprint, Story Bible, Context Engine, Lock —
all explained in inline microcopy, none introduced before first contact.

**F18. Save/dirty behaviour is inconsistent and forces sequencing.** Most
panels use dirty-gated Save buttons (good), but generation is *hard-blocked* on
unsaved state with an error toast ("Save the narration script before generating
audio") instead of offering save-and-generate. `StoryEditor`'s "Save Setup" has
no dirty check at all. "Save Scene" sits visually above the shot/voice/audio
panels, implying it saves them too (`FACT`).

**F19. Empty states describe absence instead of offering the action.** "No
shots yet — generate with AI or add one manually" (the buttons are in a
separate header row); "No characters yet."; "No versions yet." None contain the
action they describe (`FACT`).

**F20. Errors are transient and shapeless.** Everything funnels through
`toast.error(...)` (30 calls in `scene-voice-panel` alone). A failed generation
leaves no persistent record to retry from, messages are mostly generic
("Generation failed.", "Couldn't save scene."), and there is no inline retry
anywhere. Nothing follows Problem → Explanation → Recommended action.

### P3 — Polish

- Six cycling scene tint colours carry no meaning and compete with the
  amber/green/red used for validation and timing state.
- Story content is edited in a `rows={20}` monospace `<textarea>` — the primary
  writing surface of a storytelling product.
- `toLocaleDateString("en-US")` hardcoded in three places.
- Assemble without Audio / Audio Cue Plan / Final Assembly are three sibling
  cards of equal visual weight; their strict sequential dependency exists only
  in prose.
- No autosave, no keyboard shortcuts, no command palette.

---

## 3. Phased plan

Effort is rough dev-days for one engineer. Priorities are ordered against the
known weak point: **onboarding/activation**, not pipeline capability.

### Phase 0 — Quick wins (~5–6 days, no architectural change)

| # | Item | Touches | Est. | Fixes |
|---|---|---|---|---|
| 0.1 | **Download + copyable share link + file metadata on the final render card** | `video-assembly-panel` | 0.5d | F2, roadmap #6 |
| 0.2 | Add `loading.tsx` / `error.tsx` / `not-found.tsx` (route-group level) | `app/` | 0.5d | F6 |
| 0.3 | `aria-label` every icon-only button; make image tiles real `<button>`s; delete affordance visible on focus; alt text on assets | scene/shot/voice panels | 0.5d | F9 |
| 0.4 | Replace 15 `confirm()` with one `ConfirmDialog` wrapper; adopt `variant="destructive"` | app-wide | 0.5d | F11 |
| 0.5 | Shared model-registry cache (one fetch per `jobType`, module-level or context) | `model-select` | 0.5d | F7 |
| 0.6 | **Collapse scene sub-panels by default** (Shots / Video / Voice / Audio as collapsible sections with a filled/empty status dot each) | `scene-manager` | 1d | F4 |
| 0.7 | Actionable empty states; replace "save first" blocking toasts with save-and-generate | scene/shot/voice/audio panels | 1d | F18, F19 |
| 0.8 | Extract shared `Field`, `TakeRow`, `TakeGallery`; delete duplicated `groupIntoTakes` | components | 0.5d | F11 |

0.1 and 0.6 are the two highest-value items in the whole document per day
spent. 0.1 gives the pipeline an ending; 0.6 makes the main workspace usable at
realistic scene counts.

### Phase 1 — Activation (2–3 weeks) — the current weak point

| # | Item | Touches | Est. |
|---|---|---|---|
| 1.1 | **Project workspace overview** at `/projects/[id]` (today a bare redirect): pipeline status board — Story ✓, Characters 3 (1 locked), Scenes 8, Shots with images 12/20, Voice 4/8, Final render — each row linking to its step, with one primary "Continue" action | new page, `project-nav` | 3d |
| 1.2 | Ordered, stateful `ProjectNav`: pipeline order + completion state; remove `Seedance 2.5` from nav | `project-nav` | 1d |
| 1.3 | **First-run path**: seeded 3-scene `ILLUSTRATION` demo project + a "shortest complete loop" checklist to one exported video in a sitting. No auto-running generation | new, home page | 4d |
| 1.4 | New Project → short intent step (what are you making / illustration vs video / rough length) that pre-fills Story Setup instead of nine empty fields | `new-project-dialog`, `story-editor` | 2d |
| 1.5 | First-use explanation pass on Visual Mode, take, shot, Silent Picture, Cue Plan, Lock (progressive disclosure, not a tour) | app-wide microcopy | 2d |

Sequencing note: 1.1 before 1.3. A guided path is much cheaper to build once
there is a surface that can express "step 4 of 9, here's what's next".

### Phase 2 — Generation feedback & trust (2–3 weeks; partly backend-blocked)

| # | Item | Touches | Est. |
|---|---|---|---|
| 2.1 | Generalise the shot-image job-claim pattern (persisted claim + `409` + poll + stale rule) to voice, music/SFX, video, silent and final assembly | all generation panels + API | 5d |
| 2.2 | **Persistent job tray** in the header: every in-flight generation in the project, with stage, elapsed time, failure and retry | new, `site-header` | 4d |
| 2.3 | Failure states as Problem → Explanation → Action, inline on the failed object, naming the provider/model that actually ran | all generation panels | 3d |
| 2.4 | Pre-generation cost/scope estimate on the expensive actions (video, final render) | video/assembly panels | 2d |

2.1 is the front half of roadmap #10 (`workers/`) and needs
`technical-architect`. 2.3 and 2.4 depend on roadmap #4 (`GenerationEvent` +
`usage.cost`) — **coordinate, don't duplicate**.

### Phase 3 — Structural (4–6 weeks)

| # | Item | Touches | Est. |
|---|---|---|---|
| 3.1 | **Scene workspace**: scene rail + one focused scene (list-detail), replacing the infinite stack; unifies SINGLE and SERIES onto one shape | `scene-manager`, both scene routes | 8d |
| 3.2 | Promote assembly to an explicit Export step: Silent Picture → Cue Plan → Final → Download/Share as a 4-stage sequence, not three equal cards | scenes/episode pages | 3d |
| 3.3 | Move model choice into per-project generation settings + a per-action "Advanced" override; generalise the Seedance prompt builder into the generic video panel and retire the model-named route | app-wide, `seedance-*` | 5d |
| 3.4 | Responsive pass — mobile = review, approve takes, monitor jobs; not full production | header, nav, media grids | 4d |
| 3.5 | Voice picker: audition + provider-matched selection instead of free-text IDs | `character-detail-form`, `scene-manager` | 3d |
| 3.6 | `ThemeProvider` + toggle (tokens already exist) | `layout`, `site-header` | 1d |

3.5 pairs with roadmap #3 — if `ai-architect` turns voice IDs into an
`AiModelOption`-style registry, this becomes a one-day picker instead of three.

---

## 4. Explicitly not recommended now

| Item | Why not |
|---|---|
| Visual redesign / restyling pass | The tokens and primitives are fine. Every P0 here is structural. Restyling now buys nothing and re-costs later. |
| Timeline / NLE-style editor | Narrata's edit model is take-selection, which works. A timeline is a different product. |
| Onboarding tour / coach marks | Cheap-looking substitute for F3. Build the status board first; if the product still needs narrating after that, the IA is wrong. |
| Full accessibility certification effort | Do the P1 fixes (0.3) now; formal audit belongs after Phase 3 changes the DOM anyway. |
| New component library | Base UI + shadcn is adequate and consistent. The problem is drift from it, not the choice of it. |

---

## 5. Implementation checklist

Mirrors the phased plan in §3. Check off items as they ship.

### Phase 0 — Quick wins (~5–6 days) — shipped 2026-09-11

- [x] 0.1 Download + copyable share link + file metadata on the final render card (`video-assembly-panel`) — F2
- [x] 0.2 Add `loading.tsx` / `error.tsx` / `not-found.tsx` at route-group level (`app/`) — F6
- [x] 0.3 `aria-label` on icon-only buttons; real `<button>` image tiles; focus-visible delete affordance; alt text — F9
- [x] 0.4 Replace 15 `confirm()` calls with one `ConfirmDialog`; adopt `variant="destructive"` consistently — F11
- [x] 0.5 Shared model-registry cache — one fetch per `jobType` (module-level or context) — F7
- [x] 0.6 Collapse scene sub-panels by default (Shots/Video/Voice/Audio as collapsible sections with status dots) — F4
- [x] 0.7 Actionable empty states; replace save-blocking toasts with save-and-generate — F18, F19
- [x] 0.8 Extract shared `Field` and `groupIntoTakes`/`clipLabel`; delete duplication — F11 (`TakeRow`/`TakeGallery` extraction deferred — optional/stretch per plan, not blocking)

### Phase 1 — Activation (2–3 weeks) — shipped 2026-09-11

- [x] 1.1 Project workspace overview at `/projects/[id]` — pipeline status board with per-step links + one primary "Continue" action
- [x] 1.2 Ordered, stateful `ProjectNav` reflecting pipeline order + completion state; remove `Seedance 2.5` from nav
- [x] 1.3 First-run path: seeded 3-scene ILLUSTRATION demo project ("Try a demo project" on the empty project list); placeholder image/audio generated programmatically, no bundled media files
- [x] 1.4 New Project → short intent step (premise/genre/length) pre-filling Story Setup — "illustration vs video" kept as guidance copy only, not a persisted field (nothing downstream reads a project-level default today)
- [x] 1.5 First-use explanation pass on Visual Mode, take, shot, Silent Picture, Cue Plan, Lock — new `Tooltip`/`TermHint` primitive (none existed), reusing existing copy where it already existed

### Phase 2 — Generation feedback & trust (2–3 weeks; partly backend-blocked)

- [ ] 2.1 Generalise shot-image job-claim pattern (claim + 409 + poll + stale rule) to voice/music/video/silent/final — coordinate with `technical-architect` on roadmap #10
- [ ] 2.2 Persistent job tray in header — stage, elapsed time, failure, retry
- [ ] 2.3 Failure states as Problem → Explanation → Action, inline, naming provider/model — depends on roadmap #4
- [ ] 2.4 Pre-generation cost/scope estimate on expensive actions (video, final render) — depends on roadmap #4

### Phase 3 — Structural (4–6 weeks)

- [ ] 3.1 Scene workspace: scene rail + focused scene (list-detail), unifying SINGLE and SERIES
- [ ] 3.2 Promote assembly to explicit 4-stage Export step (Silent → Cue Plan → Final → Download/Share)
- [ ] 3.3 Move model choice into per-project settings + per-action Advanced override; generalise Seedance builder, retire model-named route
- [ ] 3.4 Responsive pass — mobile = review/approve/monitor, not full production
- [ ] 3.5 Voice picker: audition + provider-matched selection — pairs with roadmap #3
- [ ] 3.6 `ThemeProvider` + toggle (tokens already exist)

---

## 6. Cross-agent asks

| Agent | Question |
|---|---|
| `product-strategist` | Phase 1 is my read of roadmap #7. Confirm activation is defined as *first exported video*, so 0.1 and 1.1 can be measured. |
| `technical-architect` | 2.1 needs a persisted per-job claim/status. Is that a small schema addition now, or should it wait for `workers/` (roadmap #10)? It should not wait. |
| `ai-architect` | Does the voice-ID registry (roadmap #3) land in time for 3.5? |
| `growth-strategist` | Share-link shape for 0.1 — public unlisted URL, or account-gated? Affects whether it ships in Phase 0. |
| `qa-engineer` | Phase 0 items 0.3/0.4 touch ~20 files mechanically; worth a focused regression pass on destructive actions. |
| `product-manager` | Phase 0 is one sprint and unblocks measurement. Recommend scheduling it alongside roadmap Sprint 1, not after it. |
