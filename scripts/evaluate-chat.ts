import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  failedEvaluationChecks,
  parseChatResponse,
  parseEvaluationQuestion,
  type EvaluationQuestion,
} from "./evaluation-contracts";

loadEnvConfig(process.cwd());

const endpoint = process.env.EVAL_CHAT_URL ?? "http://127.0.0.1:4001/api/chat";

async function postQuestion(item: EvaluationQuestion): Promise<Response> {
  const body = JSON.stringify({
    message: item.question,
    ...(item.history ? { history: item.history } : {}),
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status !== 429 || attempt === 2) return response;

    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? 1);
    const delayMs = Math.max(1, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1) * 1000;
    console.log(`Rate limited; retrying ${item.id} in ${Math.ceil(delayMs / 1000)}s.`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Chat evaluation exhausted request retries.");
}

async function main() {
  const records = (await readFile(path.resolve("evaluation/questions.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return parseEvaluationQuestion(JSON.parse(line) as unknown);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid record";
        throw new Error(`Invalid evaluation record on line ${index + 1}: ${detail}`);
      }
    });

  let passed = 0;
  for (const item of records) {
    try {
      const response = await postQuestion(item);
      const body: unknown = await response.json();
      if (!response.ok) {
        const errorMessage =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `HTTP ${response.status}`;
        console.log(`${item.id}: ERROR ${errorMessage}`);
        continue;
      }

      const payload = parseChatResponse(body);
      const failedChecks = failedEvaluationChecks(item, payload);
      const ok = failedChecks.length === 0;
      if (ok) passed += 1;
      console.log(`${item.id}: ${ok ? "PASS" : `REVIEW (${failedChecks.join(", ")})`}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      console.log(`${item.id}: ERROR ${detail}`);
    }
  }

  const ratio = records.length === 0 ? 0 : passed / records.length;
  console.log(`Smoke evaluation: ${passed}/${records.length} passed (${Math.round(ratio * 100)}%).`);
  console.log("This is an automated smoke check; a subject-matter reviewer must still verify factual support.");
  if (records.length === 0 || ratio < 0.85) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`Chat evaluation failed: ${detail}`);
  process.exitCode = 1;
});
