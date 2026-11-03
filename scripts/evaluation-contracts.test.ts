import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  failedEvaluationChecks,
  parseChatResponse,
  parseEvaluationQuestion,
} from "./evaluation-contracts";

test("validates evaluation record structure and conversation history", () => {
  assert.throws(() => parseEvaluationQuestion({ id: "bad" }), /missing a required field/i);
  assert.throws(
    () =>
      parseEvaluationQuestion({
        id: "bad-history",
        question: "Test?",
        expectedSource: "",
        mustInclude: "",
        expectClarification: false,
        history: [{ role: "system", content: "invalid" }],
      }),
    /invalid history/i,
  );
});

test("keeps every checked-in JSONL case valid", async () => {
  const contents = await readFile(path.resolve("evaluation/questions.jsonl"), "utf8");
  const records = contents
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseEvaluationQuestion(JSON.parse(line) as unknown));

  assert.ok(records.length >= 20);
});

test("validates the response contract rather than assuming optional fields exist", () => {
  assert.throws(() => parseChatResponse({ answer: "Hai" }), /expected API contract/i);
  assert.deepEqual(
    parseChatResponse({
      answer: "Jawaban",
      sources: [],
      catalogItems: [],
      needsClarification: false,
      handoff: null,
    }),
    {
      answer: "Jawaban",
      sources: [],
      catalogItems: [],
      needsClarification: false,
      handoff: null,
    },
  );
});

test("checks exact source identity, abstention, and forbidden guarantees", () => {
  const item = parseEvaluationQuestion({
    id: "unsupported",
    question: "Bantuan pasti?",
    expectedSource: "",
    expectedSourceId: "",
    mustInclude: "bergantung",
    mustNotInclude: ["pasti mendapatkan bantuan"],
    expectClarification: true,
    expectNoSources: true,
    expectedResponseKind: "clarification",
  });
  const payload = parseChatResponse({
    answer: "Bantuan bergantung pada program; tidak ada kepastian bahwa kelompok mendapatkan bantuan.",
    sources: [],
    catalogItems: [],
    needsClarification: true,
    handoff: null,
  });
  assert.deepEqual(failedEvaluationChecks(item, payload), []);
});

test("requires catalog results to preserve type and item provenance", () => {
  const item = parseEvaluationQuestion({
    id: "catalog",
    question: "Cari produk",
    expectedSource: "",
    mustInclude: "",
    expectClarification: false,
    expectedCatalogType: "product",
    expectedResponseKind: "catalog",
  });
  const payload = parseChatResponse({
    answer: "Produk ditemukan.",
    sources: [],
    catalogItems: [{ type: "product", sourceUrl: "https://example.test/items/123" }],
    needsClarification: false,
  });
  assert.deepEqual(failedEvaluationChecks(item, payload), []);
  const missingProvenance = parseChatResponse({
    answer: "Produk ditemukan.",
    sources: [],
    catalogItems: [{ type: "product", sourceUrl: "" }],
    needsClarification: false,
  });
  assert.deepEqual(failedEvaluationChecks(item, missingProvenance), ["catalog type/provenance"]);
});
