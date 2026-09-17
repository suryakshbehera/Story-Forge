import { useEffect } from "react";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";

/**
 * Maps a server-minted deep link (lib/notify.ts on web, web-shaped paths
 * like "/activity?project=X") onto this app's actual Expo Router routes.
 * "/renders" has no screen yet (M3.1, not built) — falls back to Projects,
 * the closest existing thing, rather than a dead route. Revisit once M3
 * ships a real Renders screen.
 */
function routeForDeepLink(deepLink: string): string {
  const [path, query] = deepLink.split("?");
  const suffix = query ? `?${query}` : "";
  if (path === "/activity") return `/activity${suffix}`;
  if (path === "/") return `/${suffix}`;
  return `/projects${suffix}`;
}

function handleResponse(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as { deepLink?: unknown } | undefined;
  if (typeof data?.deepLink === "string") {
    // router.push needs a statically-known route for typedRoutes; this path
    // is built from server data at runtime, which typedRoutes can't verify.
    router.push(routeForDeepLink(data.deepLink) as Parameters<typeof router.push>[0]);
  }
}

/** Wires notification taps (foreground/background AND cold start) to in-app navigation. Call once, near the app root. */
export function useNotificationDeepLinks() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    // Cold start: the app may have been launched BY tapping a notification,
    // which the listener above never fires for (there was no running JS to
    // receive the event yet).
    Notifications.getLastNotificationResponseAsync().then(handleResponse);
    return () => subscription.remove();
  }, []);
}
