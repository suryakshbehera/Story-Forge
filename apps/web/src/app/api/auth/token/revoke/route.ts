import { NextRequest, NextResponse } from "next/server";
import { extractToken, destroySessionByToken } from "@/lib/auth";

// Destroys the caller's own session. A distinct path from a DELETE on
// /api/auth/token rather than a method on the same route: PUBLIC_PATHS is
// matched by exact pathname and is method-agnostic, so a DELETE on the
// public login path would itself be public — a separate path keeps this
// behind the normal auth gate.
//
// Does NOT yet deregister a PushDevice row (the plan's stated behaviour once
// push exists) — device/push-token registration is POST
// /api/mobile/v1/push/register, not built yet. When it lands, this should
// accept an optional { installId } and delete that device's row too.
export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await destroySessionByToken(token);
  return NextResponse.json({ ok: true });
}
