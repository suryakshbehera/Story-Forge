import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { RendersResponse, RenderItem } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { TakeMedia } from "@/components/review/TakeMedia";
import { useApiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { saveRenderToPhotos, shareRender } from "@/lib/media-actions";
import { API_BASE_URL } from "@/lib/config";

/**
 * Renders shelf — the Ship surface (mobile-app-ux-plan §4.6). Every take of
 * both final and silent renders, newest first. Save/Share download the
 * remote (auth-gated) file locally first so the OS recognizes a real video,
 * not a bare URL — see lib/media-actions.ts.
 *
 * M3.5's "first export" completion moment: when this list holds exactly one
 * final render, the screen leads with a congratulatory header instead of
 * the plain "Renders" title — a real, if simple, one-time state rather than
 * a toast that's easy to miss.
 */
export default function RendersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const apiFetch = useApiFetch();
  const { token } = useAuth();

  const [renders, setRenders] = useState<RenderItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<RendersResponse>(`/api/mobile/v1/projects/${id}/renders`);
      setRenders(data.renders);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load renders.");
    }
  }, [apiFetch, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(item: RenderItem) {
    if (!token || busyId) return;
    setBusyId(item.assetId);
    const result = await saveRenderToPhotos(item.media.url, token);
    setBusyId(null);
    if (!result.ok) {
      Alert.alert(result.reason === "permission-denied" ? "Photos access needed" : "Couldn't save", "Try again from Settings if this keeps happening.");
    }
  }

  async function handleShare(item: RenderItem) {
    if (!token || busyId) return;
    setBusyId(item.assetId);
    const result = await shareRender(item.media.url, token);
    setBusyId(null);
    if (!result.ok && result.reason !== "unavailable") {
      Alert.alert("Couldn't share", "Try again in a moment.");
    }
  }

  async function handleCopyLink(item: RenderItem) {
    // Same account-gated link shape as web's own "copy link" (ux-audit
    // 0.1) — opening it needs an authenticated session, same as the file
    // it points at always has.
    await Clipboard.setStringAsync(`${API_BASE_URL}${item.media.url}`);
    Alert.alert("Link copied");
  }

  if (renders === null && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  const finalRenderCount = renders?.filter((r) => r.kind === "finalAssembly").length ?? 0;
  const isFirstExport = finalRenderCount === 1;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>‹ Back</Text>
        </Pressable>
      </View>

      {isFirstExport && (
        <View style={[styles.celebration, { backgroundColor: colors.secondary }]}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>You made this. 🎬</Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 2 }}>Your first final render is ready to share.</Text>
        </View>
      )}

      {error && (
        <View style={styles.centered}>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{error}</Text>
        </View>
      )}

      {renders && renders.length === 0 && !error && (
        <View style={styles.centered}>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>No renders yet.</Text>
        </View>
      )}

      {renders && renders.length > 0 && (
        <FlatList
          data={renders}
          keyExtractor={(r) => r.assetId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border }]}>
              <View style={[styles.thumb, { backgroundColor: colors.card }]}>
                <TakeMedia media="video" url={item.media.url} />
              </View>
              <View style={styles.cardBody}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                  {item.kind === "finalAssembly" ? "Final cut" : "Silent picture"}
                  {item.isSelected ? " · Selected" : ""}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {formatMeta(item)}
                </Text>
                <View style={styles.actionsRow}>
                  <Pressable onPress={() => handleSave(item)} disabled={busyId === item.assetId}>
                    <Text style={{ color: colors.foreground, fontSize: 13 }}>⬇ Save</Text>
                  </Pressable>
                  <Pressable onPress={() => handleShare(item)} disabled={busyId === item.assetId}>
                    <Text style={{ color: colors.foreground, fontSize: 13 }}>↗ Share</Text>
                  </Pressable>
                  <Pressable onPress={() => handleCopyLink(item)}>
                    <Text style={{ color: colors.foreground, fontSize: 13 }}>⧉ Link</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function formatMeta(item: RenderItem): string {
  const parts: string[] = [];
  if (item.media.durationSeconds != null) {
    const m = Math.floor(item.media.durationSeconds / 60);
    const s = Math.round(item.media.durationSeconds % 60);
    parts.push(`${m}:${s.toString().padStart(2, "0")}`);
  }
  if (item.media.width && item.media.height) parts.push(`${item.media.width}x${item.media.height}`);
  if (item.media.sizeBytes) parts.push(`${(item.media.sizeBytes / (1024 * 1024)).toFixed(1)}MB`);
  return parts.length > 0 ? parts.join(" · ") : "Rendered " + new Date(item.createdAt).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  celebration: { marginHorizontal: 20, marginTop: 8, borderRadius: 12, padding: 14 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  emptyBody: { fontSize: 14, textAlign: "center" },
  list: { padding: 20, gap: 16 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
  thumb: { aspectRatio: 16 / 9 },
  cardBody: { padding: 12, gap: 4 },
  actionsRow: { flexDirection: "row", gap: 20, marginTop: 8 },
});
