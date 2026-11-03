import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { LocalMiniLMEmbeddings } from "../src/lib/chatbot/embeddings";

loadEnvConfig(process.cwd());

type PublicSource = {
  title: string;
  url: string;
  authority: string;
  checkedAt: string;
  access: "public";
  sourceId: string;
};

type IndexedChunk = {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean | null>;
  embedding: number[];
};

const approvedDirectory = path.resolve("knowledge/approved");
const indexPath = path.resolve(".cache/kups-knowledge-index.json");
const modelName = process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";

function parseMarkdownDocument(raw: string, filename: string) {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${filename}: missing YAML front matter.`);

  const metadata = Object.fromEntries(
    match[1].split(/\r?\n/).flatMap((line) => {
      const splitAt = line.indexOf(":");
      if (splitAt < 1) return [];
      return [[line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()]];
    }),
  ) as Record<string, string>;

  const source = {
    title: metadata.title ?? "",
    url: metadata.url ?? "",
    authority: metadata.authority ?? "",
    checkedAt: metadata.checkedAt ?? "",
    access: metadata.access as PublicSource["access"],
    sourceId: metadata.sourceId ?? "",
  } satisfies PublicSource;

  if (!source.title || !source.authority || !source.sourceId) {
    throw new Error(`${filename}: title, authority, and sourceId are required.`);
  }
  if (source.access !== "public") throw new Error(`${filename}: only access: public can be indexed.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt) || Number.isNaN(Date.parse(source.checkedAt))) {
    throw new Error(`${filename}: checkedAt must be an ISO date (YYYY-MM-DD).`);
  }
  const parsedUrl = new URL(source.url);
  if (parsedUrl.protocol !== "https:") throw new Error(`${filename}: source URL must use HTTPS.`);

  return { source, body: match[2].trim() };
}

async function main() {
  const names = (await readdir(approvedDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) throw new Error("No approved Markdown documents found.");

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 900, chunkOverlap: 120 });
  const chunks: Omit<IndexedChunk, "embedding">[] = [];
  for (const filename of names) {
    const parsed = parseMarkdownDocument(await readFile(path.join(approvedDirectory, filename), "utf8"), filename);
    const splitDocuments = await splitter.createDocuments([parsed.body], [{ ...parsed.source, filename }]);
    splitDocuments.forEach((document, index) => {
      chunks.push({
        id: createHash("sha256").update(`${parsed.source.sourceId}:${index}:${document.pageContent}`).digest("hex"),
        text: document.pageContent,
        metadata: document.metadata as Record<string, string | number | boolean | null>,
      });
    });
    console.log(`Prepared ${splitDocuments.length} public chunks from ${filename}.`);
  }

  const embeddings = new LocalMiniLMEmbeddings();
  const indexed: IndexedChunk[] = [];
  for (let start = 0; start < chunks.length; start += 16) {
    const batch = chunks.slice(start, start + 16);
    const vectors = await embeddings.embedDocuments(batch.map((chunk) => chunk.text));
    batch.forEach((chunk, index) => indexed.push({ ...chunk, embedding: vectors[index] }));
    console.log(`Embedded ${Math.min(start + batch.length, chunks.length)} of ${chunks.length} chunks.`);
  }

  const dimensions = indexed[0]?.embedding.length ?? 0;
  if (dimensions !== 384 || indexed.some((chunk) => chunk.embedding.length !== dimensions)) {
    throw new Error(`Expected 384-dimensional all-MiniLM-L6-v2 vectors; received ${dimensions}.`);
  }

  await mkdir(path.dirname(indexPath), { recursive: true });
  const temporaryPath = `${indexPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ version: 1, model: modelName, dimensions, documents: indexed })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, indexPath);
  console.log(`Done. ${indexed.length} public chunks indexed locally at ${path.relative(process.cwd(), indexPath)}.`);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`Knowledge ingestion failed: ${detail}`);
  process.exitCode = 1;
});
