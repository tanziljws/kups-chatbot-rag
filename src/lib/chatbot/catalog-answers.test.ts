import assert from "node:assert/strict";
import test from "node:test";
import {
  publicDataAnswer,
  sourcesFromPublicItems,
} from "./catalog-answers";
import type { PublicCatalogItem } from "./catalog";

const RETRIEVED_AT = "2026-11-03T00:00:00.000Z";

function product(overrides: Partial<PublicCatalogItem> = {}): PublicCatalogItem {
  return {
    type: "product",
    recordId: "product-1",
    title: "Madu Hutan",
    description: "Madu hutan dari kelompok",
    category: "Madu",
    kupsName: "KUPS Rimba",
    location: "Kabupaten X",
    availability: null,
    unit: "botol",
    imageUrl: null,
    sourceUrl: "https://example.test/products/product-1",
    ...overrides,
  };
}

test("formats a product purchase result without promising availability", () => {
  const answer = publicDataAnswer(
    { type: "product", query: "madu" },
    [product()],
    RETRIEVED_AT,
    undefined,
    "Saya mau beli madu",
  );

  assert.match(answer, /Madu Hutan/);
  assert.match(answer, /periksa petunjuk pemesanan atau kontak publik/i);
  assert.match(answer, /bukan memproses transaksi/i);
});

test("warns that demonstration listings may not be available for purchase", () => {
  const answer = publicDataAnswer(
    { type: "product", query: "madu" },
    [product({ description: "Contoh demonstrasi produk" })],
    RETRIEVED_AT,
    undefined,
    "Saya mau beli madu",
  );

  assert.match(answer, /data demonstrasi/i);
  assert.match(answer, /belum tentu tersedia untuk dibeli/i);
});

test("distinguishes a count of search results from an official total", () => {
  const answer = publicDataAnswer(
    { type: "product", query: "madu" },
    [product()],
    RETRIEVED_AT,
    undefined,
    "Ada berapa?",
  );

  assert.match(answer, /1 produk/);
  assert.match(answer, /bukan statistik resmi seluruh wilayah/i);
});

test("qualifies public statistics when the user asks for active profiles", () => {
  const answer = publicDataAnswer(
    { type: "stats", query: "" },
    [],
    RETRIEVED_AT,
    { kups: 10, products: 20, destinations: 3, provinces: 4 },
    "Berapa profil KUPS aktif?",
  );

  assert.match(answer, /10 profil KUPS/);
  assert.match(answer, /tidak memisahkan status aktif/i);
});

test("creates traceable public sources from catalog items", () => {
  const [source] = sourcesFromPublicItems([product()], RETRIEVED_AT);

  assert.equal(source.sourceId, "kups-web-product-product-1");
  assert.equal(source.title, "Madu Hutan");
  assert.equal(source.url, "https://example.test/products/product-1");
  assert.equal(source.authority, "KUPS-Web");
  assert.ok(source.checkedAt.length > 0);
});
