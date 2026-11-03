import { loadEnvConfig } from "@next/env";
import { getChatbotConfig } from "../src/lib/chatbot/config";
import { searchKnowledge } from "../src/lib/chatbot/vector-index";

loadEnvConfig(process.cwd());

const probes = [
  "Apa arti KUPS?",
  "Di mana saya bisa melihat data publik KUPS?",
  "Apa saja kelas KUPS?",
];

async function main() {
  const config = getChatbotConfig();
  for (const query of probes) {
    const matches = await searchKnowledge(query, config.topK, config.minScore);
    console.log(`\n${query}`);
    if (matches.length === 0) {
      console.log("Tidak ada chunk yang melewati ambang skor.");
      continue;
    }
    for (const { document, score } of matches) {
      console.log(`- ${score.toFixed(3)} · ${String(document.metadata.title)} (${String(document.metadata.sourceId)})`);
    }
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`Retrieval check failed: ${detail}`);
  process.exitCode = 1;
});
