# Long-Form Video Chaining — Future Improvements

Ideas to revisit when we want scene/episode generation to reliably support
10–60 minute continuous output, not just short clips. Not scheduled yet —
capturing the architecture discussion so it isn't lost.

## Current state (as of this doc)

- `generateSceneVideo` ([apps/web/src/lib/scene-video.ts](apps/web/src/lib/scene-video.ts))
  frame-chains segments sequentially: each segment after the first is seeded
  with the previous segment's last frame (via ffmpeg), so the clip continues
  visually instead of resetting.
- `planVideoSegments` ([apps/web/src/lib/video-segmentation.ts](apps/web/src/lib/video-segmentation.ts))
  caps a scene at `MAX_SEGMENTS = 6` — around 48–60s total at typical
  per-segment durations.
- All segments in a batch are generated inside one request's `for` loop, with
  no persisted per-segment progress. A mid-chain failure loses the whole
  batch; a long-enough chain would exceed request/serverless timeouts.

## What's needed for 10–20+ minute scenes

1. **Raise/remove `MAX_SEGMENTS`.**
   10 minutes at ~8–10s/segment is roughly 60–75 segments. The cap in
   `video-segmentation.ts` needs to grow well past 6 (or become
   config-driven) before longer targets are even reachable.

2. **Move generation to a resumable background job.**
   A chain of 60+ sequential external video-generation calls will not fit in
   one HTTP request/serverless invocation. Persist each completed segment's
   result to the DB as it finishes, so a crash or timeout resumes from the
   last successful segment instead of restarting the whole batch. This is
   the biggest piece of work — likely a job/queue table plus a worker
   process (see `workers/` at repo root) rather than an API route doing the
   loop inline.

3. **Periodic re-anchoring to fight drift.**
   Pure last-frame-to-first-frame chaining accumulates visual/character
   drift over many hops. Other long-form platforms re-anchor to a fixed
   reference image/style every N segments (e.g. every 4–6) instead of
   relying solely on the previous segment's last frame. Needs a design
   decision on what the reference is (first shot's image? a dedicated
   style/character ref?) and how often to re-inject it.

4. **Retry/error resilience per segment.**
   With hundreds of sequential calls, some will fail transiently. Each
   segment should retry independently rather than failing the entire batch.

## Suggested order

Start with (1) since it's a small, low-risk change, then (2) since nothing
above ~1 minute is reliable without it. (3) and (4) matter more as chain
length grows, but should ideally land before shipping 10+ minute output to
users, since drift and flaky failures are the visible symptoms of skipping
them.

---

## ଓଡ଼ିଆ ରେ (Odia)

10–60 ମିନିଟ୍ ର continuous video ତିଆରି କରିବା ପାଇଁ ଭବିଷ୍ୟତରେ କରିବାକୁ ଥିବା
ଉନ୍ନତିଗୁଡ଼ିକର ତାଲିକା। ଏବେ କାମ ଆରମ୍ଭ ହୋଇନାହିଁ — କେବଳ ଆଲୋଚନାକୁ ଲେଖି ରଖାଯାଇଛି,
ଯାହା ଭୁଲିଯିବ ନାହିଁ।

### ବର୍ତ୍ତମାନ ସ୍ଥିତି

- `generateSceneVideo` ([apps/web/src/lib/scene-video.ts](apps/web/src/lib/scene-video.ts))
  ପ୍ରତ୍ୟେକ segment କୁ ପୂର୍ବ segment ର ଶେଷ frame ନେଇ ଆରମ୍ଭ କରେ (frame-chaining),
  ଯାହା ଦ୍ୱାରା video ଟି continuous ଦେଖାଯାଏ।
- `planVideoSegments` ([apps/web/src/lib/video-segmentation.ts](apps/web/src/lib/video-segmentation.ts))
  ଏକ scene ପାଇଁ `MAX_SEGMENTS = 6` ପର୍ଯ୍ୟନ୍ତ ହିଁ ସୀମିତ — ପ୍ରାୟ 48–60 ସେକେଣ୍ଡ।
