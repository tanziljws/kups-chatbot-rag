import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/chatbot/rag";
import { allowRequest } from "@/lib/chatbot/rate-limit";
import { getChatbotConfig } from "@/lib/chatbot/config";
import { getSessionHistory, saveSessionHistory } from "@/lib/chatbot/session-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clientKey(request: NextRequest, sessionId?: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || (sessionId ? `session:${sessionId}` : "unknown");
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { status: "error", message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    return errorResponse("Pertanyaan terlalu panjang.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Pertanyaan tidak valid.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Pertanyaan tidak valid.", 400);
  }

  const data = body as Record<string, unknown>;
  const question = typeof data.question === "string" ? data.question.trim() : "";
  const sessionId = data.sessionId;
  if (!question || question.length > 2000 || (sessionId !== undefined && (typeof sessionId !== "string" || !UUID_V4.test(sessionId)))) {
    return errorResponse("Pertanyaan tidak valid.", 400);
  }

  const limit = allowRequest(clientKey(request, typeof sessionId === "string" ? sessionId : undefined));
  if (!limit.allowed) {
    return errorResponse("Terlalu banyak pertanyaan. Coba lagi sebentar.", 429);
  }

  let maxChars = 1000;
  try {
    maxChars = getChatbotConfig().maxChars;
  } catch {
    // Keep a request bound in place while the integration is unconfigured.
  }
  if (question.length > maxChars) {
    return errorResponse(`Pertanyaan terlalu panjang. Batasnya ${maxChars} karakter.`, 413);
  }

  try {
    const history = typeof sessionId === "string" ? getSessionHistory(sessionId) : [];
    const result = await answerQuestion(question, history);
    if (typeof sessionId === "string") {
      saveSessionHistory(sessionId, [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: result.answer },
      ]);
    }
    const citations = result.sources.map((source) => ({
      id: source.sourceId,
      sourceId: source.sourceId,
      title: source.title,
      filename: `${source.title} · diperiksa ${source.checkedAt}`,
      pageNumber: null,
      sectionTitle: null,
      sourceType: source.url.toLowerCase().endsWith(".pdf") ? "public_document" : "public_page",
      sourceUrl: source.url,
    }));

    return NextResponse.json(
      {
        status: "ok",
        answer: result.answer,
        citations,
        catalogItems: result.catalogItems,
        clarificationOptions: [],
        handoff: result.handoff ?? null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const missingConfig = detail.includes("belum dikonfigurasi");
    return errorResponse(
      missingConfig
        ? "Layanan asisten belum dikonfigurasi."
        : "Layanan asisten sedang tidak tersedia. Coba lagi sebentar.",
      missingConfig ? 503 : 502,
    );
  }
}
