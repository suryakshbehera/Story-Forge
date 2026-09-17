/**
 * Shared types for the mobile BFF (`apps/web/src/app/api/mobile/v1/*`) and the
 * mobile client (`apps/mobile`). Pure types and string-literal unions only —
 * zero runtime dependencies, zero build step, same convention as `packages/db`.
 *
 * Why this exists instead of importing `db`'s generated Prisma types: a Prisma
 * row is the wrong contract over JSON (DateTime becomes a string, storageKey
 * becomes a URL, most FKs are irrelevant to a client), and `db`'s entry point
 * instantiates a database client at module load — importing it from React
 * Native would pull a native query engine into the bundle. See
 * docs/product/mobile-technical-plan-2026-09.md §7.3.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ISO-8601, UTC, always a string over JSON — never a Date. */
export type Iso = string;

export interface MediaRef {
  /** App-relative, e.g. "/api/storage/<key>" (or signed, once §3.2/B9 lands). */
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** From Asset.metadata when the generator/assembly step recorded it. */
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------------------
// Slot identity — mobile-technical-plan §1.5. Maps 1:1 onto
// lib/generation-claims.ts's claim kinds; add new kinds there first.
// ---------------------------------------------------------------------------

export type SlotKind =
  | "shotImage"
  | "video"
  | "narration"
  | "dialogueAudio"
  | "music"
  | "sfx"
  | "silentAssembly"
  | "finalAssembly";

/** `${SlotKind}:${entityId}` */
export type SlotId = `${SlotKind}:${string}`;

export type SceneVisualMode = "ILLUSTRATION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";

export type EstimateJobType =
  | "IMAGE_GENERATION"
  | "VIDEO_GENERATION"
  | "VOICE"
  | "MUSIC_GENERATION"
  | "SFX_GENERATION"
  | "VIDEO";

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/me
// ---------------------------------------------------------------------------

export interface MeResponse {
  user: { id: string; email: string; role: "ADMIN" | "USER" };
  queue: { waiting: number };
  serverTime: Iso;
  /** Cheap kill-switch: client should force an update prompt below this. */
  minClientVersion: string;
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/projects
// ---------------------------------------------------------------------------

export interface ProjectProgress {
  storyDone: boolean;
  characters: { total: number; locked: number };
  locations: { total: number };
  scenes: { total: number };
  shots: { total: number; withImage: number };
  voice: {
    narratedScenes: number;
    dialogueLinesVoiced: number;
    dialogueLinesTotal: number;
  };
  finalRenderCount: number;
  /** Pre-rendered summary line, e.g. "Scenes · 8 of 12 done". */
  headline: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  type: "SINGLE" | "SERIES";
  cover: MediaRef | null;
  updatedAt: Iso;
  progress: ProjectProgress;
  waitingCount: number;
  runningCount: number;
  /** Deep link into the web app for anything mobile doesn't do. */
  webHref: string;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/projects/:id
// ---------------------------------------------------------------------------

export interface ProjectDetail {
  id: string;
  name: string;
  type: "SINGLE" | "SERIES";
  progress: ProjectProgress;
  hero: {
    assetId: string;
    kind: "finalAssembly" | "silentAssembly";
    media: MediaRef;
    renderedAt: Iso;
  } | null;
  waitingCount: number;
  runningCount: number;
  rendersCount: number;
  nextStep: { label: string; kind: "review" | "web" };
  webHref: string;
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/review — the core screen
// ---------------------------------------------------------------------------

export interface ReviewContext {
  sceneId: string | null;
  sceneOrder: number | null;
  sceneTitle: string | null;
  shotOrder: number | null;
  shotCount: number | null;
  visualMode: SceneVisualMode | null;
  /** Pre-rendered, e.g. "Shot 2 of 6 · Image-to-Video". */
  label: string;
}

export interface ReviewTake {
  /** Asset.id */
  id: string;
  media: MediaRef;
  isSelected: boolean;
  keptAt: Iso | null;
  createdAt: Iso;
  createdBy: "USER" | "AI";
  modelId: string | null;
  validationPassed: boolean | null;
  validationNotes: string | null;
  /** ffmpeg freeze check, video only. */
  qcPassed: boolean | null;
  qcNotes: string | null;
  clips: { url: string; segmentOrder: number | null; pairIndex: number | null }[] | null;
}

export interface ReviewActions {
  /** "{assetId}" is a literal placeholder the client substitutes. */
  selectPath: string;
  /** null ⇒ not retakeable from mobile. */
  retakePath: string | null;
  keepPath: string;
  estimateJobType: EstimateJobType | null;
}

export interface ReviewSlot {
  slotId: SlotId;
  kind: SlotKind;
  entityId: string;
  media: "image" | "video" | "audio";
  project: { id: string; name: string };
  context: ReviewContext;
  /** Newest-first, capped at 8. */
  takes: ReviewTake[];
  selectedTakeId: string | null;
  /** null ⇒ this slot is why the item is in the queue. */
  reviewedAt: Iso | null;
  compare: {
    selectedUrl: string | null;
    /** Shot N-1's selected image, same scene. */
    previousShotUrl: string | null;
  };
  actions: ReviewActions;
}

export interface ReviewResponse {
  items: ReviewSlot[];
  total: number;
  nextOffset: number | null;
  counts: {
    waiting: number;
    byProject: { projectId: string; waiting: number }[];
  };
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/activity
// ---------------------------------------------------------------------------

export interface ActivityRunningItem {
  jobType: string;
  stage: string;
  label: string;
  startedAt: Iso;
  etaSeconds: number | null;
  projectId: string;
  slotId: SlotId | null;
}

export interface ActivityFailureItem {
  jobType: string;
  entityType: string;
  entityId: string;
  provider: string | null;
  modelId: string | null;
  errorMessage: string | null;
  occurredAt: Iso;
  projectId: string;
  label: string;
  retryPath: string | null;
  slotId: SlotId | null;
}

export interface ActivityDoneItem {
  jobType: string;
  label: string;
  count: number;
  at: Iso;
  projectId: string;
  deepLink: string;
}

export interface ActivityResponse {
  running: ActivityRunningItem[];
  needsYou: ActivityFailureItem[];
  doneToday: ActivityDoneItem[];
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/projects/:id/renders
// ---------------------------------------------------------------------------

export interface RenderItem {
  assetId: string;
  kind: "finalAssembly" | "silentAssembly";
  isSelected: boolean;
  media: MediaRef;
  language: string | null;
  createdAt: Iso;
  downloadUrl: string;
}

export interface RendersResponse {
  renders: RenderItem[];
}

// ---------------------------------------------------------------------------
// Auth — POST /api/auth/token, /token/refresh, /token/revoke
// ---------------------------------------------------------------------------

export interface TokenRequestDevice {
  platform: "ios" | "android";
  installId: string;
  name?: string;
}

export interface TokenRequest {
  email: string;
  password: string;
  device?: TokenRequestDevice;
}

export interface TokenResponse {
  token: string;
  expiresAt: Iso;
  user: { id: string; email: string; role: "ADMIN" | "USER" };
}

export interface TokenRefreshResponse {
  token: string;
  expiresAt: Iso;
}

// ---------------------------------------------------------------------------
// Capture / Inbox — GET|POST /api/mobile/v1/inbox, POST .../:id/file
// ---------------------------------------------------------------------------

export type CaptureKind = "IMAGE" | "AUDIO_NOTE" | "LINK" | "TEXT";

export type CaptureFileTarget = "character" | "location" | "projectStyle" | "scene";

export interface InboxItem {
  id: string;
  kind: CaptureKind;
  text: string | null;
  transcript: string | null;
  sourceApp: string | null;
  media: MediaRef | null;
  projectId: string | null;
  createdAt: Iso;
}

export interface InboxResponse {
  items: InboxItem[];
}

export interface InboxFileRequest {
  target: { type: CaptureFileTarget; id: string };
}

// ---------------------------------------------------------------------------
// Push — POST/PATCH/DELETE /api/mobile/v1/push/*
// ---------------------------------------------------------------------------

export interface PushRegisterRequest {
  expoPushToken: string;
  platform: "ios" | "android";
  installId: string;
  name?: string;
}

export interface PushPrefsRequest {
  mutedProjectIds?: string[];
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  timezoneOffsetMinutes?: number | null;
}
