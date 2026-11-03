import assert from "node:assert/strict";
import test from "node:test";
import { answerKupsDevelopmentFollowup } from "./kups-development-followup";

test("keeps a hypothetical group scenario separate from actual membership", async () => {
  const result = await answerKupsDevelopmentFollowup(
    "Kalau kelompoknya sudah ada, usaha madu bisa dikembangkan?",
    [{ role: "user", content: "Saya punya usaha madu dan belum punya kelompok KUPS." }],
  );

  assert.match(result.answer, /Jika kelompok Perhutanan Sosialnya sudah ada/i);
  assert.match(result.answer, /usaha madu/i);
  assert.match(result.answer, /belum otomatis/i);
  assert.equal(result.needsClarification, false);
  assert.equal(result.sources[0]?.sourceId, "permenlhk-9-2021-business");
});

test("guides a user without a group toward a KPS", async () => {
  const result = await answerKupsDevelopmentFollowup(
    "Bagaimana mengembangkan usaha madu?",
    [{ role: "user", content: "Saya jualan madu dan belum punya kelompok KUPS." }],
  );

  assert.match(result.answer, /mencari KPS/i);
  assert.match(result.answer, /usaha madu/i);
  assert.match(result.answer, /pendamping Perhutanan Sosial\/KPH/i);
  assert.equal(result.needsClarification, true);
});

test("uses group planning guidance when the user is already connected", async () => {
  const result = await answerKupsDevelopmentFollowup(
    "Bagaimana cara mengembangkan usaha kopi?",
    [{ role: "user", content: "Saya sudah bergabung dengan kelompok KPS." }],
  );

  assert.match(result.answer, /Pengembangan usaha kopi/i);
  assert.match(result.answer, /kegiatan usaha kelompok/i);
  assert.equal(result.needsClarification, false);
});

test("asks for clarification when group status is unknown", async () => {
  const result = await answerKupsDevelopmentFollowup("Bagaimana cara mengembangkan usaha?", []);

  assert.match(result.answer, /belum otomatis/i);
  assert.equal(result.needsClarification, true);
});
