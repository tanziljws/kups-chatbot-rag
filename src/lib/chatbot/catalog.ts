import { getChatbotConfig } from "./config";

export type PublicCatalogItem = {
  type: "product" | "tourism" | "kups" | "publication";
  recordId: string;
  title: string;
  description: string;
  category: string | null;
  kupsName: string;
  location: string | null;
  availability: string | null;
  unit: string | null;
  imageUrl: string | null;
  sourceUrl: string;
};

export type CatalogIntent = { type: "product" | "tourism" | "both" | "kups" | "publication" | "stats"; query: string };
export type PublicWebsiteStats = { kups: number; products: number; destinations: number; provinces: number };

const PRODUCT_TERMS = /\b(product|products|produk|produk-produk|barang|komoditas|madu|kopi|duren|durian|kerajinan|hasil\s+usaha|oleh[- ]?oleh|dijual|jual)\b/i;
const TOURISM_TERMS = /\b(wisata|destinasi|ekowisata|homestay|penginapan|kunjungan|tiket)\b/i;
const PUBLICATION_TERMS = /\b(publikasi|ebook|e-book|buku|bacaan|modul|unduhan|unduh|download)\b/i;
const KUPS_TERMS = /\bkups\b/i;
const KUPS_LIST_QUESTION = /\b(?:ada|cari|lihat|tampilkan|sebutkan)\b.{0,35}\bkups\b.{0,35}\b(?:apa\s+(?:aja|saja)|mana\s+(?:aja|saja))\b|\b(?:apa|mana)\s+(?:aja|saja)\b.{0,30}\bkups\b|\bkups\b.{0,30}\b(?:apa|mana)\s+(?:aja|saja)\b/i;
const KUPS_BENEFIT_QUESTION = /\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?)\b.{0,90}\b(?:kups|daftar|jadi|bergabung|anggota)\b|\b(?:kups|anggota\s+kups)\b.{0,70}\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?)\b/i;
const KUPS_REGISTRATION_GUIDE = /\b(?:gimana|bagaimana|cara|langkah|prosedur|persyaratan|syarat)\b.{0,90}\b(?:daftar|mendaftar|pendaftaran|bergabung|gabung|jadi)\b.{0,35}\bkups\b/i;
const KUPS_KNOWLEDGE_QUESTION = /\bkups\b.{0,45}\b(?:apa|apaan|itu|tu|tuh|arti|pengertian|definisi|kelas|syarat|manfaat|keuntungan|cara|prosedur|bagaimana|gimana)\b/i;
const KUPS_DIRECTORY_ACTION = /\b(profil|profile|direktori|daftar|data|lokasi|alamat|wilayah|terdaftar|cari|mana\s+aja|mana\s+saja|dimana|di\s+mana|sebaran)\b/i;
const KUPS_FACT_QUESTION = /\b(?:apa|apaan|itu|tu|tuh|kelas|status|arti|pengertian|definisi|syarat|manfaat|keuntungan|masuk|layak|bisa|aturan|dibentuk|siapa|kapan|berapa|sejarah)\b/i;
const STAT_TERMS = /\b(berapa|jumlah|total|statistik)\b/i;
const STAT_ENTITY_TERMS = /\b(kups|kelompok|produk|product|wisata|destinasi|provinsi)\b/i;
const EXPLANATION_TERMS = /\b(manfaat|khasiat|kandungan|pengertian|definisi|arti|cara\s+(?:membuat|mengolah|memulai)|resep|tips)\b/i;
const SEARCH_ACTIONS = /\b(cari|carikan|tampilkan|lihat|cek|katalog|tersedia|daftar|mana|mana\s+aja|mana\s+saja|apa\s+aja|apa\s+saja|rekomendasikan|rekomendasi)\b/i;
const SEARCH_FILLER = /\b(tolong|coba|carikan|cari|tampilkan|lihat|rekomendasikan|rekomendasi|apa|saja|aja|ada|yang|di|dari|mana|dimana|kups|kelompok|saya|aku|gue|gw|mau|ingin|pengen|tahu|tau|dong|deh|sih|nih|nanya|tanya|info|informasi|untuk|apakah|website|publik|product|products|produk|produk-produk|barang|komoditas|hasil\s+usaha|katalog|profil|profile|direktori|data|lokasi|alamat|wilayah|terdaftar|sebaran|tentang|mengenai|topik|terkait|soal|saat\s+ini|sekarang|today|please|the|available|currently|ga|gak|gk|ngga|nggak|engga|enggak|kah|ya)\b/gi;

export function cleanCatalogQuery(question: string): string {
  const cleaned = question
    .replace(SEARCH_FILLER, " ")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set(cleaned.split(/\s+/).filter(Boolean))].join(" ").slice(0, 120);
}

