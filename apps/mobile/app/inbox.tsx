import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import type { InboxResponse, InboxItem } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch, ApiError } from "@/lib/api";
import { NewCaptureSheet } from "@/components/inbox/NewCaptureSheet";
import { FileSheet } from "@/components/inbox/FileSheet";

/**
 * Inbox — mobile-app-ux-plan §5.4: captured-but-unfiled items (a photo, a
 * voice memo, a link, a note), waiting for a human to say where they
 * belong. Reached from Projects (§4.4's inbox row); never auto-files
 * anything.
 */
export default function InboxScreen() {
  const colors = useThemeColors();
  const apiFetch = useApiFetch();

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [filingItem, setFilingItem] = useState<InboxItem | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<InboxResponse>("/api/mobile/v1/inbox");
      setItems(data.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the inbox.");
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(item: InboxItem) {
    Alert.alert("Delete this capture?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await apiFetch(`/api/mobile/v1/inbox/${item.id}`, { method: "DELETE" }).catch(() => {});
          load();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Inbox</Text>
        <Pressable onPress={() => setCapturing(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="New capture">
          <Text style={{ color: colors.foreground, fontSize: 24 }}>+</Text>
        </Pressable>
      </View>

      {items === null && !error && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      )}

      {error && (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>{error}</Text>
        </View>
      )}

      {items && items.length === 0 && !error && (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
            Nothing captured yet. Tap + to add a photo, voice memo, link, or note.
          </Text>
        </View>
      )}

      {items && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border }]}>
              {item.media && item.kind === "IMAGE" ? (
                <Image source={{ uri: item.media.url }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: colors.secondary }]}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 20 }}>{KIND_ICON[item.kind]}</Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{KIND_LABEL[item.kind]}</Text>
                {item.text ? (
                  <Text style={{ color: colors.foreground }} numberOfLines={2}>
                    {item.text}
                  </Text>
                ) : null}
                <View style={styles.actionsRow}>
                  <Pressable onPress={() => setFilingItem(item)}>
                    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>File…</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDelete(item)}>
                    <Text style={{ color: colors.destructive, fontSize: 13 }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}

      <NewCaptureSheet visible={capturing} onClose={() => setCapturing(false)} onCreated={load} />
      <FileSheet
        item={filingItem}
        visible={filingItem !== null}
        onClose={() => setFilingItem(null)}
        onFiled={() => {
          setFilingItem(null);
          load();
        }}
      />
    </View>
  );
}

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  IMAGE: "Photo",
  AUDIO_NOTE: "Voice memo",
  LINK: "Link",
  TEXT: "Note",
};

const KIND_ICON: Record<InboxItem["kind"], string> = {
  IMAGE: "🖼",
  AUDIO_NOTE: "🎙",
  LINK: "🔗",
  TEXT: "📝",
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 17, fontWeight: "700" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  list: { padding: 20, gap: 12 },
  card: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
  thumb: { width: 72, height: 72 },
  thumbPlaceholder: { justifyContent: "center", alignItems: "center" },
  cardBody: { flex: 1, padding: 10, gap: 4, justifyContent: "center" },
  actionsRow: { flexDirection: "row", gap: 16, marginTop: 4 },
});
