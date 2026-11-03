import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Document } from "@langchain/core/documents";
import { LocalMiniLMEmbeddings } from "./embeddings";
import { getChatbotConfig } from "./config";

export type KnowledgeMetadata = Record<string, string | number | boolean | null>;

export type KnowledgeChunk = {
  id: string;
  text: string;
  metadata: KnowledgeMetadata;
  embedding: number[];
};

type KnowledgeIndex = {
  version: 1;
  model: string;
  dimensions: number;
  documents: KnowledgeChunk[];
};

export type KnowledgeMatch = {
  document: Document<KnowledgeMetadata>;
  score: number;
};

let indexPromise: Promise<KnowledgeIndex> | undefined;

const QUERY_STOP_WORDS = new Set([
  "apa", "itu", "sih", "tu", "tuh", "dong", "ya", "aku", "saya", "gue", "gw",
  "yang", "di", "ke", "dari", "untuk", "tentang", "ini", "aja", "saja", "kah",
  "kan", "ga", "gak", "gk", "nggak", "enggak", "dan", "atau", "dengan", "dalam",
  "sebagai", "mau", "bisa", "ada", "nih", "deh", "terus", "saya", "dong",
]);

const QUERY_SYNONYMS: Record<string, string[]> = {
  arti: ["definisi", "pengertian", "makna"],
  apaan: ["arti", "definisi", "pengertian"],
  definisi: ["arti", "pengertian", "makna"],
  pengertian: ["arti", "definisi", "makna"],
  makna: ["arti", "definisi", "pengertian"],
  beda: ["perbedaan", "bedanya"],
  bedanya: ["perbedaan", "beda"],
  syarat: ["persyaratan", "kriteria"],
  persyaratan: ["syarat", "kriteria"],
  daftar: ["pendaftaran", "mendaftar", "pembentukan"],
  pendaftaran: ["daftar", "mendaftar", "pembentukan"],
  gabung: ["bergabung", "pembentukan"],
  bergabung: ["gabung", "pembentukan"],
  manfaat: ["keuntungan", "dukungan", "fasilitasi"],
  keuntungan: ["manfaat", "dukungan", "fasilitasi"],
  kelas: ["klasifikasi"],
  klasifikasi: ["kelas"],
  pemasaran: ["promosi", "pasar"],
  promosi: ["pemasaran", "pasar"],
  wisata: ["destinasi"],
};

function tokens(text: string): string[] {
  return text.toLocaleLowerCase("id-ID").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function lexicalSimilarity(query: string, document: Document<KnowledgeMetadata>): number {
  const queryTokens = [...new Set(tokens(query).filter((token) => !QUERY_STOP_WORDS.has(token)))];
  if (queryTokens.length === 0) return 0;

  const documentText = [document.metadata.title, document.pageContent].filter(Boolean).join(" ");
  const documentTokens = new Set(tokens(documentText));
  const matchedConcepts = queryTokens.filter((token) =>
    [token, ...(QUERY_SYNONYMS[token] ?? [])].some((candidate) => documentTokens.has(candidate)),
  ).length;
  return matchedConcepts / queryTokens.length;
}

async function loadIndex(): Promise<KnowledgeIndex> {
  const config = getChatbotConfig();
  const filename = path.join(process.cwd(), ".cache", "kups-knowledge-index.json");
  indexPromise ??= readFile(filename, "utf8")
    .then((raw) => {
      const index = JSON.parse(raw) as KnowledgeIndex;
      if (
        index.version !== 1 ||
        index.model !== config.embeddingModel ||
        !Array.isArray(index.documents) ||
        index.documents.some((item) => !Array.isArray(item.embedding) || item.embedding.length !== index.dimensions)
      ) {
        throw new Error("Indeks knowledge lokal tidak cocok dengan konfigurasi encoder. Jalankan npm run ingest.");
      }
      return index;
    })
    .catch((error) => {
      indexPromise = undefined;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error("Indeks knowledge lokal belum dibuat. Jalankan npm run ingest.");
      }
      throw error;
    });
  return indexPromise;
}

function cosineSimilarity(left: number[], right: number[]): number {
  const width = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < width; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftNorm * rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

export async function searchKnowledge(query: string, topK: number, minScore: number): Promise<KnowledgeMatch[]> {
  const [index, queryEmbedding] = await Promise.all([
    loadIndex(),
    new LocalMiniLMEmbeddings().embedQuery(query),
  ]);
  if (queryEmbedding.length !== index.dimensions) {
    throw new Error("Dimensi encoder berubah. Jalankan npm run ingest untuk memperbarui indeks.");
  }

  const ranked = index.documents
    .map((chunk) => {
      const document = { pageContent: chunk.text, metadata: chunk.metadata };
      const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      const keywordScore = lexicalSimilarity(query, document);
      return {
        document,
        // Keep the requested encoder, while letting exact Indonesian terms and
        // common FAQ paraphrases correct its English-only semantic ranking.
        score: semanticScore * 0.7 + keywordScore * 0.3,
      };
    })
    .filter((match) => match.score >= minScore)
    .sort((left, right) => right.score - left.score);

  const seenSources = new Set<string>();
  return ranked.filter((match) => {
    const sourceId = String(match.document.metadata.sourceId ?? match.document.metadata.filename ?? match.document.pageContent);
    if (seenSources.has(sourceId)) return false;
    seenSources.add(sourceId);
    return true;
  }).slice(0, topK);
}
