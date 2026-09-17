import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReviewQueue } from "@/lib/read/review-queue";

// Not in proxy.ts's RESOLVERS — projectId (when given) is a query param,
// and getReviewQueue already scopes every query to ownedProjectsWhere(user)
// ANDed with that id, so an unowned projectId yields nothing rather than
// leaking anything — same reasoning as GET /api/mobile/v1/activity.
export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const projectId = params.get("projectId") ?? undefined;
  const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
  const offset = params.has("offset") ? Number(params.get("offset")) : undefined;

  const queue = await getReviewQueue(currentUser, {
    projectId,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  });
  return NextResponse.json(queue);
}
