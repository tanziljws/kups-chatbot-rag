import { NextRequest, NextResponse } from "next/server";
import { getSession, visitorOwnsSession } from "@/lib/live-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Riwayat tidak valid." },
      { status: 400 },
    );
  }

  const records =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "sessions" in body &&
    Array.isArray(body.sessions)
      ? body.sessions.slice(0, 30)
      : [];
  const sessions = records.flatMap((record) => {
    if (
      !record ||
      typeof record !== "object" ||
      !("sessionId" in record) ||
      !("token" in record)
    )
      return [];
    if (
      typeof record.sessionId !== "string" ||
      typeof record.token !== "string"
    )
      return [];
    if (!visitorOwnsSession(record.sessionId, record.token)) return [];
    const session = getSession(record.sessionId);
    return session ? [session] : [];
  });

  return NextResponse.json(sessions, {
    headers: { "cache-control": "no-store" },
  });
}
