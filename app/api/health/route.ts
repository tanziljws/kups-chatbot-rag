import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(
    process.env.LOCAL_LLM_BASE_URL &&
      process.env.LOCAL_LLM_MODEL &&
      process.env.EMBEDDING_MODEL &&
      process.env.KUPS_WEB_CATALOG_URL &&
      process.env.KUPS_WEB_API_KEY,
  );
  return NextResponse.json(
    {
      status: configured ? "configured" : "needs_configuration",
      memory: {
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
