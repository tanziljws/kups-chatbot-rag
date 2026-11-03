import { NextRequest, NextResponse } from "next/server";
import { answerQuestion, type ChatTurn } from "@/lib/chatbot/rag";
import { allowRequest } from "@/lib/chatbot/rate-limit";
import { getChatbotConfig } from "@/lib/chatbot/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: NextRequest) {
  const limit = allowRequest(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Terlalu banyak pertanyaan dalam waktu singkat. Coba lagi sebentar." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format pertanyaan tidak terbaca." }, { status: 400 });
  }

  const message =
    typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
      ? body.message.trim()
      : "";
  if (!message) {
    return NextResponse.json({ error: "Tulis pertanyaan sebelum mengirim." }, { status: 400 });
  }

  let maxChars = 1000;
  try {
    maxChars = getChatbotConfig().maxChars;
  } catch {
    // Keep the public request bound even while configuration is incomplete.
  }
  if (message.length > maxChars) {
    return NextResponse.json(
      { error: `Pertanyaan terlalu panjang. Batasnya ${maxChars} karakter.` },
      { status: 413 },
    );
  }

  const rawHistory =
    typeof body === "object" && body !== null && "history" in body && Array.isArray(body.history)
      ? body.history
      : [];
  const history = rawHistory
    .slice(-6)
    .flatMap((turn): ChatTurn[] => {
      if (typeof turn !== "object" || turn === null || !("role" in turn) || !("content" in turn)) return [];
      if ((turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return [];
      const content = turn.content.trim().slice(0, 1000);
      return content ? [{ role: turn.role, content }] : [];
    });

  try {
    const result = await answerQuestion(message, history);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "";
    const missingConfig = messageText.includes("belum dikonfigurasi");
    const status = missingConfig ? 503 : 502;
    return NextResponse.json(
      {
        error: missingConfig
          ? "Chat belum tersambung. Pengelola perlu menyiapkan konfigurasi katalog dan materi FAQ."
          : "Chat sedang tidak tersedia. Periksa materi FAQ dan koneksi katalog KUPS-Web, lalu coba lagi.",
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
