import { NextRequest, NextResponse } from "next/server";
import { findExpert } from "@/lib/live-chat/directory";
import { createSession } from "@/lib/live-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Data sesi tidak valid." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Data sesi tidak valid." },
      { status: 400 },
    );
  }
  const {
    visitorName,
    topic,
    groupName,
    area,
    summary,
    serviceType,
    expertId,
    preferredAt,
  } = body as Record<string, unknown>;
  const name =
    typeof visitorName === "string" ? visitorName.trim().slice(0, 80) : "";
  const consultationTopic =
    typeof topic === "string" ? topic.trim().slice(0, 120) : "";
  const group =
    typeof groupName === "string" ? groupName.trim().slice(0, 100) : "";
  const location = typeof area === "string" ? area.trim().slice(0, 100) : "";
  const caseSummary =
    typeof summary === "string" ? summary.trim().slice(0, 1200) : "";
  const type =
    serviceType === "expert" || serviceType === "mentor" ? serviceType : null;
  const expert =
    type === "expert" && typeof expertId === "string"
      ? findExpert(expertId)
      : undefined;
  const requestedTime =
    typeof preferredAt === "string" ? preferredAt.trim() : "";
  const requestedTimeMs = requestedTime ? Date.parse(requestedTime) : NaN;
  const invalidRequestedTime =
    requestedTime &&
    (!Number.isFinite(requestedTimeMs) ||
      requestedTimeMs < Date.now() ||
      requestedTimeMs > Date.now() + 365 * 24 * 60 * 60 * 1000);
  if (
    !name ||
    !consultationTopic ||
    caseSummary.length < 10 ||
    !type ||
    (type === "expert" && !expert) ||
    invalidRequestedTime
  ) {
    return NextResponse.json(
      {
        error:
          "Detail konsultasi tidak valid. Periksa topik, ahli, dan waktu pilihanmu.",
      },
      { status: 400 },
    );
  }

  const result = createSession(name, consultationTopic, {
    groupName: group || undefined,
    area: location || undefined,
    summary: caseSummary,
    serviceType: type,
    expertId: expert?.id,
    expertName: expert?.title ?? "Pendamping KUPS",
    preferredAt: requestedTime
      ? new Date(requestedTimeMs).toISOString()
      : undefined,
  });
  if (!result) {
    return NextResponse.json(
      { error: "Antrean konsultasi sedang penuh. Coba lagi beberapa saat." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { session: result.session, token: result.visitorToken },
    {
      headers: { "cache-control": "no-store" },
      status: 201,
    },
  );
}
