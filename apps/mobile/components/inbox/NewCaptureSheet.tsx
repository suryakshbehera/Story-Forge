import { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput } from "react-native";
import { SymbolView } from "expo-symbols";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync } from "expo-audio";

import { Text, View, useThemeColors } from "@/components/Themed";
import { useApiFetch } from "@/lib/api";
import { captureFromCamera, captureFromLibrary, buildCaptureFormData } from "@/lib/capture";

/**
 * New Capture — mobile-app-ux-plan §5.4's four entry points, minus the OS
 * share sheet (M4.1, needs a native share extension/config plugin beyond
 * what's buildable without EAS/Xcode/Android Studio in this environment —
 * genuinely not skippable client work, not deferred lightly).
 */
export function NewCaptureSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const colors = useThemeColors();
  const apiFetch = useApiFetch();
  const [mode, setMode] = useState<"menu" | "text" | "recording">("menu");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  function reset() {
    setMode("menu");
    setText("");
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submitImage(pick: () => Promise<Awaited<ReturnType<typeof captureFromCamera>>>) {
    setBusy(true);
    try {
      const file = await pick();
      if (!file) return;
      await apiFetch("/api/mobile/v1/inbox", { method: "POST", body: buildCaptureFormData("IMAGE", file) });
      onCreated();
      close();
    } finally {
      setBusy(false);
    }
  }

  async function submitTextOrLink() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const isLink = /^https?:\/\//i.test(text.trim());
      await apiFetch("/api/mobile/v1/inbox", {
        method: "POST",
        body: JSON.stringify({ kind: isLink ? "LINK" : "TEXT", text: text.trim() }),
      });
      onCreated();
      close();
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return;
    setMode("recording");
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function finishRecording() {
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      await apiFetch("/api/mobile/v1/inbox", {
        method: "POST",
        body: buildCaptureFormData("AUDIO_NOTE", { uri, fileName: `memo-${Date.now()}.m4a`, mimeType: "audio/m4a" }),
      });
      onCreated();
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        {mode === "menu" && (
          <>
            <Text style={styles.title}>Capture something</Text>
            <Pressable onPress={() => submitImage(captureFromCamera)} disabled={busy} style={styles.option}>
              <SymbolView name={{ ios: "camera", android: "photo_camera", web: "photo_camera" }} tintColor={colors.foreground} size={22} />
              <Text style={{ color: colors.foreground, fontSize: 16 }}>Take a photo</Text>
            </Pressable>
            <Pressable onPress={() => submitImage(captureFromLibrary)} disabled={busy} style={styles.option}>
              <SymbolView name={{ ios: "photo", android: "photo_library", web: "photo_library" }} tintColor={colors.foreground} size={22} />
              <Text style={{ color: colors.foreground, fontSize: 16 }}>Choose from library</Text>
            </Pressable>
            <Pressable onPress={startRecording} disabled={busy} style={styles.option}>
              <SymbolView name={{ ios: "mic", android: "mic", web: "mic" }} tintColor={colors.foreground} size={22} />
              <Text style={{ color: colors.foreground, fontSize: 16 }}>Record a voice memo</Text>
            </Pressable>
            <Pressable onPress={() => setMode("text")} disabled={busy} style={styles.option}>
              <SymbolView name={{ ios: "text.alignleft", android: "notes", web: "notes" }} tintColor={colors.foreground} size={22} />
              <Text style={{ color: colors.foreground, fontSize: 16 }}>Paste a link or write a note</Text>
            </Pressable>
          </>
        )}

        {mode === "text" && (
          <>
            <Text style={styles.title}>Link or note</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              placeholder="Paste a link, or write a quick note"
              placeholderTextColor={colors.mutedForeground}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
            />
            <Pressable onPress={submitTextOrLink} disabled={busy || !text.trim()} style={[styles.submitButton, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
              <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Add to Inbox</Text>
            </Pressable>
          </>
        )}

        {mode === "recording" && (
          <>
            <Text style={styles.title}>Recording…</Text>
            <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 24, marginVertical: 20 }}>
              {Math.floor(recorderState.durationMillis / 1000)}s
            </Text>
            <Pressable onPress={finishRecording} disabled={busy} style={[styles.submitButton, { backgroundColor: colors.destructive }]}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Stop and save</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 4 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, minHeight: 80, textAlignVertical: "top", marginBottom: 12 },
  submitButton: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
});
