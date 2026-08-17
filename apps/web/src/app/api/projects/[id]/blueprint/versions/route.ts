import { NextRequest, NextResponse } from "next/server";
import { listVersions } from "@/lib/versioning";
import { getOrCreateBlueprint, NotSeriesProjectError } from "@/lib/blueprint";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  let blueprint;
  try {
    blueprint = await getOrCreateBlueprint(projectId);
  } catch (error) {
    if (error instanceof NotSeriesProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const versions = await listVersions("SERIES_BLUEPRINT", blueprint.id);
  return NextResponse.json(versions);
}
