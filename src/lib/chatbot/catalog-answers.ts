import { getChatbotConfig } from "./config";
import {
  searchPublicCatalog,
  type CatalogIntent,
  type PublicCatalogItem,
  type PublicWebsiteStats,
} from "./catalog";
import type { ChatResult, ChatSource } from "./types";

const COUNT_QUESTION = /\b(?:berapa|jumlah|banyak|total)\b/i;
const PRODUCT_PURCHASE_QUESTION = /\b(?:beli|membeli|pesan|memesan|order|pembelian)\b/i;

export function formatCheckedAt(value: string): string {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

export function websiteSource(retrievedAt: string): ChatSource | undefined {
  const catalogUrl = getChatbotConfig().catalogUrl;
  if (!catalogUrl) return undefined;
  try {
    return {
      sourceId: "kups-web-public-data",
      title: "Data publik KUPS-Web",
      url: new URL("/", catalogUrl).href,
      checkedAt: formatCheckedAt(retrievedAt),
      authority: "KUPS-Web",
    };
  } catch {
    return undefined;
  }
}

export function sourcesFromPublicItems(
  items: PublicCatalogItem[],
  retrievedAt: string,
): ChatSource[] {
  const checkedAt = formatCheckedAt(retrievedAt);
  return items.map((item) => ({
    sourceId: `kups-web-${item.type}-${item.recordId}`,
    title: item.title,
    url: item.sourceUrl,
    checkedAt,
    authority: "KUPS-Web",
  }));
}

export function publicDataAnswer(
  intent: CatalogIntent,
  items: PublicCatalogItem[],
  retrievedAt: string,
  stats?: PublicWebsiteStats,
  question = "",
): string {
  const checkedAt = formatCheckedAt(retrievedAt);

  if (intent.type === "stats" && stats) {
    const activeQualifier = /\baktif\b/i.test(question)
      ? " Statistik ini menghitung profil publik; endpoint ini tidak memisahkan status aktif."
      : "";
    return `Di data publik KUPS-Web tercatat ${stats.kups} profil KUPS, ${stats.products} produk, dan ${stats.destinations} destinasi wisata yang tersebar di ${stats.provinces} provinsi.${activeQualifier} Data diperiksa ${checkedAt} WIB.`;
  }
  if (intent.type === "stats") {
    return "Aku belum bisa membaca statistik publik KUPS-Web saat ini. Coba lagi nanti atau cari profil/listing tertentu.";
  }

  if (COUNT_QUESTION.test(question) && items.length > 0) {
    const label = intent.type === "kups" ? "profil KUPS" : intent.type === "product" ? "produk" : intent.type === "tourism" ? "destinasi wisata" : "hasil publik";
    const limitNote = items.length >= 10
      ? "Pencarian dibatasi maksimal 10 hasil, jadi ini bukan jumlah total."
      : "Ini jumlah hasil yang cocok di katalog publik, bukan statistik resmi seluruh wilayah.";
    return `Aku menemukan ${items.length} ${label}${intent.query ? ` untuk “${intent.query}”` : ""}. ${limitNote} Data diperiksa ${checkedAt} WIB.`;
  }

  if (items.length === 0) {
    const target = intent.query ? ` untuk “${intent.query}”` : "";
    const scope = intent.type === "kups" ? "profil KUPS" : intent.type === "publication" ? "publikasi" : intent.type === "tourism" ? "destinasi wisata" : "listing produk";
    return `Aku belum menemukan ${scope} publik${target} yang cocok di KUPS-Web saat ini. Itu hanya berarti belum ada hasil yang cocok dengan kata kunci ini, bukan bukti bahwa usahanya tidak ada. Data diperiksa ${checkedAt} WIB.`;
  }

  if (intent.type === "kups") {
    const details = items.map((item) => {
      const location = item.location ? `di ${item.location}` : "lokasinya belum dicantumkan";
      const category = item.category ? ` · kategori direktori: ${item.category}` : "";
      return `**${item.title}** — ${location}${category}`;
    }).join("; ");
    const countText = items.length === 1 ? "satu profil" : `${items.length} profil`;
    return `Di direktori publik KUPS-Web, aku menemukan ${countText}${intent.query ? ` untuk “${intent.query}”` : ""}: ${details}. Buka kartu hasil untuk memeriksa deskripsi dan penawaran lebih lanjut. Data diperiksa ${checkedAt} WIB.`;
  }

  const labels: Record<PublicCatalogItem["type"], string> = {
    product: "produk",
    tourism: "destinasi wisata",
    kups: "profil KUPS",
    publication: "publikasi",
  };
  const label = labels[items[0].type];
  const details = items.map((item) => {
    const owner = item.kupsName ? ` dari ${item.kupsName}` : "";
    const category = item.category ? ` · ${item.category}` : "";
    const unit = item.unit ? ` · satuan ${item.unit}` : "";
    const demo = /demo|contoh|demonstrasi/i.test(`${item.title} ${item.description}`) ? " · data demonstrasi" : "";
    return `**${item.title}**${owner}${category}${unit}${demo}`;
  }).join("; ");

  if (intent.type === "product") {
    if (PRODUCT_PURCHASE_QUESTION.test(question)) {
      const isDemo = items.some((item) => /demo|contoh|demonstrasi/i.test(`${item.title} ${item.description}`));
      const note = isDemo
        ? "Hasil ini ditandai sebagai data demonstrasi, jadi belum tentu tersedia untuk dibeli. Buka kartu detail untuk memeriksa informasi publiknya."
        : "Untuk memesan, buka kartu detail dan periksa petunjuk pemesanan atau kontak publik yang dicantumkan KUPS. Chatbot ini hanya menampilkan katalog, bukan memproses transaksi.";
      return `Aku menemukan ${items.length} ${label}${intent.query ? ` untuk “${intent.query}”` : ""}: ${details}. ${note} Data diperiksa ${checkedAt} WIB.`;
    }
    return `Di katalog publik KUPS-Web, aku menemukan ${items.length} ${label}${intent.query ? ` untuk “${intent.query}”` : ""}: ${details}. Buka kartu hasil untuk melihat detailnya. Data diperiksa ${checkedAt} WIB.`;
  }

  const nextStep = intent.type === "tourism"
    ? "Kartu hasil memuat ringkasan destinasi dan kelompok pengelolanya."
    : intent.type === "publication"
      ? "Buka kartu hasil untuk membaca atau mengunduh materi yang tersedia."
      : "Buka kartu hasil untuk melihat informasi publik yang tersedia.";
  return `Aku menemukan ${items.length} ${label}${intent.query ? ` untuk “${intent.query}”` : ""}: ${details}. ${nextStep} Data diperiksa ${checkedAt} WIB.`;
}

export async function answerFromPublicResults(
  question: string,
  intent: CatalogIntent,
  items: PublicCatalogItem[],
  retrievedAt: string,
  stats?: PublicWebsiteStats,
): Promise<string> {
  return publicDataAnswer(intent, items, retrievedAt, stats, question);
}

export async function answerWithCatalogAttachment(
  question: string,
  intent: CatalogIntent,
  guidance: Promise<ChatResult>,
): Promise<ChatResult> {
  const result = await guidance;
  try {
    const catalog = await searchPublicCatalog(intent);
    const followup = catalog.items.length
      ? "Sekalian aku cek katalog publik KUPS-Web. Hasil yang cocok tersedia di kartu di bawah."
      : `Aku juga mengecek katalog publik untuk “${intent.query || question}”, tetapi belum menemukan listing yang cocok. Itu bukan bukti bahwa usahanya tidak ada.`;
    const listSources = catalog.items.length
      ? sourcesFromPublicItems(catalog.items, catalog.retrievedAt)
      : [websiteSource(catalog.retrievedAt)].filter((source): source is ChatSource => Boolean(source));
    const sources = [...new Map([...result.sources, ...listSources].map((source) => [source.sourceId, source])).values()];
    return { ...result, answer: `${result.answer}\n\n${followup}`, sources, catalogItems: catalog.items };
  } catch {
    return {
      ...result,
      answer: `${result.answer}\n\nPencarian katalog publik sedang tidak tersedia, jadi aku belum bisa memastikan ada listing yang cocok.`,
    };
  }
}
