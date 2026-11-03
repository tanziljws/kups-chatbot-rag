import { NextRequest, NextResponse } from "next/server";
import {
  addMessage,
  isOperatorToken,
  visitorOwnsSession,
} from "@/lib/live-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const operator = isOperatorToken(token);
  if (!operator && !visitorOwnsSession(sessionId, token)) {
    return NextResponse.json({ error: "Akses sesi ditolak." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Pesan tidak valid." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Pesan tidak valid." }, { status: 400 });
  }

  const text =
    typeof (body as Record<string, unknown>).text === "string"
      ? ((body as Record<string, unknown>).text as string).trim()
      : "";
  if (!text || text.length > 2000) {
    return NextResponse.json(
      { error: "Pesan wajib diisi dan maksimal 2.000 karakter." },
      { status: 400 },
    );
  }

  const message = addMessage(
    sessionId,
    operator ? "consultant" : "visitor",
    text,
  );
  if (!message) {
    return NextResponse.json(
      {
        error: "Sesi sudah ditutup atau belum dapat menerima pesan konsultan.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json(message, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}