export function detectCatalogIntent(question: string): CatalogIntent | undefined {
  const normalized = question.trim();
  if (KUPS_LIST_QUESTION.test(normalized)) {
    return { type: "kups", query: cleanCatalogQuery(normalized) };
  }
  // A user asking about the benefits or process of joining KUPS is asking for
  // guidance, not asking us to search the KUPS directory for a record.
  if (KUPS_BENEFIT_QUESTION.test(normalized) || KUPS_REGISTRATION_GUIDE.test(normalized) || KUPS_KNOWLEDGE_QUESTION.test(normalized)) return undefined;
  if (STAT_TERMS.test(normalized) && STAT_ENTITY_TERMS.test(normalized)) {
    return { type: "stats", query: "" };
  }
  if (PUBLICATION_TERMS.test(normalized)) {
    return { type: "publication", query: cleanCatalogQuery(normalized.replace(PUBLICATION_TERMS, " ")) };
  }

  const wantsProducts = PRODUCT_TERMS.test(normalized);
  const wantsTourism = TOURISM_TERMS.test(normalized);
  const asksForDetails = EXPLANATION_TERMS.test(normalized) && !SEARCH_ACTIONS.test(normalized);
  const kupsNameQuery = cleanCatalogQuery(normalized.replace(/\bkups\b/gi, " "));
  const namesSpecificKups = kupsNameQuery.split(/\s+/).filter(Boolean).length >= 2 && !KUPS_FACT_QUESTION.test(normalized);
  const asksKupsByCommodity = KUPS_TERMS.test(normalized) && PRODUCT_TERMS.test(normalized) &&
    /\b(?:ada|punya|usaha|mengelola|mengusahakan|komoditas|penghasil)\b/i.test(normalized);
  if (KUPS_TERMS.test(normalized) &&
    (KUPS_DIRECTORY_ACTION.test(normalized) || namesSpecificKups || asksKupsByCommodity) &&
    !asksForDetails) {
    return { type: "kups", query: kupsNameQuery };
  }

  if (asksForDetails) return undefined;
  const hasCatalogCategory = /\b(product|products|produk|produk-produk|barang|komoditas|hasil\s+usaha)\b/i.test(normalized);
  const explicitlyCheckingCatalog = /\b(?:ada|tersedia)\b.{0,25}\b(?:di\s+)?(?:website|situs|katalog|marketplace)\b/i.test(normalized);
  const wantsProductsFromContext = wantsProducts && (hasCatalogCategory || SEARCH_ACTIONS.test(normalized) || explicitlyCheckingCatalog);
  const wantsTourismFromContext = wantsTourism && (
    SEARCH_ACTIONS.test(normalized) ||
    /\b(?:destinasi|katalog|tempat\s+wisata)\b/i.test(normalized) ||
    /\b(?:di|sekitar)\s+\S+/i.test(normalized)
  );
  if (!wantsProductsFromContext && !wantsTourismFromContext) return undefined;

  const type = wantsProductsFromContext && wantsTourismFromContext ? "both" : wantsProductsFromContext ? "product" : "tourism";
  const query = cleanCatalogQuery(normalized.replace(TOURISM_TERMS, " "));
  return { type, query };
}

export function isAmbiguousSingleItem(question: string): boolean {
  const tokens = cleanCatalogQuery(question).toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length === 1 && /^(madu|kopi|duren|durian|kayu|wisata|kerajinan)$/.test(tokens[0]);
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function readItems(value: unknown): PublicCatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const sourceUrl = safeHttpUrl(item.sourceUrl);
    if (
      !["product", "tourism", "kups", "publication"].includes(String(item.type)) ||
      typeof item.recordId !== "string" ||
      typeof item.title !== "string" ||
      (typeof item.kupsName !== "string" && item.type !== "publication") ||
      !sourceUrl
    ) return [];
    return [{
      type: item.type as PublicCatalogItem["type"],
      recordId: item.recordId.slice(0, 100),
      title: item.title.slice(0, 200),
      description: typeof item.description === "string" ? item.description.slice(0, 1000) : "",
      category: typeof item.category === "string" ? item.category.slice(0, 100) : null,
      kupsName: typeof item.kupsName === "string" ? item.kupsName.slice(0, 200) : "",
      location: typeof item.location === "string" ? item.location.slice(0, 200) : null,
      availability: typeof item.availability === "string" ? item.availability.slice(0, 100) : null,
      unit: typeof item.unit === "string" ? item.unit.slice(0, 100) : null,
      imageUrl: safeHttpUrl(item.imageUrl),
      sourceUrl,
    }];
  });
}

export async function searchPublicCatalog(intent: CatalogIntent): Promise<{ items: PublicCatalogItem[]; retrievedAt: string; stats?: PublicWebsiteStats }> {
  const { catalogUrl, catalogApiKey } = getChatbotConfig();
  if (!catalogUrl || !catalogApiKey?.trim()) {
    throw new Error("Katalog KUPS-Web belum dikonfigurasi.");
  }

  const response = await fetch(catalogUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${catalogApiKey}`,
    },
    body: JSON.stringify({ query: intent.query, type: intent.type, limit: 10 }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Katalog KUPS-Web tidak tersedia.");

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Respons katalog KUPS-Web tidak valid.");
  }
  const data = payload as Record<string, unknown>;
  if (data.status !== "ok") throw new Error("Katalog KUPS-Web tidak tersedia.");
  const rawStats = data.websiteStats && typeof data.websiteStats === "object" && !Array.isArray(data.websiteStats)
    ? data.websiteStats as Record<string, unknown>
    : undefined;
  const stats = rawStats && ["kups", "products", "destinations", "provinces"].every((key) => Number.isSafeInteger(rawStats[key]) && Number(rawStats[key]) >= 0)
    ? { kups: Number(rawStats.kups), products: Number(rawStats.products), destinations: Number(rawStats.destinations), provinces: Number(rawStats.provinces) }
    : undefined;
  return {
    items: readItems(data.results),
    retrievedAt: typeof data.retrievedAt === "string" ? data.retrievedAt : new Date().toISOString(),
    ...(stats ? { stats } : {}),
  };
}
