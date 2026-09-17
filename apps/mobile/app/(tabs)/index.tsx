import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ReviewResponse, ReviewSlot } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch, ApiError } from "@/lib/api";
import { TakeMedia } from "@/components/review/TakeMedia";
import { RetakeSheet } from "@/components/review/RetakeSheet";
import { useIsOnline } from "@/lib/network";
import { enqueueVerdict, flushPendingVerdicts, getPendingVerdicts, getConflicts } from "@/lib/offline-queue";

/**
 * Review: the verdict queue, and the reason the app exists (mobile-app-ux-
 * plan §4.2). M2 — the first pass wired to the real GET
 * /api/mobile/v1/review (M2.1/B5) with a real take card: full-bleed media,
 * swipe-to-browse take history, long-press compare, Use this take / Skip,
 * Keep, and the critic verdict. Region letters below match that plan's
 * §4.2 card diagram.
 */
export default function ReviewScreen() {
  const colors = useThemeColors();
  const apiFetch = useApiFetch();
  const { width } = useWindowDimensions();

  const [queue, setQueue] = useState<ReviewSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [takeIndex, setTakeIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comparingUrl, setComparingUrl] = useState<string | null>(null);
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const takesListRef = useRef<FlatList<ReviewSlot["takes"][number]>>(null);
  const isOnline = useIsOnline();
  const wasOnline = useRef(isOnline);

  const refreshOfflineCounts = useCallback(async () => {
    const [pending, conflicts] = await Promise.all([getPendingVerdicts(), getConflicts()]);
    setPendingCount(pending.length);
    setConflictCount(conflicts.length);
  }, []);

  useEffect(() => {
    refreshOfflineCounts();
  }, [refreshOfflineCounts]);

  function goToTake(index: number) {
    setTakeIndex(index);
    takesListRef.current?.scrollToIndex({ index, animated: true });
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ReviewResponse>("/api/mobile/v1/review");
      setQueue(data.items);
      setPosition(0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the review queue.");
    }
  }, [apiFetch]);

  // Flush on the offline->online transition — mobile-app-ux-plan §5.5.
  // Not verified against a real network-loss transition (no device in this
  // environment); the queue/flush logic itself is exercised by code review
  // and typechecking only. See lib/offline-queue.ts's header note.
  useEffect(() => {
    if (isOnline && !wasOnline.current) {
      flushPendingVerdicts(apiFetch).then((result) => {
        if (result.applied > 0) load();
        refreshOfflineCounts();
      });
    }
    wasOnline.current = isOnline;
  }, [isOnline, apiFetch, load, refreshOfflineCounts]);

  useEffect(() => {
    load();
  }, [load]);

  const slot: ReviewSlot | null = queue && position < queue.length ? queue[position] : null;

  useEffect(() => {
    if (!slot) return;
    const selectedIndex = slot.takes.findIndex((t) => t.id === slot.selectedTakeId);
    setTakeIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [slot?.slotId]);

  const take = slot?.takes[takeIndex] ?? null;
  const compareTargetUrl = slot ? (slot.compare.previousShotUrl ?? slot.compare.selectedUrl) : null;

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function useThisTake() {
    if (!slot || !take || busy) return;
    setBusy(true);
    try {
      const selectPath = slot.actions.selectPath.replace("{assetId}", take.id);
      if (!isOnline) {
        // Judging is the one thing worth queuing offline (mobile-app-ux-
        // plan §5.5) — Retake is disabled below instead of ever reaching
        // here offline.
        await enqueueVerdict({
          id: `${slot.slotId}-${Date.now()}`,
          slotId: slot.slotId,
          projectName: slot.project.name,
          contextLabel: slot.context.label,
          selectPath,
          queuedAt: new Date().toISOString(),
          knownSelectedTakeId: slot.selectedTakeId,
        });
        await refreshOfflineCounts();
      } else {
        await apiFetch(selectPath, { method: "POST" });
      }
      setQueue((q) => (q ? q.filter((_, i) => i !== position) : q));
    } catch {
      // Leave the slot in place — the user sees no change and can retry;
      // matches this pass's "no toast plumbing yet" scope (M2 doesn't build
      // a dedicated error-surface, the plan's Problem/Explanation/Action
      // pattern here is scoped to the critic verdict, not action failures).
    } finally {
      setBusy(false);
    }
  }

  function skipSlot() {
    // Client-local, commits nothing — mobile-app-ux-plan §5.5: the slot
    // reappears next session (i.e. next full queue fetch), nothing persists.
    setPosition((p) => p + 1);
  }

  async function toggleKeep() {
    if (!slot || !take || busy) return;
    const path = slot.actions.keepPath.replace("{assetId}", take.id);
    const nowKept = !take.keptAt;
    try {
      await apiFetch(path, { method: nowKept ? "POST" : "DELETE" });
      setQueue((q) => {
        if (!q) return q;
        const copy = q.slice();
        const target = copy[position];
        copy[position] = {
          ...target,
          takes: target.takes.map((t, i) => (i === takeIndex ? { ...t, keptAt: nowKept ? new Date().toISOString() : null } : t)),
        };
        return copy;
      });
    } catch {
      // Non-critical annotation — silently no-op on failure, next reload reflects true state.
    }
  }

  const takeWidth = width;

  if (queue === null && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't reach Narrata</Text>
        <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{error}</Text>
        <Pressable onPress={load} style={[styles.retryButton, { borderColor: colors.border }]}>
          <Text style={{ color: colors.foreground }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!slot) {
    // Real empty state — either the server queue is genuinely clear, or
    // this session's local position has walked past everything fetched
    // (skips aren't removed server-side, so a pull-to-refresh brings them
    // back). Same completion-moment framing either way per §4.2.
    return (
      <View style={styles.container}>
        <OfflineBanner isOnline={isOnline} pendingCount={pendingCount} conflictCount={conflictCount} />
        <View style={[styles.centered, { flex: 1 }]}>
          <SymbolView name={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} tintColor={colors.mutedForeground} size={40} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {queue && queue.length > 0 ? "Nothing left this session" : "Nothing waiting"}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            {queue && queue.length > 0
              ? "Pull down to bring skipped items back."
              : "Shot images, video takes, narration and music land here the moment there's something to decide."}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OfflineBanner isOnline={isOnline} pendingCount={pendingCount} conflictCount={conflictCount} />
      {/* A. Context bar */}
      <View style={[styles.contextBar, { borderBottomColor: colors.border }]}>
        <Text style={[styles.contextProject, { color: colors.mutedForeground }]}>{slot.project.name}</Text>
        <Text style={[styles.contextLabel, { color: colors.foreground }]}>{slot.context.label}</Text>
      </View>

      {/* B. Media — swipe browses take history; long-press/Compare overlays the continuity reference */}
      <Pressable
        style={styles.mediaArea}
        onLongPress={() => compareTargetUrl && setComparingUrl(compareTargetUrl)}
        onPressOut={() => setComparingUrl(null)}
        delayLongPress={200}
      >
        <FlatList
          ref={takesListRef}
          key={slot.slotId}
          data={slot.takes}
          keyExtractor={(t) => t.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={takeIndex}
          getItemLayout={(_, i) => ({ length: takeWidth, offset: takeWidth * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / takeWidth);
            setTakeIndex(Math.max(0, Math.min(slot.takes.length - 1, i)));
          }}
          renderItem={({ item }) => (
            <View style={{ width: takeWidth, height: "100%" }}>
              {/* item.media.url already IS the first clip's URL for video takes — see review-queue.ts's toReviewTake(representative, ...). */}
              <TakeMedia media={slot.media} url={item.media.url} clipCount={item.clips?.length} />
            </View>
          )}
        />
        {comparingUrl && (
          <View style={styles.compareOverlay} pointerEvents="none">
            <TakeMedia media="image" url={comparingUrl} />
            <View style={[styles.compareBadge, { backgroundColor: colors.background }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {slot.compare.previousShotUrl === comparingUrl ? "Previous shot" : "Selected take"}
              </Text>
            </View>
          </View>
        )}
        {slot.takes.length > 1 && (
          <View style={styles.dots}>
            {slot.takes.map((t, i) => (
              // The visible-control equivalent to swiping — mobile-app-ux-
              // plan §5.1 requires one for every gesture, not just for
              // accessibility tools. hitSlop compensates for the dot's own
              // small visual size without inflating it on screen.
              <Pressable
                key={t.id}
                onPress={() => goToTake(i)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Take ${i + 1} of ${slot.takes.length}${t.isSelected ? ", currently selected" : ""}`}
              >
                <View
                  style={[styles.dot, { backgroundColor: i === takeIndex ? colors.foreground : colors.mutedForeground, opacity: i === takeIndex ? 1 : 0.4 }]}
                />
              </Pressable>
            ))}
          </View>
        )}
      </Pressable>

      {/* C. Critic verdict */}
      {take?.validationPassed === false && (
        <View style={[styles.verdict, { backgroundColor: colors.secondary }]}>
          <Text style={{ color: colors.destructive, fontSize: 13 }}>⚠ {take.validationNotes ?? "The consistency check flagged this take."}</Text>
        </View>
      )}
      {take?.qcPassed === false && (
        <View style={[styles.verdict, { backgroundColor: colors.secondary }]}>
          <Text style={{ color: colors.destructive, fontSize: 13 }}>⚠ {take.qcNotes ?? "This clip looked frozen or near-static."}</Text>
        </View>
      )}

      {/* D. Secondary row */}
      <View style={styles.secondaryRow}>
        <Pressable onPress={toggleKeep} style={styles.secondaryButton}>
          <Text style={{ color: take?.keptAt ? colors.foreground : colors.mutedForeground, fontSize: 14 }}>{take?.keptAt ? "♥ Kept" : "♡ Keep"}</Text>
        </Pressable>
        {compareTargetUrl && (
          <Pressable
            onPressIn={() => setComparingUrl(compareTargetUrl)}
            onPressOut={() => setComparingUrl(null)}
            style={styles.secondaryButton}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>⧉ Compare</Text>
          </Pressable>
        )}
        {slot.actions.retakePath && (
          // Retakes never queue offline — they cost money and need a live
          // estimate (mobile-app-ux-plan §5.5) — disabled with a stated
          // reason rather than just vanishing.
          <Pressable onPress={() => isOnline && setRetakeOpen(true)} style={[styles.secondaryButton, { opacity: isOnline ? 1 : 0.4 }]} disabled={!isOnline}>
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>↻ {isOnline ? "Retake" : "Retake (needs internet)"}</Text>
          </Pressable>
        )}
      </View>

      {/* E. Primary + F. Skip */}
      <View style={styles.actions}>
        <Pressable onPress={useThisTake} disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{busy ? "…" : "Use this take"}</Text>
        </Pressable>
        <Pressable onPress={skipSlot} disabled={busy}>
          <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip for now ›</Text>
        </Pressable>
      </View>

      <RetakeSheet slot={slot} visible={retakeOpen} onClose={() => setRetakeOpen(false)} onStarted={() => setRetakeOpen(false)} />
    </View>
  );
}

/** Offline/pending/conflict status — mobile-app-ux-plan §5.5. Renders nothing when there's nothing to say, which is almost always. */
function OfflineBanner({ isOnline, pendingCount, conflictCount }: { isOnline: boolean; pendingCount: number; conflictCount: number }) {
  const colors = useThemeColors();
  if (isOnline && pendingCount === 0 && conflictCount === 0) return null;

  return (
    <View style={[bannerStyles.container, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      {!isOnline && <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Offline — decisions will sync when you're back online.</Text>}
      {pendingCount > 0 && (
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          {pendingCount} decision{pendingCount === 1 ? "" : "s"} queued
        </Text>
      )}
      {conflictCount > 0 && (
        <Pressable onPress={() => router.push("/conflicts")}>
          <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: "600" }}>
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"} need your call ›
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingVertical: 8, gap: 2 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center", paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 20, fontWeight: "600", marginTop: 4 },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryButton: { marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  contextBar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  contextProject: { fontSize: 12, marginBottom: 2 },
  contextLabel: { fontSize: 15, fontWeight: "600" },
  mediaArea: { flex: 1 },
  compareOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  compareBadge: { position: "absolute", top: 12, left: 12, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dots: { position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  verdict: { marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 10 },
  secondaryRow: { flexDirection: "row", gap: 20, paddingHorizontal: 20, paddingTop: 12 },
  secondaryButton: { paddingVertical: 6 },
  actions: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 10 },
  primaryButton: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  primaryButtonText: { fontSize: 16, fontWeight: "600" },
  skipText: { textAlign: "center", fontSize: 14, paddingBottom: 4 },
});
