import * as ImagePicker from "expo-image-picker";

export interface PickedFile {
  uri: string;
  fileName: string;
  mimeType: string;
}

async function fromResult(result: ImagePicker.ImagePickerResult): Promise<PickedFile | null> {
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    fileName: asset.fileName ?? `capture-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? "image/jpeg",
  };
}

/** M4.2 — camera capture, e.g. a location photo or a face reference taken on the spot. */
export async function captureFromCamera(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.8 });
  return fromResult(result);
}

/** M4.2 — camera-roll capture, e.g. a reference photo that already exists on the phone. */
export async function captureFromLibrary(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.8 });
  return fromResult(result);
}

/** Builds the multipart body POST /api/mobile/v1/inbox expects for an IMAGE/AUDIO_NOTE capture. */
export function buildCaptureFormData(kind: "IMAGE" | "AUDIO_NOTE", file: PickedFile, extra?: { text?: string; sourceApp?: string; projectId?: string }): FormData {
  const formData = new FormData();
  formData.append("kind", kind);
  // React Native's fetch/FormData accepts this {uri,name,type} object shape
  // for a file field — not a real Blob/File, but RN's networking layer
  // knows how to stream it. This does NOT work in a plain browser context
  // (the web target), which is fine: camera/library/mic capture are
  // native-only features (mobile-app-ux-plan §5.4).
  formData.append(
    "file",
    { uri: file.uri, name: file.fileName, type: file.mimeType } as unknown as Blob
  );
  if (extra?.text) formData.append("text", extra.text);
  if (extra?.sourceApp) formData.append("sourceApp", extra.sourceApp);
  if (extra?.projectId) formData.append("projectId", extra.projectId);
  return formData;
}
