import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { resolveAssetProjectId } from "@/lib/read/asset-ownership";

// Not in proxy.ts's RESOLVERS — :assetId isn't project-resolvable by the
// regex-based RESOLVERS table (the 13-FK problem storage reads already
// have), so ownership is checked here via resolveAssetProjectId instead.
// This is the BFF's first legitimate mutation: "Keep" has no web
// equivalent — see mobile-technical-plan-2026-09.md §5.1.
async function assertOwnedByCurrentUser(assetId: string): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 404 }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { ok: false, status: 401 };

  // Resolve the asset's project BEFORE the admin bypass, not after — a
  // nonexistent assetId must still 404, not fall through to an unguarded
  // prisma.asset.update() that throws P2025 (found live: this returned a
  // bare 500 for a bad id when the caller was an admin, since the bypass
  // short-circuited before the asset was ever confirmed to exist).
  const projectId = await resolveAssetProjectId(assetId);
  if (!projectId) return { ok: false, status: 404 };
  if (currentUser.role === "ADMIN") return { ok: true };

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
  if (!project || project.ownerId !== currentUser.id) return { ok: false, status: 403 };
  return { ok: true };
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const auth = await assertOwnedByCurrentUser(assetId);
  if (!auth.ok) return NextResponse.json({ error: "Not found" }, { status: auth.status });

  const keptAt = new Date();
  await prisma.asset.update({ where: { id: assetId }, data: { keptAt } });
  return NextResponse.json({ keptAt: keptAt.toISOString() });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const auth = await assertOwnedByCurrentUser(assetId);
  if (!auth.ok) return NextResponse.json({ error: "Not found" }, { status: auth.status });

  await prisma.asset.update({ where: { id: assetId }, data: { keptAt: null } });
  return NextResponse.json({ keptAt: null });
}
