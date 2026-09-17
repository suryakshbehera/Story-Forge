// The new class-based expo-file-system API (`import { File } from
// "expo-file-system"`) crashes at MODULE LOAD time on the web target —
// `class File extends ExpoFileSystem.FileSystemFile` throws "Class extends
// value undefined" when the native binding isn't registered. The legacy
// function-based API (`expo-file-system/legacy`) degrades gracefully
// instead — cacheDirectory is `null` on unsupported platforms rather than
// throwing.
//
// expo-media-library has the identical problem but with NO web
// implementation at all (`class Asset extends ExpoMediaLibraryNext.Asset`
// in its own index.js, unconditionally) — there's no legacy escape hatch,
// so it's dynamically imported inside saveRenderToPhotos() below, guarded
// by Platform.OS, so the module is never evaluated while bundling for web
// (only actually reached on a real device, where Save to Photos is a real
// feature anyway). expo-sharing has no such class and imports cleanly
// everywhere. Both found live via `expo export -p web`, the same
// verification used throughout this session — not documented anywhere
// obvious in either package.
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "./config";

export type MediaActionResult = { ok: true } | { ok: false; reason: "permission-denied" | "download-failed" | "unavailable" };

// /api/storage/<key> is login-gated (see apps/web/src/proxy.ts), so the
// remote URL needs the bearer token attached at download time — expo-image
// and expo-video pass per-request headers of their own for in-app viewing,
// but a plain download needs the same header explicit here.
async function downloadToCache(url: string, token: string): Promise<string> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error("No cache directory on this platform.");
  const fileName = url.split("/").pop()?.split("?")[0] || `narrata-${Date.now()}`;
  const destination = `${dir}${fileName}`;
  const result = await FileSystem.downloadAsync(`${API_BASE_URL}${url}`, destination, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result.uri;
}

/** M3.2 — Save to Photos. Native-only; there is no web equivalent of a camera roll. */
export async function saveRenderToPhotos(url: string, token: string): Promise<MediaActionResult> {
  if (Platform.OS === "web") return { ok: false, reason: "unavailable" };
  const MediaLibrary = await import("expo-media-library");

  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: "permission-denied" };

  let uri: string;
  try {
    uri = await downloadToCache(url, token);
  } catch {
    return { ok: false, reason: "download-failed" };
  }

  await MediaLibrary.saveToLibraryAsync(uri);
  return { ok: true };
}

/** M3.2 — OS share sheet. Downloads first so the share sheet recognizes the real file type/name, not a bare URL. */
export async function shareRender(url: string, token: string): Promise<MediaActionResult> {
  const available = await Sharing.isAvailableAsync();
  if (!available) return { ok: false, reason: "unavailable" };

  let uri: string;
  try {
    uri = await downloadToCache(url, token);
  } catch {
    return { ok: false, reason: "download-failed" };
  }

  await Sharing.shareAsync(uri);
  return { ok: true };
}
