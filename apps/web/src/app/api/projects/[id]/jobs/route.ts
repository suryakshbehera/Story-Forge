import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProjectRunningJobs } from "@/lib/read/activity";

// Backs the header's job tray. The actual query now lives in
// lib/read/activity.ts, shared with the mobile BFF's GET
// /api/mobile/v1/activity — see mobile-technical-plan-2026-09.md §1.3 rule 3.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, type: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobs = await getProjectRunningJobs(project);
  return NextResponse.json({ jobs });
}
