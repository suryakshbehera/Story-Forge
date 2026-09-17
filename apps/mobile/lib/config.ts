// EXPO_PUBLIC_-prefixed env vars are the standard Expo convention for
// values baked into the client bundle (see app.config docs) — no server
// secret lives here, just where to find the API. Falls back to the dev
// server's default port for local development; a real device/simulator
// needs the host machine's LAN IP here, not localhost — set
// EXPO_PUBLIC_API_URL in apps/mobile/.env for that. There's no device or
// simulator in the environment this was built in, so only the localhost
// fallback (the `expo start --web` target, same machine as the API) has
// actually been exercised — see docs/product/mobile-app-ux-plan-2026-09.md §0.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3002";
