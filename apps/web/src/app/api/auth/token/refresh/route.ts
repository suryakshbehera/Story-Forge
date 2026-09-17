import { NextRequest, NextResponse } from "next/server";
import type { TokenRefreshResponse } from "contract";
import { extractToken, createSession, destroySessionByToken, getCurrentUser } from "@/lib/auth";

// Rotates the caller's session: a new Session row is created and the old
// one is destroyed. Reaches here only once proxy.ts has already validated
// the incoming token (this route isn't in PUBLIC_PATHS), so the trusted
// x-user-id header is available — no extra session lookup needed for the
// user id. The raw old token still has to be re-read from the request
// itself (proxy only forwards the resolved user, not the raw token) so it
// can be destroyed by value.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const oldToken = extractToken(req);
  if (!user || !oldToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);
  await destroySessionByToken(oldToken);

  const response: TokenRefreshResponse = { token, expiresAt: expiresAt.toISOString() };
  return NextResponse.json(response);
}
