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

  return index.documents
    .map((chunk) => ({
      document: { pageContent: chunk.text, metadata: chunk.metadata },
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((match) => match.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
