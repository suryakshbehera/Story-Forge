import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import type { ActivityResponse } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { registerForPushNotifications } from "@/lib/push";

/**
 * Activity: Running / Needs you / Done today — descending order of what the
 * user must act on. "Queued != failed" is stated here, not left to a
 * stalled spinner. Plan §4.7.
 *
 * The push-enable banner lives here rather than firing on launch (plan
 * §5.3's "never on launch" rule) — see lib/push.ts's doc comment for why
 * this screen, not the Retake flow the plan originally proposed, is this
 * app's trigger for now.
 */
export default function ActivityScreen() {
  const colors = useThemeColors();
  const { token } = useAuth();
  const apiFetch = useApiFetch();

  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pushState, setPushState] = useState<"unknown" | "enabling" | "enabled" | "denied" | "unavailable">("unknown");

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await apiFetch<ActivityResponse>("/api/mobile/v1/activity");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load activity.");
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function enablePush() {
    if (!token) return;
    setPushState("enabling");
    const result = await registerForPushNotifications(token);
    if (result.ok) setPushState("enabled");
    else if (result.reason === "permission-denied") setPushState("denied");
    else setPushState("unavailable");
  }

  if (!data && !error) {
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

  const { running, needsYou, doneToday } = data!;
  const isEmpty = running.length === 0 && needsYou.length === 0 && doneToday.length === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
    >
      <Text style={styles.title}>Activity</Text>

      {pushState !== "enabled" && (
        <View style={[styles.banner, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Text style={[styles.bannerText, { color: colors.foreground }]}>
            {pushState === "denied"
              ? "Notifications are off — enable them in system settings to hear when generations finish."
              : pushState === "unavailable"
                ? "Push isn't available here (needs a physical device)."
                : "Get notified when generations finish, even with the app closed."}
          </Text>
          {pushState !== "denied" && pushState !== "unavailable" && (
            <Pressable onPress={enablePush} disabled={pushState === "enabling"}>
              <Text style={[styles.bannerAction, { color: colors.foreground }]}>
                {pushState === "enabling" ? "Enabling…" : "Enable"}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {isEmpty ? (
        <View style={styles.centered}>
          <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} tintColor={colors.mutedForeground} size={40} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All quiet</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Running jobs, failures that need a retry, and what finished today will show up here.
          </Text>
        </View>
      ) : (
        <>
          {running.length > 0 && (
            <Section title="RUNNING" colors={colors}>
              {running.map((job, i) => (
                <View key={`${job.slotId}-${i}`} style={[styles.row, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground }}>◐ {job.label}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {job.stage}
                    {job.etaSeconds != null ? ` · ~${Math.max(1, Math.round(job.etaSeconds / 60))}m` : ""}
                  </Text>
                </View>
              ))}
            </Section>
          )}

          {needsYou.length > 0 && (
            <Section title="NEEDS YOU" colors={colors}>
              {needsYou.map((f, i) => (
                <View key={`${f.slotId ?? f.entityId}-${i}`} style={[styles.row, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.destructive }}>⚠ {f.label}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {f.provider}
                    {f.errorMessage ? ` · ${f.errorMessage}` : ""}
                  </Text>
                </View>
              ))}
            </Section>
          )}

          {doneToday.length > 0 && (
            <Section title="DONE TODAY" colors={colors}>
              {doneToday.map((d, i) => (
                <View key={`${d.projectId}-${d.jobType}-${i}`} style={[styles.row, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground }}>✓ {d.label}</Text>
                </View>
              ))}
            </Section>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, colors, children }: { title: string; colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  bannerAction: { fontSize: 14, fontWeight: "600" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 20, fontWeight: "600", marginTop: 4 },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryButton: { marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 2 },
});
