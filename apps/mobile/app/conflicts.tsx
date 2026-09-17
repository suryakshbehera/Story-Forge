import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch } from "@/lib/api";
import { getConflicts, applyConflictAnyway, discardConflict, type Conflict } from "@/lib/offline-queue";

/**
 * Conflict resolution — mobile-app-ux-plan §5.5: "You picked Take 3
 * offline. Take 1 was selected on web since. Which stands?" A manual-first
 * product must not resolve a human's decision against another human's
 * decision by timestamp — the human re-decides, every time, never
 * automatic. Reached whenever the offline queue's flush finds one; not a
 * tab, since it should be empty almost always.
 */
export default function ConflictsScreen() {
  const colors = useThemeColors();
  const apiFetch = useApiFetch();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setConflicts(await getConflicts());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApply(conflict: Conflict) {
    setBusyId(conflict.id);
    try {
      await applyConflictAnyway(conflict, apiFetch);
    } catch {
      // Leave it in the list — the user can retry.
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function handleDiscard(conflict: Conflict) {
    setBusyId(conflict.id);
    await discardConflict(conflict.id);
    setBusyId(null);
    load();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Conflicts</Text>
      </View>

      {conflicts.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>Nothing to resolve.</Text>
        </View>
      ) : (
        <FlatList
          data={conflicts}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.projectName}</Text>
              <Text style={{ color: colors.foreground, fontWeight: "600", marginBottom: 4 }}>{item.contextLabel}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 12 }}>
                You picked a take for this while offline, but it's since changed on web or another device. Apply your
                offline choice anyway, or leave the current one as-is?
              </Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => handleApply(item)}
                  disabled={busyId === item.id}
                  style={[styles.actionButton, { backgroundColor: colors.primary }]}
                >
                  <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Apply mine anyway</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDiscard(item)}
                  disabled={busyId === item.id}
                  style={[styles.actionButton, styles.secondaryAction, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>Leave as-is</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: "700" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  list: { padding: 20, gap: 16 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16 },
  actions: { gap: 10 },
  actionButton: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondaryAction: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent" },
});
