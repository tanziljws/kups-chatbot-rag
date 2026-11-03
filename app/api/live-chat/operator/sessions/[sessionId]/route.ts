import { NextRequest, NextResponse } from "next/server";
import {
  claimSession,
  closeSession,
  isOperatorToken,
} from "@/lib/live-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!isOperatorToken(token)) {
    return NextResponse.json(
      { error: "Akses konsultan ditolak." },
      { status: 401 },
    );
  }

  const { sessionId } = await params;
  const action = new URL(request.url).searchParams.get("action");
  let closeSummary = "";
  if (action === "close") {
    const body = (await request.json().catch(() => null)) as {
      summary?: unknown;
    } | null;
    closeSummary =
      typeof body?.summary === "string" ? body.summary.slice(0, 1200) : "";
  }
  const session =
    action === "claim"
      ? claimSession(sessionId)
      : action === "close"
        ? closeSession(sessionId, closeSummary)
        : null;
  if (!session) {
    return NextResponse.json(
      { error: "Sesi tidak tersedia atau statusnya sudah berubah." },
      { status: 409 },
    );
  }
  return NextResponse.json(session, {
    headers: { "cache-control": "no-store" },
  });
}
