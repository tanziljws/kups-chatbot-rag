import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationContext,
  businessActivity,
  extractLocation,
  extractOwnership,
  extractScale,
  isKupsConversation,
  isPersonalEligibilityFollowup,
} from "./conversation-context";

test("classifies business activities as product or tourism", () => {
  assert.deepEqual(businessActivity("Saya mengolah madu"), { label: "madu", type: "product" });
  assert.deepEqual(businessActivity("Kami membuka homestay"), { label: "homestay", type: "tourism" });
  assert.equal(businessActivity("Saya bekerja di kantor"), undefined);
});

test("extracts scale, ownership, and location from informal descriptions", () => {
  assert.equal(extractScale("Usaha saya baru mulai"), "small");
  assert.equal(extractScale("produksi skala menengah"), "medium");
  assert.equal(extractScale("usaha skala besar"), "large");
  assert.equal(extractOwnership("dikelola keluarga"), "family");
  assert.equal(extractOwnership("saya mengelolanya sendiri"), "individual");
  assert.equal(extractOwnership("dikelola kelompok"), "group");
  assert.equal(extractLocation("Usaha saya berada di Kabupaten Garut, ada tiga anggota"), "Kabupaten Garut");
});

test("builds context from recent user turns without treating hypothetical groups as membership", () => {
  const context = buildConversationContext(
    [
      { role: "user", content: "Saya punya usaha madu kecil-kecilan dan belum punya kelompok KUPS." },
      { role: "assistant", content: "Coba hubungi pendamping setempat." },
      { role: "user", content: "Lokasi usaha di Kabupaten Garut dan dikelola keluarga." },
    ],
    "Kalau kelompoknya sudah ada, bagaimana?",
  );

  assert.deepEqual(context, {
    activity: { label: "madu", type: "product" },
    connection: "not_connected",
    scale: "small",
    ownership: "family",
    location: "Kabupaten Garut",
    talkingAboutFriend: false,
  });
});

test("detects KUPS conversation and personal eligibility follow-ups", () => {
  const history = [{ role: "user" as const, content: "Apa itu KUPS?" }];

  assert.equal(isKupsConversation(history), true);
  assert.equal(isPersonalEligibilityFollowup("Saya punya usaha, bisa ikut?", history), true);
  assert.equal(isPersonalEligibilityFollowup("Bagaimana cuaca hari ini?", history), false);
  assert.equal(isKupsConversation([{ role: "user", content: "Halo" }]), false);
});
