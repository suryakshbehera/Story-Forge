import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReviewResponse, SlotId } from "contract";

/**
 * Local verdict queue — mobile-app-ux-plan §5.5. Judging is the one thing
 * worth making work offline (it's exactly what you do on a train); Retakes
 * never queue offline (they cost money and need a live estimate — the
 * Review screen disables Retake itself when offline, this module never
 * sees a retake).
 *
 * Not verified against a real network-loss transition — there's no device
 * in this environment to pull airplane mode on. Verified: the pure
 * queue/flush logic below, and that AsyncStorage/NetInfo import cleanly on
 * every platform including web (checked via `expo export -p web`, the same
 * way every other native-module addition was checked this session).
 */
export interface PendingVerdict {
  id: string;
  slotId: SlotId;
  projectName: string;
  contextLabel: string;
  /** {assetId} already substituted into the real select path. */
  selectPath: string;
  queuedAt: string;
  /** What the slot's selectedTakeId was when this decision was made, offline — the conflict check's baseline. */
  knownSelectedTakeId: string | null;
}

export interface Conflict extends PendingVerdict {
  reason: "resolved-elsewhere";
}

const QUEUE_KEY = "narrata.offline.pendingVerdicts";
const CONFLICTS_KEY = "narrata.offline.conflicts";

async function readList<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

export async function getPendingVerdicts(): Promise<PendingVerdict[]> {
  return readList<PendingVerdict>(QUEUE_KEY);
}

export async function enqueueVerdict(verdict: PendingVerdict): Promise<void> {
  const existing = await getPendingVerdicts();
  await writeList(QUEUE_KEY, [...existing, verdict]);
}

async function removePendingVerdict(id: string): Promise<void> {
  const existing = await getPendingVerdicts();
  await writeList(
    QUEUE_KEY,
    existing.filter((v) => v.id !== id)
  );
}

export async function getConflicts(): Promise<Conflict[]> {
  return readList<Conflict>(CONFLICTS_KEY);
}

/** Discards a conflict's OFFLINE choice — the live/web state stands untouched. */
export async function discardConflict(id: string): Promise<void> {
  const existing = await getConflicts();
  await writeList(
    CONFLICTS_KEY,
    existing.filter((c) => c.id !== id)
  );
}

type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Re-applies a conflict's OFFLINE choice anyway, overriding whatever is live now. Human-initiated only — never automatic. */
export async function applyConflictAnyway(conflict: Conflict, apiFetch: ApiFetch): Promise<void> {
  await apiFetch(conflict.selectPath, { method: "POST" });
  await discardConflict(conflict.id);
}

/**
 * Applies every pending verdict, checking each against the live queue
 * first — §5.5: "do not last-write-wins... the human re-decides." A slot
 * whose live selectedTakeId no longer matches what was true when the
 * offline decision was made (or that's vanished from the queue entirely,
 * i.e. already resolved elsewhere) becomes a Conflict instead of being
 * silently applied or silently dropped.
 */
export async function flushPendingVerdicts(apiFetch: ApiFetch): Promise<{ applied: number; conflicts: number }> {
  const pending = await getPendingVerdicts();
  if (pending.length === 0) return { applied: 0, conflicts: 0 };

  // One fetch of the live queue serves every pending verdict's conflict
  // check — there's no per-slot endpoint, and the queue is small (tens of
  // items, per mobile-technical-plan-2026-09.md §1.5), so this is cheap.
  let live: ReviewResponse;
  try {
    live = await apiFetch<ReviewResponse>("/api/mobile/v1/review?limit=50");
  } catch {
    return { applied: 0, conflicts: 0 }; // Still offline or unreachable — retried on the next flush.
  }
  const liveBySlot = new Map(live.items.map((s) => [s.slotId, s]));

  let applied = 0;
  let conflicts = 0;

  for (const verdict of pending) {
    const liveSlot = liveBySlot.get(verdict.slotId);
    const stillMatches = liveSlot?.selectedTakeId === verdict.knownSelectedTakeId;

    if (stillMatches) {
      try {
        await apiFetch(verdict.selectPath, { method: "POST" });
        await removePendingVerdict(verdict.id);
        applied += 1;
      } catch {
        // Leave it queued — a transient failure here shouldn't silently
        // drop a human decision; retried on the next flush.
      }
    } else {
      const existing = await getConflicts();
      await writeList(CONFLICTS_KEY, [...existing, { ...verdict, reason: "resolved-elsewhere" as const }]);
      await removePendingVerdict(verdict.id);
      conflicts += 1;
    }
  }

  return { applied, conflicts };
}
