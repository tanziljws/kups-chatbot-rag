import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  isOperatorToken,
  subscribeToSession,
  visitorOwnsSession,
} from "@/lib/live-chat/store";
import { createSseResponse } from "@/lib/live-chat/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!isOperatorToken(token) && !visitorOwnsSession(sessionId, token)) {
    return NextResponse.json({ error: "Akses sesi ditolak." }, { status: 401 });
  }

  const session = getSession(sessionId);
  if (!session)
    return NextResponse.json(
      { error: "Sesi konsultasi tidak ditemukan." },
      { status: 404 },
    );

  return createSseResponse(
    request,
    { type: "snapshot", session },
    (listener) => subscribeToSession(sessionId, listener),
    (event) =>
      Boolean(
        event &&
        typeof event === "object" &&
        "session" in event &&
        event.session &&
        typeof event.session === "object" &&
        "status" in event.session &&
        event.session.status === "closed",
      ),
  );
}
