function catalogUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("KUPS_WEB_CATALOG_URL harus berupa URL yang valid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("KUPS_WEB_CATALOG_URL harus menggunakan HTTP(S) tanpa kredensial URL.");
  }
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("KUPS_WEB_CATALOG_URL di luar localhost harus menggunakan HTTPS.");
  }
  return parsed.toString();
}

export function getChatbotConfig() {
  return {
    embeddingModel: process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",
    catalogUrl: catalogUrl(process.env.KUPS_WEB_CATALOG_URL),
    catalogApiKey: process.env.KUPS_WEB_API_KEY,
    topK: Math.max(1, Math.min(3, Number(process.env.RAG_TOP_K ?? 2))),
    minScore: Math.max(0, Math.min(1, Number(process.env.RAG_MIN_SCORE ?? 0.45))),
    maxChars: Math.max(100, Math.min(2000, Number(process.env.CHAT_MAX_CHARS ?? 1000))),
  };
}
