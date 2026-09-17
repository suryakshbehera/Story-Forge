import { useNetInfo } from "@react-native-community/netinfo";

/**
 * `isInternetReachable` is `null` while NetInfo is still figuring it out
 * (briefly, at cold start) — treated as online rather than offline so the
 * app doesn't flash an offline state on every launch. `isConnected` alone
 * (Wi-Fi/cellular radio up) isn't enough: a phone can be connected to a
 * network with no actual internet (captive portal, dead Wi-Fi), which is
 * exactly the case mobile-app-ux-plan §5.5's offline queue exists for.
 */
export function useIsOnline(): boolean {
  const netInfo = useNetInfo();
  if (netInfo.isConnected === false) return false;
  if (netInfo.isInternetReachable === false) return false;
  return true;
}
