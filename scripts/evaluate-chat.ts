import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type EvaluationQuestion = {
  id: string;
  question: string;
  expectedSource: string;
  mustInclude: string;
  expectClarification: boolean;
};

type ChatResponse = {
  answer?: string;
  sources?: Array<{ url: string }>;
  needsClarification?: boolean;
  error?: string;
};

const endpoint = process.env.EVAL_CHAT_URL ?? "http://127.0.0.1:4001/api/chat";
const records = (await readFile(path.resolve("evaluation/questions.jsonl"), "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as EvaluationQuestion);

let passed = 0;
for (const item of records) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: item.question }),
    });
    const payload = (await response.json()) as ChatResponse;
    if (!response.ok || !payload.answer) {
      console.log(`${item.id}: ERROR ${payload.error ?? `HTTP ${response.status}`}`);
      continue;
    }

    const answer = payload.answer.toLocaleLowerCase("id-ID");
    const hasSource = !item.expectedSource || payload.sources?.some((source) => source.url === item.expectedSource);
    const hasConcept = !item.mustInclude || answer.includes(item.mustInclude.toLocaleLowerCase("id-ID"));
    const clarificationMatches = Boolean(payload.needsClarification) === item.expectClarification;
    const ok = Boolean(hasSource && hasConcept && clarificationMatches);
    if (ok) passed += 1;
    console.log(`${item.id}: ${ok ? "PASS" : "REVIEW"}`);
  } catch {
    console.log(`${item.id}: ERROR unable to reach ${endpoint}`);
  }
}

const ratio = records.length === 0 ? 0 : passed / records.length;
console.log(`Smoke evaluation: ${passed}/${records.length} passed (${Math.round(ratio * 100)}%).`);
console.log("This is an automated smoke check; a subject-matter reviewer must still verify factual support.");
if (records.length === 0 || ratio < 0.85) process.exitCode = 1;
