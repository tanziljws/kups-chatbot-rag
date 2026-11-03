import { NextRequest, NextResponse } from "next/server";
import {
  isOperatorToken,
  listSessions,
  subscribeToQueue,
} from "@/lib/live-chat/store";
import { createSseResponse } from "@/lib/live-chat/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function token(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

export async function GET(request: NextRequest) {
  if (!isOperatorToken(token(request))) {
    return NextResponse.json(
      { error: "Akses konsultan ditolak." },
      { status: 401 },
    );
  }
  return NextResponse.json(listSessions(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (!isOperatorToken(token(request))) {
    return NextResponse.json(
      { error: "Akses konsultan ditolak." },
      { status: 401 },
    );
  }
  return createSseResponse(
    request,
    { type: "queue", sessions: listSessions() },
    (listener) => subscribeToQueue(listener),
  );
}
