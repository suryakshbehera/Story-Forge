import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet } from "react-native";
import type { ProjectsResponse, InboxItem } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch } from "@/lib/api";

interface NamedTarget {
  id: string;
  name: string;
}

type Step = "project" | "target";

/**
 * Filing picker — mobile-app-ux-plan §5.4: "a captured item is never
 * auto-applied... the human decides which character/location/scene it
 * belongs to." Two steps: pick the project (skipped when the capture
 * already carries a projectId hint), then pick where in it. Reuses the
 * EXISTING web list routes (GET /api/projects/:id/characters and
 * .../locations) over bearer auth — no new backend for this, same pattern
 * as the Retake sheet reusing /estimates.
 */
export function FileSheet({ item, visible, onClose, onFiled }: { item: InboxItem | null; visible: boolean; onClose: () => void; onFiled: () => void }) {
  const colors = useThemeColors();
  const apiFetch = useApiFetch();

  const [step, setStep] = useState<Step>("project");
  const [projects, setProjects] = useState<ProjectsResponse["projects"] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<NamedTarget[] | null>(null);
  const [locations, setLocations] = useState<NamedTarget[] | null>(null);
  const [filing, setFiling] = useState(false);

  useEffect(() => {
    if (!visible || !item) return;
    setProjectId(item.projectId);
    setStep(item.projectId ? "target" : "project");
    setProjects(null);
    setCharacters(null);
    setLocations(null);
    if (!item.projectId) {
      apiFetch<ProjectsResponse>("/api/mobile/v1/projects").then((r) => setProjects(r.projects));
    }
  }, [visible, item?.id]);

  useEffect(() => {
    if (step !== "target" || !projectId) return;
    apiFetch<NamedTarget[]>(`/api/projects/${projectId}/characters`).then(setCharacters);
    apiFetch<NamedTarget[]>(`/api/projects/${projectId}/locations`).then(setLocations);
  }, [step, projectId]);

  if (!item) return null;

  async function fileInto(type: "character" | "location" | "projectStyle", id: string) {
    if (filing) return;
    setFiling(true);
    try {
      await apiFetch(`/api/mobile/v1/inbox/${item!.id}/file`, {
        method: "POST",
        body: JSON.stringify({ target: { type, id } }),
      });
      onFiled();
    } catch {
      // The item stays in the inbox; user can try again — no dedicated
      // error surface for this v1 pass.
    } finally {
      setFiling(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        {step === "project" ? (
          <>
            <Text style={styles.title}>Which project?</Text>
            {!projects ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (
              <FlatList
                data={projects}
                keyExtractor={(p) => p.id}
                style={styles.list}
                renderItem={({ item: p }) => (
                  <Pressable
                    onPress={() => {
                      setProjectId(p.id);
                      setStep("target");
                    }}
                    style={[styles.row, { borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.foreground }}>{p.name}</Text>
                  </Pressable>
                )}
              />
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>File into…</Text>
            <FlatList
              style={styles.list}
              data={[
                { header: "Project style" },
                { target: { type: "projectStyle" as const, id: projectId! }, label: "Project style anchor" },
                { header: "Characters" },
                ...(characters ?? []).map((c) => ({ target: { type: "character" as const, id: c.id }, label: c.name })),
                { header: "Locations" },
                ...(locations ?? []).map((l) => ({ target: { type: "location" as const, id: l.id }, label: l.name })),
              ]}
              keyExtractor={(row, i) => ("header" in row ? `h-${row.header}-${i}` : `${row.target.type}-${row.target.id}`)}
              renderItem={({ item: row }) =>
                "header" in row ? (
                  <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>{row.header}</Text>
                ) : (
                  <Pressable onPress={() => fileInto(row.target.type, row.target.id)} disabled={filing} style={[styles.row, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.foreground }}>{row.label}</Text>
                  </Pressable>
                )
              }
              ListEmptyComponent={!characters || !locations ? <ActivityIndicator color={colors.mutedForeground} /> : null}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "70%", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  list: { flexGrow: 0 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionHeader: { fontSize: 12, fontWeight: "700", marginTop: 10, marginBottom: 2 },
});
