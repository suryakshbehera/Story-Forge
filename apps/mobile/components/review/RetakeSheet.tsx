import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput } from "react-native";
import type { ReviewSlot, SlotKind } from "contract";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch } from "@/lib/api";

const SCOPE_LABEL: Record<SlotKind, string> = {
  shotImage: "1 image",
  video: "1 video clip",
  narration: "1 narration take",
  dialogueAudio: "1 dialogue line",
  music: "1 music take",
  sfx: "1 SFX take",
  silentAssembly: "the silent picture",
  finalAssembly: "the final render",
};

interface Estimate {
  medianCostUsd: number | null;
  medianDurationMs: number | null;
  sampleSize: number;
}

function formatEstimate(estimate: Estimate | null): string {
  if (!estimate || estimate.sampleSize === 0) return "No history yet for this yet — first run, no estimate.";
  const parts: string[] = [];
  if (estimate.medianDurationMs != null) {
    const seconds = Math.round(estimate.medianDurationMs / 1000);
    parts.push(seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)}m`);
  }
  if (estimate.medianCostUsd != null) parts.push(`~$${estimate.medianCostUsd.toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : "No history yet.";
}

/**
 * Retake pre-flight sheet — mobile-app-ux-plan §4.3. Scope first, cost
 * second (creators reason in units of work, not dollars); dismisses
 * immediately on Start, no waiting for the job. The "change something?"
 * free-text line only appears for shotImage — that's the only one of the 8
 * generate routes that currently accepts an amendment field
 * (`instructions`); the other 7 only take modelId. Not a client
 * limitation to work around, a real backend gap left for a future pass.
 */
export function RetakeSheet({ slot, visible, onClose, onStarted }: { slot: ReviewSlot | null; visible: boolean; onClose: () => void; onStarted: () => void }) {
  const colors = useThemeColors();
  const apiFetch = useApiFetch();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!visible || !slot) return;
    setInstructions("");
    if (!slot.actions.estimateJobType) {
      setEstimate(null);
      return;
    }
    setLoadingEstimate(true);
    apiFetch<Estimate>(`/api/projects/${slot.project.id}/estimates?jobType=${slot.actions.estimateJobType}`)
      .then(setEstimate)
      .catch(() => setEstimate(null))
      .finally(() => setLoadingEstimate(false));
  }, [visible, slot?.slotId]);

  if (!slot) return null;
  const currentSlot = slot;

  async function start() {
    if (!currentSlot.actions.retakePath || starting) return;
    setStarting(true);
    try {
      const body = currentSlot.kind === "shotImage" && instructions.trim() ? { instructions: instructions.trim() } : {};
      await apiFetch(currentSlot.actions.retakePath, { method: "POST", body: JSON.stringify(body) });
    } catch {
      // Fire-and-forget by design (§4.3: "the user does not wait") — a
      // failure to even queue it is rare (claim conflict, missing model
      // config) and surfaces later via Activity's Needs You section, not
      // here.
    } finally {
      setStarting(false);
      onStarted();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={styles.title}>Retake this {slot.media}</Text>

        <View style={styles.row}>
          <Text style={{ color: colors.mutedForeground }}>Scope</Text>
          <Text style={{ color: colors.foreground }}>{SCOPE_LABEL[slot.kind]}</Text>
        </View>
        <View style={styles.row}>
          <Text style={{ color: colors.mutedForeground }}>Typical</Text>
          {loadingEstimate ? <ActivityIndicator size="small" /> : <Text style={{ color: colors.foreground }}>{formatEstimate(estimate)}</Text>}
        </View>

        {slot.kind === "shotImage" && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Change something?</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              placeholder="Leave empty to retry as-is"
              placeholderTextColor={colors.mutedForeground}
              value={instructions}
              onChangeText={setInstructions}
              multiline
            />
          </>
        )}

        <Pressable
          onPress={start}
          disabled={starting || !slot.actions.retakePath}
          style={[styles.startButton, { backgroundColor: colors.primary, opacity: starting ? 0.6 : 1 }]}
        >
          <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: "600" }}>{starting ? "Starting…" : "Start retake"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  fieldLabel: { fontSize: 13, marginTop: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, minHeight: 60, textAlignVertical: "top" },
  startButton: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
});
