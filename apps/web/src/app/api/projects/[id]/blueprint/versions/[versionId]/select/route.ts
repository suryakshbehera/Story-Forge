import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { selectVersion } from "@/lib/versioning";
import { getOrCreateBlueprint, NotSeriesProjectError } from "@/lib/blueprint";

interface VersionPayload {
  content: string;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: projectId, versionId } = await params;

  let blueprint;
  try {
    blueprint = await getOrCreateBlueprint(projectId);
  } catch (error) {
    if (error instanceof NotSeriesProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const version = await selectVersion("SERIES_BLUEPRINT", blueprint.id, versionId);
  const payload = version.payload as unknown as VersionPayload;

  const updated = await prisma.seriesBlueprint.update({
    where: { projectId },
    data: { content: payload.content },
  });

  return NextResponse.json({ blueprint: updated, version });
}
