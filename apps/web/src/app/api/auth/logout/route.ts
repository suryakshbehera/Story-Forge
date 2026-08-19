import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, destroySessionByToken, clearSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await destroySessionByToken(token);
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
