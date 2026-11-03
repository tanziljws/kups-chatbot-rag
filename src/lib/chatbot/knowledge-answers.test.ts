import assert from "node:assert/strict";
import test from "node:test";
import { formatRetrievedKnowledgeFallback } from "./knowledge-answers";
import type { ChatResult } from "./types";

const REGULATION_URL =
  "https://jdih.kehutanan.go.id/new2/home/portfolioDetails3/2021pmlhk009_menlhk_06102021150537.pdf/9/2021/4/1067";

function assertHasRegulationSource(result: ChatResult) {
  assert.ok(result.sources.some((source) => source.url === REGULATION_URL));
}

test("does not present a retrieved document excerpt as a complete answer", () => {
  const rawDocumentText =
    "Pasal 115 menyebut pembentukan KUPS dilakukan untuk mengembangkan usaha Perhutanan Sosial.";
  const result = formatRetrievedKnowledgeFallback("Apa ketentuan pembentukan kelompok?", [
    {
      document: {
        pageContent: rawDocumentText,
        metadata: {
          access: "public",
          title: "Aturan pembentukan KUPS",
          url: REGULATION_URL,
          checkedAt: "2026-11-03",
          sourceId: "permenlhk-9-2021",
        },
      },
      score: 0.62,
    },
  ]);

  assert.ok(!result.answer.includes(rawDocumentText));
  assert.match(result.answer, /belum cukup yakin/i);
  assert.match(result.answer, /langkah atau syarat/i);
  assert.equal(result.needsClarification, true);
  assertHasRegulationSource(result);
});

test("does not cite or summarize a retrieved item without public source metadata", () => {
  const result = formatRetrievedKnowledgeFallback("Jelaskan ini", [
    {
      document: {
        pageContent: "Konten yang tidak punya sumber publik terverifikasi.",
        metadata: {},
      },
      score: 0.9,
    },
  ]);

  assert.equal(result.sources.length, 0);
  assert.equal(result.needsClarification, true);
  assert.match(result.answer, /belum menemukan sumber publik yang cukup/i);
});
