import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import type { ProjectDetail } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { TakeMedia } from "@/components/review/TakeMedia";
import { useApiFetch, ApiError } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";

/**
 * Project detail — a mobile-shaped restatement of the web status board at
 * /projects/[id] (mobile-app-ux-plan §4.5): same rows, same order, same
 * completion semantics, not a new model. Rows for steps mobile doesn't
 * perform (Story, Scenes, Shot planning) are status-only and never fake
 * buttons — tapping "Continue on web" is an explicit, honest handoff.
 */
export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const apiFetch = useApiFetch();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ProjectDetail>(`/api/mobile/v1/projects/${id}`);
      setProject(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this project.");
    }
  }, [apiFetch, id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!project && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (error || !project) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load this project</Text>
        <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{error}</Text>
      </View>
    );
  }

  const rows: { label: string; state: string; done: boolean }[] = [
    { label: "Story", state: project.progress.storyDone ? "" : "not started", done: project.progress.storyDone },
    { label: "Characters", state: `${project.progress.characters.total} (${project.progress.characters.locked} locked)`, done: project.progress.characters.total > 0 },
    { label: "Locations", state: `${project.progress.locations.total}`, done: project.progress.locations.total > 0 },
    { label: "Scenes", state: `${project.progress.scenes.total}`, done: project.progress.scenes.total > 0 },
    {
      label: "Shot images",
      state: `${project.progress.shots.withImage} of ${project.progress.shots.total}`,
      done: project.progress.shots.total > 0 && project.progress.shots.withImage === project.progress.shots.total,
    },
    {
      label: "Voice",
      state: project.progress.voice.narratedScenes === 0 && project.progress.voice.dialogueLinesVoiced === 0 ? "not started" : "in progress",
      done: project.progress.voice.narratedScenes > 0 || project.progress.voice.dialogueLinesVoiced > 0,
    },
    { label: "Final render", state: project.progress.finalRenderCount > 0 ? `${project.progress.finalRenderCount}` : "—", done: project.progress.finalRenderCount > 0 },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to Projects">
          <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>‹ Projects</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{project.name}</Text>

      {project.hero && (
        <View style={[styles.hero, { backgroundColor: colors.card }]}>
          <TakeMedia media="video" url={project.hero.media.url} />
        </View>
      )}

      <View style={styles.rows}>
        {rows.map((row) => (
          <View key={row.label} style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={{ color: colors.foreground }}>
              {row.done ? "✓" : "○"} {row.label}
            </Text>
            {row.state ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{row.state}</Text> : null}
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => router.push(project.nextStep.kind === "review" ? "/" : "/projects")}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{project.nextStep.label}</Text>
      </Pressable>

      <Pressable onPress={() => router.push(`/projects/${id}/renders`)} style={[styles.linkRow, { borderColor: colors.border }]}>
        <Text style={{ color: colors.foreground }}>Renders ({project.rendersCount})</Text>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} tintColor={colors.mutedForeground} size={16} />
      </Pressable>

      <Pressable
        onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}${project.webHref}`)}
        style={[styles.linkRow, { borderColor: colors.border }]}
      >
        <Text style={{ color: colors.foreground }}>Continue on web</Text>
        <SymbolView name={{ ios: "arrow.up.right", android: "open_in_new", web: "open_in_new" }} tintColor={colors.mutedForeground} size={16} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 20, fontWeight: "600" },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  header: { flexDirection: "row" },
  title: { fontSize: 24, fontWeight: "700" },
  hero: { aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden" },
  rows: { gap: 0 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  primaryButton: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  primaryButtonText: { fontSize: 16, fontWeight: "600" },
  linkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
});
