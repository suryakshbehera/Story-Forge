import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./config";

// One row per app install, not per session (backend: PushDevice in
// schema.prisma) — installId must survive login/logout and token refresh,
// so it's generated once and kept in SecureStore, never regenerated.
const INSTALL_ID_KEY = "narrata.push.installId";

async function getOrCreateInstallId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (existing) return existing;
  // No expo-crypto dependency for this — an installId only needs to be
  // unique per device, not cryptographically unguessable.
  const generated = `install-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(INSTALL_ID_KEY, generated);
  return generated;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type RegisterResult = { ok: true } | { ok: false; reason: "not-a-device" | "permission-denied" | "request-failed" };

/**
 * Requests permission and registers this device with the backend. Callers
 * decide WHEN to call this — permission priming belongs after the first
 * generation is started, never on launch (mobile-app-ux-plan §5.3). M2/M3
 * (Retake, the natural trigger) aren't built yet, so for M1 this is wired to
 * an explicit "Enable notifications" action on the Activity screen instead
 * of an automatic trigger — same rule, the nearest honest hook available
 * today. Move the call site, not this function, once Retake exists.
 */
export async function registerForPushNotifications(token: string): Promise<RegisterResult> {
  if (!Device.isDevice) {
    // Simulators/emulators (and the web target) can't receive push at all.
    return { ok: false, reason: "not-a-device" };
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") {
    return { ok: false, reason: "permission-denied" };
  }

  const expoPushToken = (await Notifications.getExpoPushTokenAsync()).data;
  const installId = await getOrCreateInstallId();

  try {
    const res = await fetch(`${API_BASE_URL}/api/mobile/v1/push/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expoPushToken,
        platform: Platform.OS === "ios" ? "ios" : "android",
        installId,
        name: Device.deviceName ?? undefined,
      }),
    });
    if (!res.ok) return { ok: false, reason: "request-failed" };
  } catch {
    return { ok: false, reason: "request-failed" };
  }

  // Same sign convention as JS's Date.prototype.getTimezoneOffset(), which
  // is exactly what this is — see the server's lib/notify.ts localHour().
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  await fetch(`${API_BASE_URL}/api/mobile/v1/push/prefs`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ installId, timezoneOffsetMinutes }),
  }).catch(() => {});

  return { ok: true };
}

export async function unregisterPushNotifications(token: string): Promise<void> {
  const installId = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (!installId) return;
  await fetch(`${API_BASE_URL}/api/mobile/v1/push/register`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ installId }),
  }).catch(() => {});
}
