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

const PRODUCT_TERMS = /\b(product|products|produk|produk-produk|barang|komoditas|madu|kopi|duren|durian|bambu|rotan|kerajinan|hasil\s+usaha|hasil\s+hutan\s+bukan\s+kayu|hhbk|oleh[- ]?oleh|dijual|jual)\b/i;
const PRODUCT_CATEGORY_TERMS = /\b(product|products|produk|produk-produk|barang|komoditas|hasil\s+usaha|hasil\s+hutan\s+bukan\s+kayu|hhbk)\b/i;
const TOURISM_TERMS = /\b(wisata|destinasi|ekowisata|homestay|penginapan|kunjungan|tiket)\b/i;
const PUBLICATION_TERMS = /\b(publikasi|ebook|e-book|buku|bacaan|modul|unduhan|unduh|download)\b/i;
const KUPS_TERMS = /\bkups\b/i;
const KUPS_LIST_QUESTION = /\b(?:ada|cari|carikan|lihat|tampilkan|sebutkan)\b.{0,45}\bkups\b.{0,55}\b(?:apa\s+(?:aja|saja)|mana\s+(?:aja|saja)|terdaftar|di\s+mana|dimana)\b|\b(?:apa|mana)\s+(?:aja|saja)\b.{0,35}\bkups\b|\bkups\b.{0,55}\b(?:apa|mana)\s+(?:aja|saja)\b/i;
const KUPS_COMMODITY_LOOKUP = /\b(?:kups)\b.{0,65}\b(?:madu|kopi|duren|durian|bambu|rotan|kerajinan|wisata|ekowisata)\b|\b(?:madu|kopi|duren|durian|bambu|rotan|kerajinan|wisata|ekowisata)\b.{0,65}\b(?:kups)\b/i;
const KUPS_BENEFIT_QUESTION = /\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?|dukungan|fasilitas|bantuan)\b.{0,100}\b(?:kups|usaha|daftar|jadi|bergabung|anggota)\b|\b(?:kups|anggota\s+kups)\b.{0,100}\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?|dukungan|fasilitas|bantuan)\b|\bkups\b.{0,45}\b(?:bisa|dapat)\s+(?:membantu|bantu|mendukung)\b/i;
const KUPS_REGISTRATION_GUIDE = /\b(?:gimana|bagaimana|cara|langkah|prosedur|persyaratan|syarat(?:nya)?|pengajuan|ajukan|mulai)\b.{0,110}\b(?:daftar|daftarin|mendaftar|pendaftaran|mengajukan|pengajuan|ikut(?:an)?|bergabung|gabung|program|jadi)\b.{0,55}\b(?:kups|kelompok\s+usaha\s+perhutanan\s+sosial)\b|\b(?:kups|kelompok\s+usaha\s+perhutanan\s+sosial)\b.{0,75}\b(?:syarat|persyaratan|pengajuan|daftar|daftarin|mendaftar|pendaftaran|gabung|bergabung|ikutan|ikut)\b/i;
const KUPS_KNOWLEDGE_QUESTION = /\bkups\b.{0,55}\b(?:apa|apaan|itu|tu|tuh|arti|pengertian|definisi|singkatan|kelas|syarat|persyaratan|manfaat|keuntungan|cara|prosedur|bagaimana|gimana|program|bantuan|dukungan|fasilitas)\b/i;
const KUPS_DIRECTORY_ACTION = /\b(profil|profile|direktori|data|lokasi|lokasinya|alamat|wilayah|terdaftar|cari|carikan|tampilkan|sebutkan|informasi|info|sebaran)\b/i;
const PLACE_QUERY = /\b(?:di|dari|wilayah|provinsi|kabupaten|kota)\s+(?:provinsi\s+|kabupaten\s+|kota\s+)?[\p{L}][\p{L} .'-]{1,55}\b/iu;
const NATIONAL_SCOPE = /\b(?:seluruh\s+indonesia|se-indonesia|nasional|seluruh\s+negeri)\b/i;
const STAT_TERMS = /\b(berapa|jumlah|total|statistik)\b/i;
const STAT_ENTITY_TERMS = /\b(kups|kelompok|produk|product|wisata|destinasi|provinsi)\b/i;
const EXPLANATION_TERMS = /\b(manfaat|khasiat|kandungan|pengertian|definisi|arti|cara\s+(?:membuat|mengolah|memulai)|resep|tips)\b/i;
const SEARCH_ACTIONS = /\b(cari|carikan|tampilkan|lihat|cek|katalog|tersedia|daftar|mana|mana\s+aja|mana\s+saja|apa\s+aja|apa\s+saja|rekomendasikan|rekomendasi)\b/i;
const SEARCH_FILLER = /\b(tolong|coba|sebutkan|carikan|cari|tampilkan|lihat|rekomendasikan|rekomendasi|menjual|dijual|menawarkan|memasarkan|pemasaran|apa|apaan|saja|aja|ada|yang|di|dari|mana|dimana|kups|kelompok|saya|aku|gue|gw|mau|ingin|pengen|tahu|tau|dong|deh|sih|nih|nanya|tanya|info|informasi|ttg|tentang|mengenai|untuk|apakah|website|situs|publik|product|products|produk|produk-produk|barang|komoditas|hasil\s+usaha|katalog|profil|profile|direktori|data|lokasi|lokasinya|alamat|wilayah|terdaftar|sebaran|berada|kabupaten|kab|kota|provinsi|kecamatan|kec|terkait|soal|saat\s+ini|sekarang|today|please|the|available|currently|ga|gak|gk|ngga|nggak|engga|enggak|kah|ya|tuh|tu|siapa|dalam|dengan|sendiri|perhutanan|sosial|berapa|jumlah|total|banyak|penghasil|tersebut|mengenai|kelompok|usaha)\b/gi;

export function isKupsListQuestion(question: string): boolean {
  // If the user explicitly asks for products or tourism, the KUPS mention is
  // a source/owner reference, not a request to list KUPS profiles.
  const explicitList = KUPS_LIST_QUESTION.test(question);
  const commodityLookup = KUPS_COMMODITY_LOOKUP.test(question) &&
    /\b(?:ada|cari|carikan|lihat|tampilkan|sebutkan|di\s+mana|dimana|mana\s+(?:aja|saja)|apa\s+(?:aja|saja)|terdaftar|penghasil)\b/i.test(question);
  return (explicitList || commodityLookup) &&
    !PRODUCT_CATEGORY_TERMS.test(question) &&
    !TOURISM_TERMS.test(question);
}

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
  const asksForProducts = PRODUCT_TERMS.test(normalized);
  const asksForTourism = TOURISM_TERMS.test(normalized);
  const asksForPublicListings =
    /\b(?:cari|carikan|tampilkan|lihat|cek|katalog)\b.{0,55}\b(?:produk|barang|komoditas|madu|kopi|durian|duren|bambu|rotan|kerajinan|wisata|destinasi|ekowisata|homestay)\b/i.test(normalized) ||
    /\b(?:menjual|dijual|menawarkan|listing|tersedia)\b.{0,45}\b(?:produk|barang|komoditas|madu|kopi|durian|duren|bambu|rotan|kerajinan|wisata|destinasi|ekowisata|homestay)\b/i.test(normalized) ||
    /\b(?:ada|cari|carikan|tampilkan|sebutkan)\b.{0,55}\b(?:produk|listing|kelompok|KUPS)\b.{0,55}\b(?:madu|kopi|durian|duren|bambu|rotan|kerajinan|wisata|ekowisata|homestay)\b/i.test(normalized) ||
    /\b(?:produk|barang|komoditas|wisata|destinasi)\b.{0,45}\b(?:apa\s+(?:aja|saja)|katalog|tersedia|terdaftar)\b/i.test(normalized);
  if (isKupsListQuestion(normalized)) {
    const query = cleanCatalogQuery(normalized);
    return { type: "kups", query: PLACE_QUERY.test(normalized) || query ? query : "" };
  }
  // Questions about meaning, eligibility, or the process belong to the guide,
  // unless the user also explicitly asks us to look up public listings.
  if (!asksForPublicListings && (KUPS_BENEFIT_QUESTION.test(normalized) || KUPS_REGISTRATION_GUIDE.test(normalized) || KUPS_KNOWLEDGE_QUESTION.test(normalized))) return undefined;
  if (STAT_TERMS.test(normalized) && STAT_ENTITY_TERMS.test(normalized)) {
    if (KUPS_TERMS.test(normalized) && PLACE_QUERY.test(normalized) && !NATIONAL_SCOPE.test(normalized)) {
      return { type: "kups", query: cleanCatalogQuery(normalized) };
    }
    if (KUPS_TERMS.test(normalized) && KUPS_COMMODITY_LOOKUP.test(normalized) && !NATIONAL_SCOPE.test(normalized)) {
      return { type: "kups", query: cleanCatalogQuery(normalized) };
    }
    if (PRODUCT_TERMS.test(normalized) && !PRODUCT_CATEGORY_TERMS.test(normalized)) {
      return { type: "product", query: cleanCatalogQuery(normalized) };
    }
    if (TOURISM_TERMS.test(normalized) && PLACE_QUERY.test(normalized) && !NATIONAL_SCOPE.test(normalized)) {
      return { type: "tourism", query: cleanCatalogQuery(normalized) };
    }
    return { type: "stats", query: "" };
  }
  if (PUBLICATION_TERMS.test(normalized)) {
    return { type: "publication", query: cleanCatalogQuery(normalized.replace(PUBLICATION_TERMS, " ")) };
  }

  const wantsProducts = asksForProducts;
  const wantsTourism = asksForTourism;
  const asksForDetails = EXPLANATION_TERMS.test(normalized) && !SEARCH_ACTIONS.test(normalized);
  const hasCatalogCategory = PRODUCT_CATEGORY_TERMS.test(normalized);
  const explicitlyCheckingCatalog = /\b(?:ada|tersedia)\b.{0,25}\b(?:di\s+)?(?:website|situs|katalog|marketplace)\b/i.test(normalized);
  const wantsProductsFromContext = wantsProducts && (
    (hasCatalogCategory && SEARCH_ACTIONS.test(normalized)) ||
    asksForPublicListings ||
    explicitlyCheckingCatalog
  );
  const wantsTourismFromContext = wantsTourism && (
    SEARCH_ACTIONS.test(normalized) ||
    /\b(?:destinasi|katalog|tempat\s+wisata)\b/i.test(normalized) ||
    /\b(?:di|sekitar)\s+\S+/i.test(normalized)
  );
  // An explicit product or tourism request wins over a nearby KUPS mention:
  // "carikan produk kopi dari kelompok KUPS" is a product search.
  if ((wantsProductsFromContext || wantsTourismFromContext) && (asksForPublicListings || !KUPS_BENEFIT_QUESTION.test(normalized))) {
    if (asksForDetails) return undefined;
    const type = wantsProductsFromContext && wantsTourismFromContext ? "both" : wantsProductsFromContext ? "product" : "tourism";
    const query = cleanCatalogQuery(normalized.replace(TOURISM_TERMS, " "));
    return { type, query };
  }

  if (KUPS_TERMS.test(normalized) && !asksForDetails) {
    const textAfterKups = normalized.split(/\bkups\b/i).slice(1).join(" ");
    const hasSpecificKupsQualifier = cleanCatalogQuery(textAfterKups).length > 0;
    const isCommodityLookup = PRODUCT_TERMS.test(normalized) &&
      /\b(?:ada|carikan|cari|di\s+mana|dimana|penghasil|kelompok|komoditas)\b/i.test(normalized);
    if (KUPS_DIRECTORY_ACTION.test(normalized) || PLACE_QUERY.test(normalized) || hasSpecificKupsQualifier || isCommodityLookup) {
      return { type: "kups", query: cleanCatalogQuery(normalized) };
    }
  }

  if (asksForDetails) return undefined;
  return undefined;
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