- ସବୁ segment ଏକ request ଭିତରେ loop ଚାଲି ତିଆରି ହୁଏ, ମଝିରେ progress save ହୁଏ
  ନାହିଁ। ମଝିରେ fail ହେଲେ ପୁରା batch ହଜିଯାଏ; ବହୁତ ଲମ୍ବା chain ହେଲେ request
  timeout ହୋଇଯିବ।

### 10–20+ ମିନିଟ୍ ପାଇଁ କଣ ଦରକାର

1. **`MAX_SEGMENTS` ବଢ଼ାଇବା।**
   10 ମିନିଟ୍ ପାଇଁ ପ୍ରାୟ 60-75 ଟି segment ଦରକାର (8-10 ସେକେଣ୍ଡ/segment ହିସାବରେ)।
   `video-segmentation.ts` ର cap ବଢ଼ାଇବାକୁ ପଡ଼ିବ, କିମ୍ବା config-driven କରିବାକୁ
   ପଡ଼ିବ।

2. **Generation କୁ resumable background job ରେ ନେବା।**
   60+ ଟି sequential external call ଏକ HTTP request ଭିତରେ ଚାଲିପାରିବ ନାହିଁ।
   ପ୍ରତ୍ୟେକ segment ସମାପ୍ତ ହେବା ପରେ DB ରେ save କରିବାକୁ ପଡ଼ିବ, ଯାହା ଦ୍ୱାରା
   crash/timeout ହେଲେ ଶେଷ successful segment ଠାରୁ ପୁଣି ଆରମ୍ଭ ହୋଇପାରିବ। ଏହା
   ସବୁଠାରୁ ବଡ଼ କାମ — ଏକ job/queue table ଏବଂ worker process (repo root ର
   `workers/` ଦେଖନ୍ତୁ) ଦରକାର ହେବ।

3. **Drift ରୋକିବାକୁ periodic re-anchoring।**
   କେବଳ last-frame chaining ଉପରେ ନିର୍ଭର କଲେ ବହୁତ segment ପରେ character/style
   ଧୀରେ ଧୀରେ ବଦଳିଯାଏ (drift)। ଅନ୍ୟ platform ମାନେ ପ୍ରତି 4-6 segment ପରେ ଏକ
   ସ୍ଥିର reference image କୁ ପୁଣି ବ୍ୟବହାର କରନ୍ତି। ଏହି reference କଣ ହେବ (ପ୍ରଥମ
   shot ର image? ଏକ dedicated style/character ref?) ଏବଂ କେତେ ଥର re-inject
   କରାଯିବ, ତାହା ଠିକ୍ କରିବାକୁ ପଡ଼ିବ।

4. **ପ୍ରତ୍ୟେକ segment ପାଇଁ retry/error handling।**
   ଏତେ ସଂଖ୍ୟକ sequential call ମଧ୍ୟରୁ କିଛି ମାଝେମାଝେ fail ହେବ। ପ୍ରତ୍ୟେକ segment
   ନିଜେ retry କରିବା ଉଚିତ, ପୁରା batch fail ନହୋଇ।

### କାମ କରିବାର କ୍ରମ

ପ୍ରଥମେ (1) — ଛୋଟ, କମ୍ risk ଥିବା change। ତାପରେ (2) — ଏହା ବିନା 1 ମିନିଟ୍ ରୁ ଅଧିକ
କିଛି ବି ଭରସାଯୋଗ୍ୟ ହେବ ନାହିଁ। (3) ଏବଂ (4) chain ଲମ୍ବା ହେବା ସହିତ ଅଧିକ ଗୁରୁତ୍ୱପୂର୍ଣ୍ଣ
ହୁଅନ୍ତି, ମାତ୍ର users ଙ୍କୁ 10+ ମିନିଟ୍ output ଦେବା ପୂର୍ବରୁ ଏଗୁଡ଼ିକ ମଧ୍ୟ ସାରିବା
ଉଚିତ, କାରଣ drift ଏବଂ flaky failure ହିଁ ଏହାକୁ skip କଲେ ଦେଖାଯିବ।
