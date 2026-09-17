import { prisma } from "@/lib/db";
import type { RecordGenerationEventInput } from "./generation-events";

// Push completion notifications — hooked from recordGenerationEvent(), the
// existing terminal-state path every metered job type (plus both ffmpeg
// assembly steps) already calls. No job queue: `notifyGenerationFinished`
// moves into a worker unchanged if one is ever built, because the call site
// is at the terminal-state boundary, not inside a request handler. See
// docs/product/mobile-technical-plan-2026-09.md §4.

type NotifyType = "ready" | "failed" | "done";

interface PendingBatch {
  timer: ReturnType<typeof setTimeout>;
  count: number;
  projectId: string;
  userId: string;
  type: NotifyType;
  /** Set on the first failure in the window — used for the single-failure message. */
  firstError: { label: string; provider: string } | null;
}

// In-process only — dies on redeploy, and that's an accepted trade-off, not
// an oversight: "Notifications are an accelerant, never the source of
// truth. Activity must be correct on open regardless of what was
// delivered." (mobile-app-ux-plan-2026-09.md). No outbox table.
const pending = new Map<string, PendingBatch>();

const COALESCE_WINDOW_MS = 90 * 1000;
// Backs the <=2-3/hour guidance (Apple's own wording) — a 20-minute floor
// is exactly 3/hour. failed/done bypass it: rare, high-value, and the two
// a user would be angry to miss.
const RENOTIFY_FLOOR_MS = 20 * 60 * 1000;

function classify(input: RecordGenerationEventInput): NotifyType {
  if (!input.success) return "failed";
  // Both ffmpeg assembly steps record jobType "VIDEO" with no other
  // distinguishing field except `provider` — see
  // narrata-mobile-m0-implemented-2026-09-15 / video-assembly.ts's
  // recordGenerationEvent calls. Silent assembly finishing is routine
  // ("ready" bucket); the FINAL render is the one truly celebratory event.
  if (input.jobType === "VIDEO" && input.provider === "ffmpeg-final-assembly") return "done";
  return "ready";
}

function batchKey(userId: string, projectId: string, type: NotifyType): string {
  return `${userId}|${projectId}|${type}`;
}

/** Fire-and-forget from recordGenerationEvent — never throws, never awaited by its caller. */
export function notifyGenerationFinished(input: RecordGenerationEventInput): void {
  enqueue(input).catch(() => {});
}

async function enqueue(input: RecordGenerationEventInput): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { ownerId: true, name: true } });
  // ownerId is nullable — pre-auth rows get backfilled to the admin by
  // bootstrap-admin.ts, but that's a startup-time fixup, not a runtime
  // guarantee this code should assume. No owner means no one to notify.
  if (!project?.ownerId) return;

  const type = classify(input);
  const key = batchKey(project.ownerId, input.projectId, type);
  const existing = pending.get(key);

  if (existing) {
    existing.count += 1;
    return;
  }

  const batch: PendingBatch = {
    count: 1,
    projectId: input.projectId,
    userId: project.ownerId,
    type,
    firstError: !input.success ? { label: input.jobType, provider: input.provider } : null,
    timer: setTimeout(() => {
      pending.delete(key);
      flush(batch, project.name).catch(() => {});
    }, COALESCE_WINDOW_MS),
  };
  pending.set(key, batch);
}

function buildMessage(batch: PendingBatch, projectName: string): { title: string; body: string; deepLink: string } {
  if (batch.type === "failed") {
    const body =
      batch.count === 1 && batch.firstError
        ? `${projectName}: a generation failed — ${batch.firstError.provider}.`
        : `${projectName}: ${batch.count} generations failed.`;
    return { title: "Needs you", body, deepLink: `/activity?project=${batch.projectId}` };
  }
  if (batch.type === "done") {
    return { title: projectName, body: "Final render ready.", deepLink: `/renders?project=${batch.projectId}` };
  }
  const body = batch.count === 1 ? `${projectName}: 1 take ready to review.` : `${projectName}: ${batch.count} takes ready to review.`;
  return { title: projectName, body, deepLink: `/?project=${batch.projectId}` };
}

function localHour(nowMs: number, timezoneOffsetMinutes: number): number {
  // Same sign convention as JS's Date.prototype.getTimezoneOffset(): UTC =
  // local + offset, so local = UTC - offset. The mobile client is expected
  // to send `new Date().getTimezoneOffset()` verbatim when registering
  // quiet hours (M1.1) — not enforced yet since no client code calls
  // /push/prefs, documented here so that client code gets it right.
  const localMs = nowMs - timezoneOffsetMinutes * 60_000;
  return new Date(localMs).getUTCHours();
}

function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps past midnight, e.g. 22..7
}

async function flush(batch: PendingBatch, projectName: string): Promise<void> {
  const devices = await prisma.pushDevice.findMany({ where: { userId: batch.userId } });
  if (devices.length === 0) return;

  const message = buildMessage(batch, projectName);
  const now = Date.now();

  const targets = devices.filter((device) => {
    if (device.mutedProjectIds.includes(batch.projectId)) return false;
    if (
      device.quietHoursStart != null &&
      device.quietHoursEnd != null &&
      device.timezoneOffsetMinutes != null &&
      inQuietHours(localHour(now, device.timezoneOffsetMinutes), device.quietHoursStart, device.quietHoursEnd)
    ) {
      return false;
    }
    if (batch.type === "ready" && device.lastNotifiedAt && now - device.lastNotifiedAt.getTime() < RENOTIFY_FLOOR_MS) {
      return false;
    }
    return true;
  });
  if (targets.length === 0) return;

  await sendExpoPush(
    targets.map((d) => d.expoPushToken),
    message
  );
  await prisma.pushDevice.updateMany({
    where: { id: { in: targets.map((d) => d.id) } },
    data: { lastNotifiedAt: new Date(now) },
  });
}

// Deliberately plain fetch to Expo's HTTP push API rather than the
// expo-server-sdk package — that SDK is batching-plus-a-receipts-poller and
// this app needs neither at this volume. Up to 100 messages per call; we're
// nowhere near that per flush.
async function sendExpoPush(tokens: string[], message: { title: string; body: string; deepLink: string }): Promise<void> {
  if (tokens.length === 0) return;
  let response: Response;
  try {
    response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        tokens.map((to) => ({ to, title: message.title, body: message.body, data: { deepLink: message.deepLink } }))
      ),
    });
  } catch {
    return; // Best-effort — a network failure here must never surface anywhere.
  }
  if (!response.ok) return;

  const result = (await response.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
  const tickets = result?.data ?? [];
  const deregisterTokens = tokens.filter((_, i) => tickets[i]?.details?.error === "DeviceNotRegistered");
  if (deregisterTokens.length > 0) {
    await prisma.pushDevice.deleteMany({ where: { expoPushToken: { in: deregisterTokens } } }).catch(() => {});
  }
}
