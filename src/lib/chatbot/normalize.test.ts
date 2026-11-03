import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuestion } from "./normalize";

test("trims and normalizes repeated whitespace while preserving the raw question", () => {
  assert.deepEqual(normalizeQuestion("  Apa   itu KUPS?  "), {
    original: "Apa   itu KUPS?",
    normalized: "Apa itu KUPS?",
  });
});

test("normalizes an unambiguous English spelling variant", () => {
  assert.equal(
    normalizeQuestion("Bagaimana perhutanan social bisa membantu KUPS?").normalized,
    "Bagaimana Perhutanan Sosial bisa membantu KUPS?",
  );
});

test("preserves unknown terms and punctuation", () => {
  assert.equal(
    normalizeQuestion("Apakah skema HD/KHDPK cocok untuk kami?").normalized,
    "Apakah skema HD/KHDPK cocok untuk kami?",
  );
});

test("removes control characters but keeps the readable question", () => {
  assert.equal(normalizeQuestion("Apa\u0000 itu KUPS?\n" ).normalized, "Apa itu KUPS?");
});

test("does not replace KPS when it appears as part of a longer word", () => {
  assert.equal(normalizeQuestion("profil KPS kami").normalized, "profil KPS kami");
});
