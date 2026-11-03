import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  isOperatorToken,
  visitorOwnsSession,
} from "@/lib/live-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest, sessionId: string) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return isOperatorToken(token) || visitorOwnsSession(sessionId, token);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!authorized(request, sessionId)) {
    return NextResponse.json({ error: "Akses sesi ditolak." }, { status: 401 });
  }
  const session = getSession(sessionId);
  if (!session)
    return NextResponse.json(
      { error: "Sesi konsultasi tidak ditemukan." },
      { status: 404 },
    );
  return NextResponse.json(session, {
    headers: { "cache-control": "no-store" },
  });
}
