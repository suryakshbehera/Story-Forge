import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, FlatList, RefreshControl } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ProjectsResponse, ProjectSummary, InboxResponse } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * Projects: read-only list, one pipeline-progress line per project. No "New
 * Project" button here — creation only happens as the tail of a capture
 * (M4.4) and hands off to web. Plan §4.4.
 *
 * M0.1 read-path spike: this is the first screen wired to the real BFF
 * (GET /api/mobile/v1/projects) instead of the M0.3 placeholder state.
 * Review/Activity stay on their M0.3 placeholders — building their real
 * queries is M1/M2, not M0.
 */
export default function ProjectsScreen() {
  const colors = useThemeColors();
  const { user, logout } = useAuth();
  const apiFetch = useApiFetch();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [projectsData, inboxData] = await Promise.all([
        apiFetch<ProjectsResponse>("/api/mobile/v1/projects"),
        apiFetch<InboxResponse>("/api/mobile/v1/inbox"),
      ]);
      setProjects(projectsData.projects);
      setInboxCount(inboxData.items.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load projects.");
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

  if (projects === null && !error) {
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

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={styles.headerTitle}>Projects</Text>
        <Pressable onPress={logout} hitSlop={12}>
          <Text style={[styles.signOut, { color: colors.mutedForeground }]}>{user?.email ?? "Sign out"}</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => router.push("/inbox")} style={[styles.inboxRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>Inbox</Text>
        {inboxCount > 0 ? (
          <View style={[styles.inboxBadge, { backgroundColor: colors.foreground }]}>
            <Text style={{ color: colors.background, fontSize: 12, fontWeight: "700" }}>{inboxCount}</Text>
          </View>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Empty</Text>
        )}
      </Pressable>

      {projects!.length === 0 ? (
        <View style={styles.centered}>
          <SymbolView
            name={{ ios: "folder", android: "folder", web: "folder" }}
            tintColor={colors.mutedForeground}
            size={40}
          />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No projects yet</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Start a project on web — it'll show up here once there's something to watch, judge, or ship.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects!}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ProjectCard project={item} />}
        />
      )}
    </View>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push(`/projects/${project.id}`)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{project.name}</Text>
      <Text style={[styles.cardHeadline, { color: colors.mutedForeground }]}>{project.progress.headline}</Text>
      <View style={styles.cardMetaRow}>
        {project.waitingCount > 0 && (
          <Text style={[styles.badge, { color: colors.foreground }]}>● {project.waitingCount} waiting</Text>
        )}
        {project.runningCount > 0 && (
          <Text style={[styles.badge, { color: colors.mutedForeground }]}>◐ {project.runningCount} running</Text>
        )}
        {project.waitingCount === 0 && project.runningCount === 0 && (
          <Text style={[styles.badge, { color: colors.mutedForeground }]}>✓ nothing waiting</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  signOut: { fontSize: 13 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 20, fontWeight: "600", marginTop: 4 },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryButton: { marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  inboxRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inboxBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  list: { padding: 16, gap: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 4 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  cardHeadline: { fontSize: 14 },
  cardMetaRow: { flexDirection: "row", gap: 12, marginTop: 6 },
  badge: { fontSize: 13 },
});
