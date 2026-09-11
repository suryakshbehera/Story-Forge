import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createDemoProject } from "@/lib/demo-project";

export async function POST() {
  const user = await getCurrentUser();
  const project = await createDemoProject(user!.id);
  return NextResponse.json(project, { status: 201 });
}
