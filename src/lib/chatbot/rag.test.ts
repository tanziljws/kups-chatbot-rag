import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, type ChatResult } from "./rag";

const REGULATION_URL =
  "https://jdih.kehutanan.go.id/new2/home/portfolioDetails3/2021pmlhk009_menlhk_06102021150537.pdf/9/2021/4/1067";

function assertHasRegulationSource(result: ChatResult) {
  assert.ok(result.sources.some((source) => source.url === REGULATION_URL));
}

test("answers a casual KUPS definition question with its official source", async () => {
  const result = await answerQuestion("KUPS itu apa sih?");

  assert.match(result.answer, /Kelompok Usaha Perhutanan Sosial/i);
  assertHasRegulationSource(result);
  assert.equal(result.needsClarification, false);
});

test("explains that KPS and KUPS are related but not the same", async () => {
  const result = await answerQuestion("KPS itu sama dengan KUPS?");

  assert.match(result.answer, /KPS adalah kelompok/i);
  assert.match(result.answer, /KUPS adalah kelompok usaha/i);
  assertHasRegulationSource(result);
  assert.equal(result.needsClarification, false);
});

test("explains that GoKUPS statistics can change", async () => {
  const result = await answerQuestion("Data statistik di GoKUPS selalu tetap atau berubah?");

  assert.match(result.answer, /dapat berubah/i);
  assert.ok(result.sources.some((source) => source.url === "https://gokups.hutsos.kehutanan.go.id/"));
  assert.equal(result.needsClarification, false);
});

test("recognizes the expanded KUPS name even with a common typo", async () => {
  const result = await answerQuestion("Apa itu kelompok usaha perhutanan sosil?");

  assert.match(result.answer, /KUPS adalah Kelompok Usaha Perhutanan Sosial/i);
  assert.match(result.answer, /dibentuk oleh KPS/i);
  assertHasRegulationSource(result);
});

test("routes questions about where to find public KUPS data to GoKUPS", async () => {
  const result = await answerQuestion("Portal apa untuk mencari data KUPS?");

  assert.match(result.answer, /portal GoKUPS/i);
  assert.ok(result.sources.some((source) => source.url === "https://gokups.hutsos.kehutanan.go.id/"));
});

test("routes a class-upgrade question to the class guidance instead of the KUPS definition", async () => {
  const result = await answerQuestion(
    "Kalau kelas KUPS kami Silver, nilai apa yang harus kami dapat supaya naik kelas?",
  );

  assert.match(result.answer, /bukan skor atau ambang kenaikan/i);
  assert.ok(result.sources.some((source) => source.url === "https://jdih.kehutanan.go.id/new2/uploads/files/PERMENHUT_18_2025.pdf"));
});

test("handles shorthand and common typo in a registration question", async () => {
  const result = await answerQuestion("Gmn syarat daftar KUPS?");

  assert.match(result.answer, /jalurnya melalui KPS/i);
  assert.match(result.answer, /KPH|pendamping/i);
  assertHasRegulationSource(result);
});

test("asks for context when the user requests help without saying what they need", async () => {
  const result = await answerQuestion("Bisa bantu kelompok kami?");

  assert.match(result.answer, /Bagian yang paling mendesak/i);
  assert.equal(result.needsClarification, true);
});

test("guides a small business owner who is not connected to a KPS", async () => {
  const result = await answerQuestion(
    "Gue jualan madu kecil-kecilan dan belum punya kelompok. Bisa jadi KUPS?",
  );

  assert.match(result.answer, /bukan pendaftaran usaha perorangan/i);
  assert.match(result.answer, /mencari KPS/i);
  assert.match(result.answer, /pendamping|KPH/i);
  assertHasRegulationSource(result);
});

test("uses the user's business and group context for an informal 'ikut KUPS' question", async () => {
  const result = await answerQuestion(
    "Gue jualan madu kecil-kecilan dan belum punya kelompok. Bisa ikut KUPS?",
  );

  assert.match(result.answer, /mencari KPS/i);
  assert.match(result.answer, /usaha kelompok/i);
  assertHasRegulationSource(result);
});

test("answers a short requirements follow-up using the previous registration topic", async () => {
  const result = await answerQuestion("Terus syaratnya apa?", [
    { role: "user", content: "Gimana cara daftar KUPS?" },
    {
      role: "assistant",
      content: "Untuk membentuk KUPS, jalurnya melalui KPS. Bahas rencana usaha bersama kelompok.",
    },
  ]);

  assert.match(result.answer, /tidak merinci satu daftar berkas universal/i);
  assert.match(result.answer, /KPS tujuan/i);
  assertHasRegulationSource(result);
});

test("routes a development follow-up before generic personal eligibility", async () => {
  const firstQuestion = "Aku jualan madu kecil-kecilan dan belum punya kelompok KUPS. Bisa ikut?";
  const firstResult = await answerQuestion(firstQuestion);
  const result = await answerQuestion("Terus, gimana cara mengembangkan usaha madu?", [
    { role: "user", content: firstQuestion },
    { role: "assistant", content: firstResult.answer },
  ]);

  assert.notEqual(result.answer, firstResult.answer);
  assert.match(result.answer, /catat dulu hasil produksi/i);
  assert.match(result.answer, /mekanisme bergabung/i);
  assert.match(result.answer, /KPS/i);
  assertHasRegulationSource(result);
});

test("keeps a hypothetical group follow-up separate from actual membership", async () => {
  const result = await answerQuestion("Kalau kelompoknya sudah ada, usaha madu bisa dikembangkan?", [
    { role: "user", content: "Saya punya usaha madu dan belum punya kelompok KUPS." },
    {
      role: "assistant",
      content: "Langkah awalnya mencari KPS yang relevan di wilayahmu.",
    },
  ]);

  assert.match(result.answer, /Jika kelompok Perhutanan Sosialnya sudah ada/i);
  assert.match(result.answer, /belum otomatis/i);
  assertHasRegulationSource(result);
});

test("explains the first step to form a KUPS in practical language", async () => {
  const result = await answerQuestion("Cara daftar KUPS gimana?");

  assert.match(result.answer, /jalurnya melalui KPS/i);
  assert.match(result.answer, /bahas potensi dan rencana usaha/i);
  assert.match(result.answer, /KPH|pendamping/i);
  assertHasRegulationSource(result);
});

test("does not promise financial support", async () => {
  const result = await answerQuestion("KUPS pasti dapat bantuan modal?");

  assert.match(result.answer, /tidak otomatis menjamin/i);
  assert.match(result.answer, /bergantung pada program dan persyaratan/i);
  assertHasRegulationSource(result);
});

test("asks for the user's preferred path instead of assuming what 'daftar' means", async () => {
  const result = await answerQuestion("Aku mau daftar");

  assert.match(result.answer, /bergabung dengan KUPS yang sudah ada/i);
  assert.match(result.answer, /pembentukan KUPS/i);
  assert.equal(result.needsClarification, true);
});
