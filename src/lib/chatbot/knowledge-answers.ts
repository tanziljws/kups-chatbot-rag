import { readFile } from "node:fs/promises";
import path from "node:path";
import { getChatbotConfig } from "./config";
import {
  searchKnowledge,
  type KnowledgeMatch,
  type KnowledgeMetadata,
} from "./vector-index";
import type {
  ChatResult,
  ChatSource,
  ChatTurn,
} from "./types";

type ApprovedSourceId =
  | "permenlhk-9-2021"
  | "permenlhk-9-2021-business"
  | "permenhut-18-2025"
  | "gokups-home";

const APPROVED_SOURCE_FILES: Record<ApprovedSourceId, string> = {
  "permenlhk-9-2021": "kups-definition.md",
  "permenlhk-9-2021-business": "kups-business-path.md",
  "permenhut-18-2025": "kups-class-overview.md",
  "gokups-home": "gokups-overview.md",
};

const approvedSourceCache = new Map<string, Promise<ChatSource | undefined>>();

function sourceFromMetadata(metadata: KnowledgeMetadata): ChatSource | undefined {
  if (metadata.access !== "public") return undefined;

  const title = typeof metadata.title === "string" ? metadata.title : "";
  const url = typeof metadata.url === "string" ? metadata.url : "";
  const checkedAt = typeof metadata.checkedAt === "string" ? metadata.checkedAt : "";
  const sourceId = typeof metadata.sourceId === "string" ? metadata.sourceId : "";
  if (!title || !url || !checkedAt || !sourceId) return undefined;

  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return undefined;
  } catch {
    return undefined;
  }

  return {
    sourceId,
    filename: typeof metadata.filename === "string" ? metadata.filename : undefined,
    title,
    url,
    checkedAt,
    authority: typeof metadata.authority === "string" ? metadata.authority : undefined,
  };
}

export function getApprovedSource(sourceId: ApprovedSourceId): Promise<ChatSource | undefined> {
  const cached = approvedSourceCache.get(sourceId);
  if (cached) return cached;

  const filename = APPROVED_SOURCE_FILES[sourceId];
  const pending = readFile(path.join(process.cwd(), "knowledge", "approved", filename), "utf8")
    .then((content) => {
      const frontMatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      if (!frontMatter) return undefined;

      const metadata: KnowledgeMetadata = Object.fromEntries(
        frontMatter.split(/\r?\n/).flatMap((line) => {
          const separator = line.indexOf(":");
          return separator > 0
            ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]]
            : [];
        }),
      );
      metadata.access = "public";
      return sourceFromMetadata(metadata);
    })
    .catch(() => undefined);

  approvedSourceCache.set(sourceId, pending);
  return pending;
}

export async function answerFromApprovedFaq(
  _question: string,
  sourceId: ApprovedSourceId,
  answer: string,
  needsClarification = false,
): Promise<ChatResult> {
  const source = await getApprovedSource(sourceId);
  if (!source) {
    return {
      answer: "Aku belum bisa memuat rujukan resmi yang diperlukan saat ini. Coba lagi nanti atau tanyakan ke pendamping/KPH setempat.",
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }
  return { answer, sources: [source], catalogItems: [], needsClarification };
}

export function clarificationAnswer(question: string): string {
  const excerpt = question.replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
  return `Aku belum menemukan sumber publik yang cukup untuk menjawab “${excerpt}”. Kamu sedang mencari aturan/istilah KUPS, profil atau penawaran di situs, publikasi, atau ingin membahas rencana usaha? Ceritakan sedikit konteksnya, ya.`;
}

export function formatRetrievedKnowledgeFallback(
  original: string,
  matches: KnowledgeMatch[],
): ChatResult {
  const sources = matches.flatMap(({ document }) => {
    const source = sourceFromMetadata(document.metadata);
    return source ? [source] : [];
  });

  if (sources.length === 0) {
    return {
      answer: clarificationAnswer(original),
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }

  return {
    answer: "Aku menemukan rujukan publik yang mungkin berkaitan, tetapi belum cukup yakin untuk memberi jawaban yang tepat. Biar aku nggak salah arah, kamu ingin tahu tentang definisi, langkah atau syarat, manfaat atau dukungan, kelas atau status, atau data dan profil KUPS? Ceritakan bagian yang kamu maksud, ya. [S1]",
    sources: [sources[0]],
    catalogItems: [],
    needsClarification: true,
  };
}

export async function answerFromKnowledge(
  original: string,
  normalized: string,
  history: ChatTurn[],
): Promise<ChatResult> {
  const config = getChatbotConfig();
  const priorUserText = history
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => turn.content);
  const retrievalQuestion = [...priorUserText, normalized].join(" ");
  const matches = await searchKnowledge(retrievalQuestion, config.topK, config.minScore);
  return formatRetrievedKnowledgeFallback(original, matches);
}
