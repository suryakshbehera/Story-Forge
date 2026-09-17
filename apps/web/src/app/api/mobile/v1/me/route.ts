import { NextResponse } from "next/server";
import type { MeResponse } from "contract";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getTotalWaitingCount } from "@/lib/read/project-summaries";

// Not in proxy.ts's RESOLVERS — this route only ever returns the caller's
// OWN data (keyed by the trusted x-user-id header), so there's no
// per-project ownership check to make. See proxy.ts's "Routes intentionally
// NOT in RESOLVERS" comment block.
export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user, waiting] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: currentUser.id }, select: { id: true, email: true, role: true } }),
    getTotalWaitingCount(currentUser),
  ]);

  const response: MeResponse = {
    user,
    queue: { waiting },
    serverTime: new Date().toISOString(),
    // Bump this alongside a breaking mobile release; a client below this
    // should force an update prompt rather than keep calling /v1 with a
    // shape it no longer matches. No enforcement of it exists yet — that's
    // client-side work, not this endpoint's.
    minClientVersion: "1.0.0",
  };
  return NextResponse.json(response);
}
