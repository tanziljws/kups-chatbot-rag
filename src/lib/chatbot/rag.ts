import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanCatalogQuery, detectCatalogIntent, isAmbiguousSingleItem, isKupsListQuestion, searchPublicCatalog, type CatalogIntent, type PublicCatalogItem } from "./catalog";
import { getChatbotConfig } from "./config";
import { normalizeQuestion } from "./normalize";
import { searchKnowledge, type KnowledgeMatch, type KnowledgeMetadata } from "./vector-index";

export type ChatSource = {
  sourceId: string;
  filename?: string;
  title: string;
  url: string;
  checkedAt: string;
  authority?: string;
};

export type ChatResult = {
  answer: string;
  sources: ChatSource[];
  catalogItems: PublicCatalogItem[];
  needsClarification: boolean;
  handoff?: ExpertHandoff | null;
};

export type ExpertHandoff = {
  specialty:
    | "kelembagaan"
    | "produksi_mutu"
    | "keuangan"
    | "legalitas"
    | "branding"
    | "pemasaran"
    | "pembiayaan"
    | "digitalisasi"
    | "sdm"
    | "iklim";
  reason: string;
  summary: string;
};

export type ChatTurn = {
  role: "assistant" | "user";
  content: string;
};

const GREETING_ONLY = /^(?:halo+|hai+|hi+|hello+|hey+|assalamu'?alaikum|assalamualaikum|pagi|selamat pagi|siang|selamat siang|sore|selamat sore|malam|selamat malam)[.!?,\s]*$/i;
const IDENTITY_QUESTION = /\b(?:siapa|apa)\b.{0,25}\b(?:kamu|anda|asisten|chatbot|bot)\b|\b(?:kamu|anda|asisten|chatbot|bot)\b.{0,25}\b(?:siapa|apa)\b/i;
const WEBSITE_QUESTION = /\b(?:website|situs|web)\b.{0,35}\b(?:ini|tentang|isinya|apa)\b|\b(?:apa|tentang)\b.{0,25}\b(?:website|situs|web)\b/i;
const CAPABILITY_QUESTION = /\b(?:kamu|anda|asisten|chatbot|bot)\b.{0,30}\b(?:bisa|dapat|mampu)\b.{0,30}\b(?:apa|aja|saja|bantu|ngapain|lakukan|kerjakan)\b|\bapa saja yang bisa\b/i;
const PERSONAL_KUPS_ELIGIBILITY = /\b(?:punya|memiliki|menjalankan|usaha|bisnis|jualan|produk|produksi|olahan)\b.{0,90}\b(?:bisa|boleh|layak|masuk|menjadi|jadi|termasuk|bergabung|gabung|daftar|mendaftar|registrasi)\b.{0,70}\bkups\b|\bkups\b.{0,70}\b(?:bisa|boleh|layak|masuk|menjadi|jadi|termasuk|daftar|mendaftar|registrasi)\b.{0,90}\b(?:usaha|bisnis|jualan|produk|produksi|olahan)\b/i;
const KUPS_RELATIONSHIP_QUESTION = /\b(?:hubungan|hubungannya|terkait|kaitannya)\b.{0,60}\bkups\b|\bkups\b.{0,60}\b(?:hubungan|terkait|kaitan)\b/i;
const GENERIC_REGISTRATION_REQUEST = /^(?:(?:aku|saya|gue|gw)\s+)?(?:(?:mau|ingin|pengen)\s+)?(?:daftar|mendaftar|daftarin)(?:\s+(?:dong|nih|ya))?[.!?\s]*$/i;
const BUSINESS_PLANNING = /\b(?:mau|ingin|pengen|rencana|merintis|memulai|bikin|buat|membangun|jalanin|menjalankan|kepikiran)\b.{0,55}\b(?:bisnis|usaha|jualan|produksi|madu|kopi|kayu|wisata|kerajinan|produk)\b|\b(?:bisnis|usaha)\b.{0,45}\b(?:madu|kopi|kayu|wisata|kerajinan|produk)\b/i;
const SUPPORT_NEED = /\b(?:bingung|sulit|kesulitan|kendala|masalah|butuh\s+bantuan|perlu\s+bantuan|bisa\s+bantu(?:in)?|bantu\s+usaha|membantu\s+usaha|akses\s+pasar|pemasaran|promosi|kemasan|modal|pendanaan)\b/i;
const BUSINESS_DEVELOPMENT_FOLLOWUP = /\b(?:cara|gimana|bagaimana)\b.{0,45}\b(?:mengembangkan|ngembangin|mengembangkannya|kembangkan|dikembangkan)\b|\b(?:mengembangkan|ngembangin|mengembangkannya|kembangkan)\b.{0,45}\b(?:usaha|bisnis|produk|itu|nya)\b/i;
const KUPS_DEFINITION_QUESTION = /\b(?:arti|pengertian|definisi|singkatan|singktn|kepanjangan)\b.{0,45}\bkups\b|\b(?:apa|apaan)\b.{0,45}\bkups\b|\bkups\b.{0,55}\b(?:itu|tu|tuh|apa|apaan|adalah|arti|pengertian|definisi|singkatan|singktn|kepanjangan)\b/i;
const KPS_PS_DIFFERENCE = /\b(?:beda|bedanya|perbedaan)\b.{0,35}\b(?:kps|ps)\b.{0,30}\b(?:kps|ps)\b|\b(?:kps|ps)\b.{0,20}\b(?:sama|sm|dan|vs|dengan)\b.{0,20}\b(?:kps|ps)\b.{0,35}\b(?:beda|bedanya|perbedaan)\b/i;
const KUPS_GROUP_COMPARISON = /\b(?:beda|bedanya|perbedaan)\b.{0,45}\bkups\b.{0,55}\b(?:kelompok\s+tani|kelompok\s+biasa|kelompok\s+usaha|kps)\b|\b(?:kelompok\s+tani|kelompok\s+biasa)\b.{0,55}\bkups\b.{0,35}\b(?:beda|bedanya|perbedaan)\b/i;
const KUPS_BENEFIT_QUESTION = /\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?|dukungan|fasilitas|bantuan)\b.{0,100}\b(?:kups|usaha|daftar|jadi|ikut(?:an)?|gabung|bergabung|anggota)\b|\b(?:kups|anggota\s+kups)\b.{0,100}\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?|dukungan|fasilitas|bantuan|mengembangkan|berkembang)\b|\bkups\b.{0,65}\b(?:bisa|dapat)\s+(?:bantu|membantu|mendukung)\b/i;
const KUPS_MEMBER_JOIN_GUIDE = /\b(?:anggota|keanggotaan)\b.{0,50}\bkups\b|\bkups\b.{0,50}\b(?:anggota|bergabung|gabung|ikut)\b|\b(?:bergabung|gabung|ikut)\b.{0,40}\bkups\b/i;
const REGISTRATION_REQUIREMENTS_FOLLOWUP = /\b(?:syarat(?:nya)?|persyaratan|berkas|dokumen|ribet|susah|sulit|lama|proses(?:nya)?)\b/i;
const KUPS_REGISTRATION_GUIDE = /\b(?:gimana|bagaimana|cara|langkah|prosedur|persyaratan|syarat(?:nya)?|pengajuan|ajukan|daftar|daftarin|mendaftar|pendaftaran|mulai|awal)\b.{0,110}\b(?:daftar|daftarin|mendaftar|pendaftaran|mengajukan|pengajuan|bergabung|gabung|ikut(?:an)?|program|jadi|menjadi|masuk|syarat|persyaratan)\b.{0,70}\b(?:kups|kelompok\s+usaha\s+perhutanan\s+sosial)\b|\b(?:kups|kelompok\s+usaha\s+perhutanan\s+sosial)\b.{0,90}\b(?:syarat|persyaratan|pengajuan|daftar|daftarin|mendaftar|pendaftaran|gabung|bergabung|ikutan|ikut|masuk|proses|cara)\b|\b(?:aku|saya|gue|gw)\b.{0,40}\b(?:mau|ingin|pengen)\s+(?:daftar|gabung|ikut(?:an)?|masuk)\b.{0,50}\bkups\b|\b(?:ikut|ikutan|bergabung|gabung)\b.{0,45}\b(?:program\s+)?kups\b|\b(?:bisa|boleh)\s+(?:aku|saya|gue|gw)?\s*(?:(?:ga|gak|gk|ngga|nggak|enggak|tidak)\s+)?(?:daftar|gabung|ikut(?:an)?|masuk)\b.{0,45}\bkups\b|\bkups\b.{0,45}\b(?:bisa|boleh)\s+(?:(?:ga|gak|gk|ngga|nggak|enggak|tidak)\s+)?(?:daftar|gabung|ikut(?:an)?|masuk)\b|\b(?:syarat|persyaratan|daftar|mendaftar|proses)\b.{0,60}\bkups\b/i;
const KPS_DEFINITION_QUESTION = /\b(?:arti|pengertian|definisi|singkatan|kepanjangan|siapa)\b.{0,35}\b(?:kps|ps|gps)\b|\b(?:kps|ps|gps)\b.{0,35}\b(?:apa|arti|pengertian|definisi|singkatan|kepanjangan|siapa)\b/i;
const KUPS_CLASS_QUESTION = /\b(?:kelas(?:nya)?|pemula|madya|utama)\b.{0,45}\bkups\b|\bkups\b.{0,45}\b(?:kelas(?:nya)?|pemula|madya|utama)\b|\b(?:blue|biru|silver|perak|gold|emas|platinum|platina)\b/i;
const PERSONAL_KUPS_STATUS = /\b(?:kelas|status)\b.{0,40}\b(?:saya|aku|kelompok)\b|\b(?:saya|aku|kelompok)\b.{0,40}\b(?:kelas|status)\b/i;
const ACRONYM_CLARIFICATION = /\bgps\b.{0,40}\bps\b|\bps\b.{0,40}\bgps\b/i;
const PERHUTANAN_SOCIAL_OVERVIEW = /\b(?:awam|jelasin|jelaskan|ceritakan|dari\s+awal|apa\s+itu)\b.{0,90}\b(?:perhutanan\s+sosial|ps)\b|\b(?:perhutanan\s+sosial|ps)\b.{0,90}\b(?:awam|jelasin|jelaskan|ceritakan|dari\s+awal)\b/i;
const KPS_GROUP_JOIN_GUIDE = /\b(?:cara|gimana|bagaimana|mau|ingin|pengen)\b.{0,60}\b(?:gabung|bergabung|ikut|ikutan|masuk)\b.{0,70}\b(?:kelompok\s+perhutanan\s+sosial|kps)\b/i;
const KUPS_GROUP_FORMATION_QUESTION = /\b(?:cara|gimana|bagaimana)\b.{0,45}\b(?:bikin|membuat|bentuk|membentuk)\b.{0,55}\b(?:kelompok|kups)\b|\b(?:bikin|membuat|membentuk)\b.{0,55}\bkelompok\b|\b(?:bentuk|membentuk)\b.{0,55}\b(?:kelompok\s+(?:perhutanan\s+sosial|KPS|usaha)|KPS|KUPS)\b/i;
const WEBSITE_MANAGEMENT_QUESTION = /\b(?:ubah|mengubah|edit|mengedit|perbarui|memperbarui|update|tambah|menambah|menambahkan|tambahkan|upload|unggah)\b.{0,50}\b(?:profil|profile|produk|penawaran|listing|data)\b|\b(?:profil|profile|produk|penawaran|listing)\b.{0,45}\b(?:ubah|edit|perbarui|update|tambah|menambahkan|tambahkan|upload|unggah)\b/i;
const PUBLIC_OFFICER_LOOKUP = /\b(?:siapa|nama|kontak|hubungi|petugas|pendamping|penanggung\s+jawab)\b.{0,90}\b(?:mengurus|daftar|pendaftaran|pengajuan|kups|desa|kecamatan|kabupaten|daerah)\b|\b(?:petugas|pendamping|kontak)\b.{0,70}\b(?:desa|kecamatan|kabupaten|daerah|KUPS)\b/i;
const KUPS_FEE_QUESTION = /\b(?:biaya|bayar|tarif|pungutan)\b.{0,60}\b(?:daftar|pendaftaran|pengajuan|kups)\b|\b(?:daftar|pendaftaran|pengajuan|kups)\b.{0,60}\b(?:biaya|bayar|tarif|pungutan)\b/i;
const KUPS_GUARANTEED_OUTCOME_QUESTION = /\b(?:pasti|dijamin|menjamin|garansi|menggaransi|otomatis)\b.{0,65}\b(?:diterima|lolos|bantuan|modal|dana|uang|kups|anggota|jadi)\b|\b(?:bantuan|modal|dana|uang|diterima|lolos|menjadi\s+KUPS)\b.{0,65}\b(?:pasti|dijamin|menjamin|otomatis)\b/i;
const PRIVATE_CONTACT_REQUEST = /\b(?:nomor\s+whatsapp\s+pribadi|wa\s+pribadi|nomor\s+telepon\s+pribadi|nomor\s+pribadi|kontak\s+pribadi)\b/i;
const CONTEXTUAL_COUNT_QUESTION = /\b(?:ada\s+berapa(?:\s+banyak)?|berapa\s+banyak|jumlahnya)\b|^\s*berapa\s*[?!.,]*$/i;
const CONTEXTUAL_LOCATION_QUESTION = /\b(?:lokasinya|lokasi\s+kelompok|aku\s+mau\s+tahu\s+lokasinya|saya\s+ingin\s+tahu\s+lokasinya|di\s+mana|dimana|lokasi)\b/i;
const COUNT_QUESTION = /\b(?:berapa|jumlah|banyak|total)\b/i;
const PRODUCT_PURCHASE_QUESTION = /\b(?:beli|membeli|pesan|memesan|order|pembelian)\b/i;

function sourceFromMetadata(metadata: KnowledgeMetadata): ChatSource | undefined {
  if (metadata.access !== "public") return undefined;
  const title = typeof metadata.title === "string" ? metadata.title : "";
  const url = typeof metadata.url === "string" ? metadata.url : "";
  const checkedAt = typeof metadata.checkedAt === "string" ? metadata.checkedAt : "";
  const sourceId = typeof metadata.sourceId === "string" ? metadata.sourceId : "";
  if (!title || !url || !checkedAt || !sourceId) return undefined;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return undefined;
  } catch {
    return undefined;
  }
  return {
    sourceId,
    filename: typeof metadata.filename === "string" ? metadata.filename : undefined,
    title,
    url,
    checkedAt,
    authority: typeof metadata.authority === "string" ? metadata.authority : undefined,
  };
}

const APPROVED_SOURCE_FILES: Record<string, string> = {
  "permenlhk-9-2021": "kups-definition.md",
  "permenlhk-9-2021-business": "kups-business-path.md",
  "permenhut-18-2025": "kups-class-overview.md",
  "gokups-home": "gokups-overview.md",
};

const approvedSourceCache = new Map<string, Promise<ChatSource | undefined>>();

function getApprovedSource(sourceId: string): Promise<ChatSource | undefined> {
  const cached = approvedSourceCache.get(sourceId);
  if (cached) return cached;
  const filename = APPROVED_SOURCE_FILES[sourceId];
  if (!filename) return Promise.resolve(undefined);
  const pending = readFile(path.join(process.cwd(), "knowledge", "approved", filename), "utf8")
    .then((content) => {
      const frontMatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      if (!frontMatter) return undefined;
      const metadata: KnowledgeMetadata = Object.fromEntries(frontMatter.split(/\r?\n/).flatMap((line) => {
        const separator = line.indexOf(":");
        return separator > 0 ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]] : [];
      }));
      metadata.access = "public";
      return sourceFromMetadata(metadata);
    })
    .catch(() => undefined);
  approvedSourceCache.set(sourceId, pending);
  return pending;
}

function isContextualFollowup(question: string, history: ChatTurn[]): boolean {
  if (history.length === 0) return false;
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
  if (!lastAssistant) return false;
  const priorQuestion = previousUserQuestion(history);
  if (
    PERSONAL_KUPS_ELIGIBILITY.test(priorQuestion) &&
    /(?:tergabung.{0,50}KPS|KPS.{0,50}(?:sendiri|kelompok)|kelompok.{0,50}KPS)/i.test(lastAssistant.content) &&
    /\b(?:KPS|kelompok|sendiri|perorangan|individu|tergabung|sudah|belum|iya|enggak|nggak|tidak)\b/i.test(question)
  ) return true;
  if (/\b(?:yang tadi|tadi|tersebut|maksudnya|hal itu|yang itu|lanjut|lanjutkan|kalau begitu|kalo gitu|terus|bagaimana dengan|gimana dengan|bagian itu)\b/i.test(question)) return true;
  const isShortReply = question.trim().split(/\s+/).length <= 4;
  return isShortReply && /[?؟]\s*$/.test(lastAssistant.content);
}

function previousUserQuestion(history: ChatTurn[]): string {
  return [...history].reverse().find((turn) => turn.role === "user")?.content ?? "";
}

function clarificationAnswer(question: string): string {
  const excerpt = question.replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
  return `Aku belum menemukan sumber publik yang pas untuk “${excerpt}”. Kamu sedang mencari aturan/istilah KUPS, data profil atau penawaran di situs, publikasi, atau ingin membahas rencana usaha? Pilih salah satu atau ceritakan konteksnya sedikit.`;
}

async function answerFromKnowledge(
  original: string,
  normalized: string,
  history: ChatTurn[],
  retrievedMatches?: KnowledgeMatch[],
): Promise<ChatResult> {
  const config = getChatbotConfig();
  const useHistory = isContextualFollowup(normalized, history);
  const priorQuestion = useHistory ? previousUserQuestion(history) : "";
  const retrievalQuestion = [priorQuestion, normalized].filter(Boolean).join(" ");
  const matches = retrievedMatches ?? await searchKnowledge(retrievalQuestion, config.topK, config.minScore);
  const contextEntries = matches.flatMap(({ document }) => {
    const source = sourceFromMetadata(document.metadata);
    if (!source) return [];
    return [{ document, source }];
  });
  if (contextEntries.length === 0) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const first = contextEntries[0];
  const excerpt = first.document.pageContent
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = excerpt.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  const conciseExcerpt = sentences.slice(0, 2).join(" ").slice(0, 520);
  if (!conciseExcerpt) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }
  return {
    answer: `${conciseExcerpt} [S1]`,
    sources: [first.source],
    catalogItems: [],
    needsClarification: false,
  };
}

async function answerKupsTermQuestion(
  original: string,
  normalized: string,
  kind: "definition" | "comparison",
): Promise<ChatResult> {
  const source = await getApprovedSource("permenlhk-9-2021");
  if (!source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const answer = kind === "comparison"
    ? "Gampangnya: PS (Perhutanan Sosial) adalah sistem pengelolaan hutannya; KPS adalah kelompok pemegang persetujuan/pengelola Perhutanan Sosial; KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Jadi PS itu skemanya, KPS kelompoknya, KUPS wadah usahanya. Kamu lagi mencari tahu jalur usaha lewat KUPS?"
    : "Gampangnya, KUPS singkatan dari Kelompok Usaha Perhutanan Sosial. Ini wadah usaha yang dibentuk oleh KPS untuk mengembangkan usaha dalam skema Perhutanan Sosial; jadi bukan pendaftaran usaha perorangan secara langsung [S1]. Kamu lagi ingin memahami istilahnya saja, atau sedang mencari langkah untuk usaha tertentu?";
  return { answer, sources: [source], catalogItems: [], needsClarification: false };
}

function quickReply(answer: string): ChatResult {
  return { answer, sources: [], catalogItems: [], needsClarification: false };
}

async function answerPerhutananSocialOverview(question: string): Promise<ChatResult> {
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021",
    "Gampangnya, Perhutanan Sosial (PS) adalah skema bagi masyarakat setempat atau masyarakat adat untuk mengelola hutan secara lestari. Kelompok yang memegang persetujuan PS disebut KPS; KUPS adalah kelompok usaha yang dibentuk oleh KPS untuk menjalankan atau merencanakan usaha [S1]. Jadi urutannya: pahami dulu apakah ada KPS/persetujuan PS di wilayahmu, lalu lihat potensi usaha yang bisa dikelola kelompok. Kamu ingin tahu cara bergabung dengan kelompok yang sudah ada atau jalur mengembangkan usaha?",
  );
}

async function answerKpsGroupJoin(question: string): Promise<ChatResult> {
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021",
    "Kalau yang kamu maksud bergabung ke kelompok Perhutanan Sosial, cari dulu KPS yang sudah memegang persetujuan di wilayahmu; syarat menerima anggota bisa bergantung pada kelompok dan wilayah. Kalau kelompokmu belum memegang persetujuan PS, itu proses yang berbeda dari membentuk KUPS dan perlu arahan pendamping/KPH setempat. Sebutkan kabupaten/kotanya, nanti aku bantu cari jalur informasi publik yang relevan.",
    true,
  );
}

async function answerKupsMembershipQuestion(question: string): Promise<ChatResult> {
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021-business",
    "Kalau maksudmu bergabung sebagai anggota KUPS yang sudah ada, itu berbeda dari membentuk KUPS baru. Aturan yang tersedia menjelaskan KUPS dibentuk oleh KPS, tetapi tidak merinci syarat penerimaan anggota perorangan. Jadi, tanyakan mekanisme ke KUPS/KPS tujuan atau pendamping/KPH setempat. Kamu sudah tahu nama kelompok atau daerahnya? Kalau maksudmu membentuk KUPS baru, aku bisa jelaskan langkahnya lewat KPS.",
    true,
  );
}

async function answerKupsGroupFormation(question: string): Promise<ChatResult> {
  const asksAboutKps = /\b(?:KPS|kelompok\s+perhutanan\s+sosial|persetujuan\s+perhutanan\s+sosial|belum\s+punya\s+kelompok|kelompok\s+sendiri)\b/i.test(question);
  const asksExplicitKups = /\bKUPS\b|kelompok\s+usaha\s+perhutanan\s+sosial/i.test(question);
  if (!asksAboutKps && !asksExplicitKups) {
    return quickReply("Maksudmu membentuk KUPS dari KPS yang sudah ada, atau membentuk/bergabung dengan kelompok Perhutanan Sosial (KPS) dulu? Jalurnya berbeda. Kalau ceritakan kelompok mana yang sudah ada dan kabupaten/kotanya, aku bantu urutkan langkahnya.");
  }
  const answer = asksAboutKps
    ? "Kalau belum ada kelompok Perhutanan Sosial, itu tahap yang berbeda dari membentuk KUPS. KUPS dibentuk oleh KPS; jadi untuk mulai dari nol, perlu lebih dulu memastikan jalur persetujuan Perhutanan Sosial dan kelembagaan kelompok bersama pendamping/KPH setempat. Aku belum punya syarat lokal yang cukup untuk menjanjikan prosesnya, tapi bisa bantu cari informasi wilayahmu. Kamu di kabupaten/kota mana?"
    : "Kalau yang kamu maksud membentuk KUPS, jalurnya lewat KPS: satu KPS dapat membentuk KUPS sesuai potensi usahanya. Penetapan dilakukan oleh Kepala KPH; jika belum dilakukan dalam 14 hari kerja, penetapan dilakukan oleh Kepala UPT [S1]. Jadi cek dulu apakah kelompokmu sudah menjadi KPS/pemegang persetujuan Perhutanan Sosial. Kamu sudah punya KPS atau masih mencari kelompok di daerahmu?";
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021-business",
    answer,
    true,
  );
}

async function answerWebsiteManagement(question: string): Promise<ChatResult> {
  const config = getChatbotConfig();
  const base = config.catalogUrl ? new URL(config.catalogUrl).origin : "";
  const asksProduct = /\b(?:produk|penawaran|listing)\b/i.test(question);
  const asksProfile = /\b(?:profil|profile|data)\b/i.test(question);
  const links = base
    ? [
        `[dashboard pengelola](${base}/kelola)`,
        `[daftar produk](${base}/kelola/produk)`,
        `[tambah produk](${base}/kelola/produk/baru)`,
      ]
    : [];
  const sourceUrl = base ? new URL("/kelola", base).href : "";
  const source: ChatSource | undefined = sourceUrl
    ? {
        sourceId: "kups-web-management",
        title: "Panel pengelola KUPS-Web",
        url: sourceUrl,
        checkedAt: formatCheckedAt(new Date().toISOString()),
        authority: "KUPS-Web",
      }
    : undefined;
  const productText = asksProduct
    ? `Kalau kamu Admin KUPS, login ke ${links[0] ?? "dashboard KUPS-Web"}, lalu buka ${links[1] ?? "/kelola/produk"} untuk mengelola produk. Penawaran baru dibuat lewat ${links[2] ?? "/kelola/produk/baru"}; situs membatasi satu penawaran utama per KUPS, jadi kalau sudah ada produk/wisata, buka item itu untuk mengeditnya.`
    : "";
  const profileText = asksProfile
    ? "Untuk perubahan profil KUPS, aku belum menemukan halaman edit profil mandiri di panel ini; yang tersedia jelas adalah pengelolaan produk/wisata. Minta bantuan admin/pengelola KUPS-Web untuk perubahan profil."
    : "";
  const answer = [productText, profileText].filter(Boolean).join(" ");
  return {
    answer: answer || "Kalau kamu Admin KUPS, masuk ke dashboard pengelola KUPS-Web untuk melihat penawaran yang bisa dikelola. Kamu ingin mengubah profil, produk, atau destinasi wisatanya?",
    sources: source ? [source] : [],
    catalogItems: [],
    needsClarification: !asksProduct && !asksProfile,
  };
}

function answerPublicOfficerLookup(): ChatResult {
  return {
    answer: "Aku belum punya direktori nama petugas atau pendamping per desa, jadi aku tidak mau menebak orangnya. Sebutkan desa dan kabupaten/kotanya; aku bisa bantu cari kanal atau informasi resmi yang dipublikasikan untuk wilayah itu.",
    sources: [],
    catalogItems: [],
    needsClarification: true,
  };
}

async function answerBusinessDevelopmentFollowup(question: string, history: ChatTurn[]): Promise<ChatResult> {
  const activity = latestBusinessActivity(history, question);
  if (!activity) {
    if (/\bkups\b/i.test(question)) {
      return answerFromApprovedFaq(
        question,
        "permenlhk-9-2021-business",
        "Pengembangan KUPS dimulai dari potensi usaha kelompok: cek dulu KPS/persetujuan Perhutanan Sosialnya, lalu bicarakan rencana usaha dan kebutuhan kelompok dengan pendamping atau KPH. Dukungan dapat terkait produksi, nilai tambah, promosi/pemasaran, dan akses modal, tetapi tidak otomatis dijamin [S1]. Usaha atau komoditas apa yang ingin kamu kembangkan?",
        true,
      );
    }
    return quickReply("Bisa. Usaha atau produk apa yang ingin kamu kembangkan, dan kamu ingin fokus ke produksi, pemasaran, kemasan, atau modal?");
  }
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021-business",
    `Untuk mengembangkan usaha ${activity.label} lewat KUPS, mulainya dengan mengecek apakah usaha itu berada dalam kelompok pemegang persetujuan Perhutanan Sosial/KPS. Kalau iya, bicarakan potensi usaha dan kebutuhan kelompok bersama KPS serta pendamping/KPH. Pengembangan dapat mencakup produksi, nilai tambah, promosi/pemasaran, dan akses modal, tetapi dukungan tertentu tidak otomatis dijamin [S1]. Usaha ${activity.label} ini sekarang dikelola bersama KPS atau masih sendiri?`,
    true,
  );
}

async function answerEligibilityQuestion(original: string, normalized: string): Promise<ChatResult> {
  const source = await getApprovedSource("permenlhk-9-2021");
  if (!source) {
    return { answer: clarificationAnswer(normalized), sources: [], catalogItems: [], needsClarification: true };
  }
  const talkingAboutFriend = /\b(?:teman|temen|kawan|sahabat)\b/i.test(normalized);
  const registrationQuestion = /\b(?:daftar|mendaftar|pendaftaran|registrasi|syarat|persyaratan)\b/i.test(normalized);
  const activity = businessActivity(normalized);
  const subject = talkingAboutFriend ? "temanmu" : "kamu";
  const hasGroupWithoutListing = /\b(?:kelompok\s+usaha|kelompok\s+kami|kelompok\s+saya|kelompok\s+teman|belum\s+(?:punya|memiliki)\s+produk|belum\s+(?:ada|memiliki)\s+produk|belum\s+dipasarkan)\b/i.test(normalized);
  const activityPhrase = activity
    ? "usaha " + activity.label + (talkingAboutFriend ? " milik temanmu" : "-mu")
    : talkingAboutFriend ? "rencana usaha temanmu" : "rencana usaha kelompokmu";
  const answer = hasGroupWithoutListing
    ? "Belum punya produk yang dipasarkan tidak otomatis menutup kemungkinan KUPS: definisi di aturan mencakup kelompok yang akan dan/atau telah melakukan usaha [S1]. KUPS dibentuk oleh KPS, jadi langkah awalnya memastikan kelompok itu terhubung dengan KPS/persetujuan Perhutanan Sosial lalu membahas rencana usahanya bersama pendamping atau KPH. Kelompokmu sudah terhubung dengan KPS?"
    : "Bisa jadi. " + activityPhrase.charAt(0).toUpperCase() + activityPhrase.slice(1) + " bisa dibahas sebagai potensi usaha KUPS; yang perlu dipastikan adalah apakah usaha itu dijalankan atau direncanakan bersama KPS/kelompok Perhutanan Sosial, karena KUPS dibentuk oleh KPS [S1]. " + (registrationQuestion ? "Untuk mulai mengurusnya, bahas rencana usaha dengan KPS lalu minta arahan pendamping atau KPH setempat. " : "") + (subject === "temanmu" ? "Temanmu" : "Kamu") + " sudah terhubung dengan KPS atau masih menjalankan usaha sendiri?";
  return {
    answer,
    sources: [source],
    catalogItems: [],
    needsClarification: true,
  };
}

async function answerKupsBusinessGuide(
  original: string,
  normalized: string,
  kind: "benefits" | "registration",
  history: ChatTurn[] = [],
): Promise<ChatResult> {
  const source = await getApprovedSource("permenlhk-9-2021-business");
  if (!source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const activity = latestBusinessActivity(history, normalized);
  const alsoAsksRegistration = KUPS_REGISTRATION_GUIDE.test(normalized);
  const talkingAboutFriend = /\b(?:teman|temen|kawan|sahabat)\b/i.test(
    [...history, { role: "user" as const, content: normalized }].map((turn) => turn.content).join(" "),
  );
  const userPreviouslySaidRunsOwn = !talkingAboutFriend && history.slice(-4).some((turn) =>
    turn.role === "user" && /\b(?:sendiri|perorangan|individu)\b/i.test(turn.content),
  );

  if (!activity) {
    const subject = talkingAboutFriend ? "temanmu" : "kamu";
    const answer = kind === "benefits"
      ? userPreviouslySaidRunsOwn
        ? `Kalau usahamu masih berjalan sendiri, langkah awalnya mencari KPS/kelompok Perhutanan Sosial di daerahmu untuk membahas apakah usaha itu bisa dikembangkan bersama kelompok. Kamu berada di kabupaten/kota mana?`
        : `KUPS bisa menjadi wadah kelompok untuk mengembangkan usaha Perhutanan Sosial. Dukungan yang dapat difasilitasi antara lain peningkatan produksi dan nilai tambah, promosi/pemasaran, serta akses permodalan, tetapi tidak otomatis menjamin bantuan atau pembeli karena bergantung pada program dan persyaratannya [S1]. Biar aku bisa mengarahkan langkah yang cocok, ${subject} sedang punya atau merencanakan usaha apa?`
      : `Kalau mau membentuk KUPS, langkah awalnya pastikan kelompokmu adalah KPS/pemegang persetujuan Perhutanan Sosial. Lalu bahas potensi dan rencana usaha bersama KPS, kemudian minta arahan pendamping atau KPH untuk pengusulan dan penetapannya. KUPS dibentuk oleh KPS; penetapan oleh Kepala KPH, dan bila belum dilakukan dalam 14 hari kerja penetapan dilakukan Kepala UPT [S1]. Kamu sudah tergabung dengan KPS atau masih mencari kelompok di daerahmu?`;
    const answerWithRegistrationSteps = kind === "benefits" && alsoAsksRegistration
      ? answer + " Untuk membentuk KUPS, mulai dari KPS yang memegang persetujuan Perhutanan Sosial; bahas rencana usaha dengan kelompok dan minta arahan pendamping/KPH setempat [S1]."
      : answer;
    return { answer: answerWithRegistrationSteps, sources: [source], catalogItems: [], needsClarification: true };
  }

  const activityText = activity ? `Untuk usaha ${activity.label}, ` : "";
  const answer = kind === "benefits"
    ? talkingAboutFriend
      ? `Kalau temanmu mengembangkan usaha${activity ? ` ${activity.label}` : ""} lewat KUPS, dukungan yang bisa difasilitasi mencakup peningkatan produksi dan nilai tambah, promosi/pemasaran, serta akses permodalan [S1]. Tapi status KUPS tidak otomatis menjamin dapat uang, alat, pembeli, atau bantuan; itu bergantung pada program dan persyaratannya. Karena KUPS dibentuk oleh KPS, temanmu perlu mengecek apakah usahanya bisa dijalankan bersama kelompok Perhutanan Sosial. Temanmu sudah terhubung dengan KPS atau belum?`
      : `${activity ? `Buat usaha ${activity.label}, ` : ""}KUPS menjadi wadah kelompok untuk mengembangkan usaha Perhutanan Sosial. Dukungan yang bisa difasilitasi mencakup peningkatan produksi dan nilai tambah, promosi/pemasaran, serta akses permodalan [S1]. Tapi menjadi KUPS tidak otomatis menjamin dapat uang, alat, pembeli, atau bantuan; semuanya bergantung pada program dan persyaratan. ${userPreviouslySaidRunsOwn ? `Karena kamu bilang usahamu berjalan sendiri, langkah awalnya mencari KPS di daerahmu untuk membahas apakah usaha ini bisa dikembangkan bersama kelompok. Kamu berada di kabupaten/kota mana?` : `${activityText}Kamu sudah terhubung dengan KPS atau kelompok Perhutanan Sosial?`}`
    : `${activityText}jalurnya lewat kelompok, bukan mendaftar sebagai perorangan. KUPS dibentuk oleh KPS untuk mengembangkan usaha Perhutanan Sosial. Bahas komoditas dan rencana usahanya bersama KPS serta pendamping/KPH di daerahmu; penetapan KUPS dilakukan Kepala KPH. Jika belum ditetapkan dalam 14 hari kerja, penetapan dilakukan Kepala UPT [S1]. ${talkingAboutFriend ? "Temanmu" : "Kamu"} sudah tergabung di KPS atau belum?`;
  const answerWithRegistrationSteps = kind === "benefits" && KUPS_REGISTRATION_GUIDE.test(normalized)
    ? answer + (talkingAboutFriend
      ? " Untuk mulai, temanmu bisa membahas rencana usaha dengan KPS lalu meminta arahan pendamping/KPH setempat."
      : " Untuk mulai, bahas rencana usaha dengan KPS lalu minta arahan pendamping/KPH setempat.")
    : answer;
  return { answer: answerWithRegistrationSteps, sources: [source], catalogItems: [], needsClarification: true };
}

async function answerWithGroundedGuide(
  original: string,
  normalized: string,
  sourceId: "permenlhk-9-2021" | "permenlhk-9-2021-business",
  fallbackAnswer: string,
): Promise<ChatResult> {
  const source = await getApprovedSource(sourceId);
  if (!source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  return {
    answer: `${fallbackAnswer} [S1]`,
    sources: [source],
    catalogItems: [],
    needsClarification: true,
  };
}

async function answerFromApprovedFaq(
  normalized: string,
  sourceId: "permenlhk-9-2021" | "permenlhk-9-2021-business" | "permenhut-18-2025" | "gokups-home",
  answer: string,
  needsClarification = false,
  fallbackQuestion = normalized,
): Promise<ChatResult> {
  const source = await getApprovedSource(sourceId);
  if (!source) {
    return { answer: clarificationAnswer(fallbackQuestion), sources: [], catalogItems: [], needsClarification: true };
  }
  return { answer, sources: [source], catalogItems: [], needsClarification };
}

function formatCheckedAt(value: string): string {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

function websiteSource(retrievedAt: string): ChatSource | undefined {
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

function sourcesFromPublicItems(items: PublicCatalogItem[], retrievedAt: string): ChatSource[] {
  const checkedAt = formatCheckedAt(retrievedAt);
  return items.map((item) => ({
    sourceId: `kups-web-${item.type}-${item.recordId}`,
    title: item.title,
    url: item.sourceUrl,
    checkedAt,
    authority: "KUPS-Web",
  }));
}

async function answerFromPublicResults(
  question: string,
  intent: CatalogIntent,
  items: PublicCatalogItem[],
  retrievedAt: string,
  stats?: { kups: number; products: number; destinations: number; provinces: number },
): Promise<string> {
  return publicDataAnswer(intent, items, retrievedAt, stats, question);
}

function publicDataAnswer(
  intent: CatalogIntent,
  items: PublicCatalogItem[],
  retrievedAt: string,
  stats?: { kups: number; products: number; destinations: number; provinces: number },
  question = "",
): string {
  const checkedAt = formatCheckedAt(retrievedAt);
  if (intent.type === "stats" && stats) {
    const activeQualifier = /\baktif\b/i.test(question)
      ? " Statistik yang bisa kubaca adalah jumlah profil publik; endpoint ini tidak memisahkan status aktif."
      : "";
    return `Di data publik KUPS-Web saat ini tercatat ${stats.kups} profil KUPS, ${stats.products} produk, dan ${stats.destinations} destinasi wisata yang tersebar di ${stats.provinces} provinsi.${activeQualifier} Angka ini bisa berubah saat data situs diperbarui; data diperiksa ${checkedAt} WIB.`;
  }
  if (intent.type === "stats") {
    return "Aku belum bisa membaca statistik publik KUPS-Web saat ini. Kamu tetap bisa mencari profil KUPS atau listing tertentu, atau coba tanya statistiknya lagi sebentar.";
  }
  if (COUNT_QUESTION.test(question) && items.length > 0) {
    const label = intent.type === "kups" ? "profil KUPS" : intent.type === "product" ? "produk" : intent.type === "tourism" ? "destinasi wisata" : "hasil publik";
    const limitNote = items.length >= 10
      ? "Pencarian ini dibatasi maksimal 10 hasil, jadi ini bukan jumlah total."
      : "Ini jumlah hasil yang cocok di katalog publik, bukan statistik resmi untuk seluruh wilayah.";
    return `Aku menemukan ${items.length} ${label}${intent.query ? ` untuk “${intent.query}”` : ""}. ${limitNote} Data diperiksa ${checkedAt} WIB.`;
  }
  if (items.length === 0) {
    const target = intent.query ? ` untuk “${intent.query}”` : "";
    const scope = intent.type === "kups" ? "profil KUPS" : intent.type === "publication" ? "publikasi" : intent.type === "tourism" ? "destinasi wisata" : "listing produk";
    if (COUNT_QUESTION.test(question)) {
      return `Aku belum menemukan ${scope} publik yang cocok${target}, jadi belum bisa menyebut jumlahnya. Ini bukan bukti bahwa datanya tidak ada; kalau kamu sebutkan daerah atau kata kunci lain, aku bisa coba cari lagi. Data diperiksa ${checkedAt} WIB.`;
    }
    return `Aku belum menemukan ${scope}${target} yang tampil di KUPS-Web saat ini. Itu hanya berarti belum ada hasil publik yang cocok dengan kata kunci ini; bukan berarti usahanya tidak ada. Coba sebutkan nama lain atau daerahnya, nanti aku carikan lagi.`;
  }
  if (intent.type === "kups") {
    const resultDetails = items.map((item) => {
      const location = item.location ? `di ${item.location}` : "lokasinya belum dicantumkan";
      const category = item.category ? ` · kategori direktori: ${item.category}` : "";
      return `**${item.title}** — ${location}${category}`;
    }).join("; ");
    const resultCount = !intent.query && items.length === 10
      ? "hingga 10 profil pertama"
      : items.length === 1 ? "satu profil" : `${items.length} profil`;
    const queryText = intent.query ? ` dengan kata kunci “${intent.query}”` : "";
    const nextStep = !intent.query && items.length === 10
      ? "Aku tampilkan maksimal 10 hasil per pencarian; sebutkan daerah atau komoditas kalau mau disaring."
      : "Buka kartu di bawah untuk mengecek deskripsi dan penawaran lebih rinci.";
    if (COUNT_QUESTION.test(question)) {
      const limitNote = items.length >= 10
        ? "Hasil pencarian dibatasi maksimal 10, jadi angka ini bukan jumlah total wilayah."
        : "Ini jumlah profil yang cocok di katalog publik, bukan angka statistik resmi untuk seluruh wilayah.";
      return `Aku menemukan ${items.length} profil KUPS publik${queryText}: ${resultDetails}. ${limitNote} Data diperiksa ${checkedAt} WIB.`;
    }
    return `Di direktori publik KUPS-Web, aku menemukan ${resultCount}${queryText}: ${resultDetails}. ${nextStep} Kategori direktori yang tampil belum tentu menyebut komoditas spesifik. Data diperiksa ${checkedAt} WIB.`;
  }
  const labels: Record<PublicCatalogItem["type"], string> = {
    product: "produk",
    tourism: "destinasi wisata",
    kups: "profil KUPS",
    publication: "publikasi",
  };
  const label = labels[items[0].type];
  const queryText = intent.query ? ` untuk kata kunci “${intent.query}”` : "";
  const nextStep: Record<CatalogIntent["type"], string> = {
    product: "Kartu di bawah menunjukkan nama produk, kelompok, dan wilayahnya. Mau aku bantu saring berdasarkan daerah atau jenis produk lain?",
    tourism: "Kartu di bawah memuat ringkasan destinasi dan kelompok pengelolanya. Mau cari berdasarkan daerah tertentu?",
    both: "Kartu di bawah berisi produk dan destinasi yang tersedia. Mau aku saring berdasarkan daerah atau salah satu jenis saja?",
    kups: "Buka kartu untuk melihat profil publik, wilayah, penawaran, dan kanal kontak jika KUPS menyediakannya. Mau cari KUPS di daerah tertentu?",
    publication: "Buka kartu untuk membaca atau mengunduh materi yang tersedia. Mau cari topik publikasi tertentu?",
    stats: "",
  };
  const resultDetails = items.map((item) => {
    const owner = item.kupsName ? ` dari ${item.kupsName}` : "";
    const category = item.category ? ` · ${item.category}` : "";
    const unit = item.unit ? ` · satuan ${item.unit}` : "";
    const demo = /demo|contoh|demonstrasi/i.test(`${item.title} ${item.description}`) ? " · data demonstrasi" : "";
    return `**${item.title}**${owner}${category}${unit}${demo}`;
  }).join("; ");
  if (intent.type === "product") {
    const productCount = items.length === 1 ? "satu produk" : `${items.length} produk`;
    if (PRODUCT_PURCHASE_QUESTION.test(question)) {
      const isDemo = items.some((item) => /demo|contoh|demonstrasi/i.test(`${item.title} ${item.description}`));
      const purchaseNote = isDemo
        ? "Hasil ini ditandai sebagai data demonstrasi, jadi belum tentu benar-benar tersedia untuk dibeli. Buka kartu detail untuk melihat informasi publik yang dicantumkan."
        : "Untuk memesan, buka kartu detail dan cek petunjuk pemesanan atau kontak publik yang dicantumkan KUPS. Chatbot ini hanya menampilkan katalog, bukan memproses transaksi.";
      return `Aku menemukan ${productCount}${queryText}: ${resultDetails}. ${purchaseNote} Data diperiksa ${checkedAt} WIB.`;
    }
    return `Di katalog publik KUPS-Web, aku menemukan ${productCount}${queryText}: ${resultDetails}. Mau aku bukakan detailnya? Data diperiksa ${checkedAt} WIB.`;
  }
  return `Yang aku temukan ${items.length} hasil ${label}${queryText}: ${resultDetails}. ${nextStep[intent.type]} Data diperiksa ${checkedAt} WIB.`;
}

async function answerWithCatalogAttachment(
  question: string,
  intent: CatalogIntent,
  guidance: Promise<ChatResult>,
): Promise<ChatResult> {
  const result = await guidance;
  try {
    const catalog = await searchPublicCatalog(intent);
    const followup = catalog.items.length
      ? "Sekalian aku cek katalog publik KUPS-Web. Yang cocok: " + catalog.items.map((item) => item.kupsName ? item.title + " dari " + item.kupsName : item.title).join("; ") + ". Detailnya ada di kartu di bawah."
      : "Sekalian aku cek katalog publik untuk “" + (intent.query || question) + "”, tetapi belum menemukan listing yang cocok. Itu hanya hasil pencarian saat ini, bukan bukti usahanya tidak ada.";
    const listSources = catalog.items.length
      ? sourcesFromPublicItems(catalog.items, catalog.retrievedAt)
      : [websiteSource(catalog.retrievedAt)].filter((source): source is ChatSource => Boolean(source));
    const sources = [...new Map([...result.sources, ...listSources].map((source) => [source.sourceId, source])).values()];
    return { ...result, answer: result.answer + "\n\n" + followup, sources, catalogItems: catalog.items };
  } catch {
    return {
      ...result,
      answer: result.answer + "\n\nPencarian katalog publik sedang tidak tersedia, jadi aku belum bisa memastikan ada listing yang cocok.",
    };
  }
}

function businessActivity(question: string): { label: string; type: "product" | "tourism" } | undefined {
  const match = question.match(/\b(madu|kopi|duren|durian|bambu|rotan|kerajinan|wisata|ekowisata|homestay)\b/i)?.[0];
  if (!match) return undefined;
  const isTourism = /^(wisata|ekowisata|homestay)$/i.test(match);
  return { label: match, type: isTourism ? "tourism" : "product" };
}

function latestBusinessActivity(history: ChatTurn[], currentQuestion = ""): { label: string; type: "product" | "tourism" } | undefined {
  const userTurns = [
    ...history.filter((turn) => turn.role === "user"),
    ...(currentQuestion ? [{ role: "user" as const, content: currentQuestion }] : []),
  ];
  for (const turn of userTurns.reverse()) {
    const isBusinessContext = PERSONAL_KUPS_ELIGIBILITY.test(turn.content) ||
      KUPS_BENEFIT_QUESTION.test(turn.content) ||
      KUPS_REGISTRATION_GUIDE.test(turn.content) ||
      BUSINESS_PLANNING.test(turn.content);
    if (detectCatalogIntent(turn.content) && !isBusinessContext) continue;
    const activity = businessActivity(turn.content);
    if (activity) return activity;
  }
  return undefined;
}

type ExpertNeed = { specialty: ExpertHandoff["specialty"]; label: string };

function expertNeed(question: string): ExpertNeed | undefined {
  const rules: ReadonlyArray<[RegExp, ExpertNeed["specialty"], string]> = [
    [/\b(?:buyer|pembeli|akses\s+pasar|pasar|pemasaran|promosi|penjualan|jualan|distribusi)\b/i, "pemasaran", "pemasaran dan akses buyer"],
    [/\b(?:branding|merek|label|desain|kemasan)\b/i, "branding", "branding dan kemasan"],
    [/\b(?:mutu|kualitas|produksi|pengolahan|olah|standar\s+produk|panen)\b/i, "produksi_mutu", "produksi dan mutu"],
    [/\b(?:modal|pembiayaan|pendanaan|pinjaman|investasi)\b/i, "pembiayaan", "pembiayaan dan modal"],
    [/\b(?:pembukuan|arus\s+kas|akuntansi|keuangan)\b/i, "keuangan", "pengelolaan keuangan"],
    [/\b(?:izin|legalitas|sertifikasi|sertifikat|halal|bpom|hak\s+merek)\b/i, "legalitas", "legalitas dan sertifikasi"],
    [/\b(?:toko\s+online|digitalisasi|teknologi|pencatatan\s+digital)\b/i, "digitalisasi", "pemanfaatan teknologi digital"],
    [/\b(?:karyawan|tenaga\s+kerja|sdm|sumber\s+daya\s+manusia)\b/i, "sdm", "pengelolaan SDM"],
    [/\b(?:iklim|cuaca|kekeringan|perubahan\s+iklim)\b/i, "iklim", "adaptasi iklim"],
    [/\b(?:kups|kps|kelompok|kelembagaan|daftar|bergabung|gabung|pendamping)\b/i, "kelembagaan", "penguatan kelompok dan jalur KUPS"],
  ];
  for (const [pattern, specialty, label] of rules) {
    if (pattern.test(question)) return { specialty, label };
  }
  return undefined;
}

type KpsConnection = "connected" | "not_connected";

function kpsConnection(question: string): KpsConnection | undefined {
  const compact = question.trim();
  // A question about where/how to join is not evidence that the user is
  // already a KPS member. Only use declarative replies to fill this slot.
  if (/[?]\s*$/.test(compact) || /\b(?:mau|ingin|pengen|cara|gimana|bagaimana|harus|kemana|ke\s+mana|syarat)\b/i.test(compact)) {
    return undefined;
  }
  const shortReply = compact.split(/\s+/).filter(Boolean).length <= 3;
  if (/\b(?:sendiri|perorangan|individu|belum\s+(?:tergabung|terhubung|bergabung|punya\s+(?:kelompok|KPS)|ada\s+(?:kelompok|KPS))|tidak\s+(?:tergabung|terhubung|punya\s+(?:kelompok|KPS)))\b/i.test(compact) ||
    (shortReply && /\b(?:belum|belom|enggak|nggak|gak|tidak|bukan)\b/i.test(compact))) {
    return "not_connected";
  }
  if (/\b(?:tergabung|terhubung|bergabung|gabung|anggota\s+KPS|bersama\s+kelompok|punya\s+(?:kelompok\s+)?KPS|(?:sudah\s+)?ada\s+(?:kelompok\s+)?KPS|KPS\s+(?:saya|kami|kelompok))\b/i.test(compact) ||
    (shortReply && /\b(?:sudah|udah|iya|ya|betul|benar)\b/i.test(compact))) {
    return "connected";
  }
  return undefined;
}

function lastAssistantMessage(history: ChatTurn[]): string {
  return [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
}

function isWaitingForKpsStatus(history: ChatTurn[]): boolean {
  if (isWaitingForSupportNeed(history)) return false;
  const assistant = lastAssistantMessage(history);
  const isKupsGuidance = history.some((turn) => turn.role === "user" && (
    KUPS_BENEFIT_QUESTION.test(turn.content) ||
    KUPS_REGISTRATION_GUIDE.test(turn.content) ||
    PERSONAL_KUPS_ELIGIBILITY.test(turn.content) ||
    BUSINESS_PLANNING.test(turn.content)
  ));
  return isKupsGuidance && /\bKPS\b|Kelompok Perhutanan Sosial/i.test(assistant) &&
    /\?/.test(assistant) &&
    /(?:tergabung|terhubung|dikelola|kelompok|sudah|belum)/i.test(assistant);
}

function isRegistrationRequirementsFollowup(question: string, history: ChatTurn[]): boolean {
  if (!REGISTRATION_REQUIREMENTS_FOLLOWUP.test(question)) return false;
  const priorUserTurns = history.filter((turn) => turn.role === "user").slice(-6);
  const hasRegistrationContext = priorUserTurns.some((turn) =>
    KUPS_REGISTRATION_GUIDE.test(turn.content) || KUPS_MEMBER_JOIN_GUIDE.test(turn.content) ||
    PERSONAL_KUPS_ELIGIBILITY.test(turn.content),
  );
  const assistantAskedAboutThePath = /\b(?:KUPS|KPS|kelompok\s+perhutanan\s+sosial)\b/i.test(lastAssistantMessage(history));
  return hasRegistrationContext && assistantAskedAboutThePath;
}

async function answerRegistrationRequirementsFollowup(question: string, history: ChatTurn[]): Promise<ChatResult> {
  const activity = latestBusinessActivity(history, question);
  const userText = history.filter((turn) => turn.role === "user").map((turn) => turn.content).join(" ");
  const subject = /\b(?:teman|temen|kawan|sahabat)\b/i.test(userText) ? "temanmu" : "kamu";
  const activityText = activity ? ` untuk usaha ${activity.label}` : "";
  return answerFromApprovedFaq(
    [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), question].join(" "),
    "permenlhk-9-2021-business",
    `Wajar kalau mau tahu dulu. Yang bisa dipastikan${activityText}: KUPS dibentuk melalui KPS; rencana usaha dibahas bersama kelompok, lalu proses penetapan diarahkan melalui KPH atau pendamping Perhutanan Sosial [S1]. Sumber yang tersedia tidak merinci daftar berkas atau syarat keanggotaan tiap kelompok, jadi aku belum bisa memastikan prosesnya mudah atau rumit. ${subject === "temanmu" ? "Temanmu" : "Kamu"} sudah punya KPS tujuan, atau masih mencari kelompok di daerah?`,
    true,
    question,
  );
}

function isWaitingForBusinessActivity(history: ChatTurn[]): boolean {
  const assistant = lastAssistantMessage(history);
  const previousQuestion = previousUserQuestion(history);
  const askedForBusiness = /(?:jenis|bentuk|komoditas)\s+usaha\s+apa|usaha\s+apa(?:\s+yang)?/i.test(assistant);
  const askedKupsGuidance = KUPS_BENEFIT_QUESTION.test(previousQuestion) ||
    KUPS_REGISTRATION_GUIDE.test(previousQuestion);
  return askedForBusiness && askedKupsGuidance && /\?/.test(assistant);
}

function isWaitingForSupportNeed(history: ChatTurn[]): boolean {
  return /(?:kebutuhan|bantuan)\s+(?:utama|paling\s+dibutuhkan)|bagian\s+yang\s+paling\s+(?:mendesak|dibutuhkan)/i.test(
    lastAssistantMessage(history),
  );
}

function isWaitingForConsultationFollowup(history: ChatTurn[]): boolean {
  const assistant = lastAssistantMessage(history);
  return /(?:konsultasi.{0,70}(?:soal|tentang)|kebutuhan.{0,35}(?:utama|paling)|expert.{0,15}yang.{0,15}(?:pas|cocok))/i.test(assistant) && /\?/.test(assistant);
}

function buildExpertHandoff(
  question: string,
  history: ChatTurn[],
  need: ExpertNeed,
): ExpertHandoff | null {
  const userText = [...history, { role: "user" as const, content: question }]
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join(" ");
  const activity = latestBusinessActivity(history, question);
  if (!activity) return null;

  const friend = /\b(?:teman|temen|kawan|sahabat)\b/i.test(userText);
  const connection = [...history, { role: "user" as const, content: question }]
    .filter((turn) => turn.role === "user")
    .map((turn) => kpsConnection(turn.content))
    .reverse()
    .find((value): value is KpsConnection => Boolean(value));
  const subject = friend ? "Usaha teman" : "Usaha";
  const connectionSummary = connection
    ? connection === "connected"
      ? "sudah terhubung dengan KPS"
      : "belum terhubung dengan KPS"
    : "status KPS perlu dikonfirmasi";

  return {
    specialty: need.specialty,
    reason: friend
      ? `Dari cerita tentang usaha temanmu, kebutuhan ${need.label} paling relevan dibahas bersama expert bidang ini.`
      : `Dari ceritamu, kebutuhan ${need.label} paling relevan dibahas bersama expert bidang ini.`,
    summary: `${subject}: ${activity.label}. Status kelompok: ${connectionSummary}. Kebutuhan utama: ${need.label}.`,
  };
}

async function answerBusinessGuideFollowup(
  question: string,
  history: ChatTurn[],
): Promise<ChatResult | undefined> {
  const retrievalQuestion = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), question].join(" ");
  if (isWaitingForBusinessActivity(history) && businessActivity(question) && !detectCatalogIntent(question)) {
    const activity = businessActivity(question)!;
    const historyText = history.map((turn) => turn.content).join(" ");
    const friend = /\b(?:teman|temen|kawan|sahabat)\b/i.test(historyText);
    const subject = friend ? "temanmu" : "kamu";
    return answerFromApprovedFaq(
      retrievalQuestion,
      "permenlhk-9-2021-business",
      `Oke, berarti ${subject} sedang membahas usaha ${activity.label}. KUPS dibentuk oleh KPS, jadi langkah awalnya memastikan usaha itu terhubung dengan kelompok Perhutanan Sosial [S1]. Usaha ${activity.label} ini sudah dijalankan bersama KPS atau masih dikelola sendiri?`,
      true,
      question,
    );
  }

  if (
    KUPS_DEFINITION_QUESTION.test(question) ||
    KPS_PS_DIFFERENCE.test(question) ||
    KUPS_CLASS_QUESTION.test(question) ||
    Boolean(detectCatalogIntent(question))
  ) {
    return undefined;
  }

  const userHistory = history.filter((turn) => turn.role === "user");
  const combinedUserText = [...userHistory.map((turn) => turn.content), question].join(" ");
  const activity = latestBusinessActivity(history, question);
  const subject = /\b(?:teman|temen|kawan|sahabat)\b/i.test(combinedUserText) ? "temanmu" : "usahamu";

  if (isWaitingForConsultationFollowup(history)) {
    const need = expertNeed(question) ?? expertNeed(userHistory.map((turn) => turn.content).join(" "));
    if (!need) {
      return {
        answer: `Paham, kita bahas ${subject} dulu. Biar aku bisa mengarahkan ke expert yang cocok, ceritakan jenis usaha dan kabupaten/kotanya, serta bagian yang paling ingin dibantu—kelembagaan, produksi/mutu, legalitas, kemasan, pemasaran, atau pembiayaan?`,
        sources: [],
        catalogItems: [],
        needsClarification: true,
      };
    }
    if (!activity) {
      return {
        answer: `Oke, berarti kamu ingin membahas ${need.label}. Jenis usaha temanmu atau usahamu apa, dan berada di kabupaten/kota mana? Setelah tahu konteksnya aku bisa siapkan rekomendasi expert yang lebih pas.`,
        sources: [],
        catalogItems: [],
        needsClarification: true,
      };
    }
    const handoff = buildExpertHandoff(question, history, need);
    if (handoff) {
      return {
        answer: `Oke, untuk usaha ${activity.label} dan kebutuhan ${need.label}, expert bidang ini paling relevan. Ringkasan ceritamu akan dibawa ke konsultasi supaya kamu tidak perlu mengulang dari awal.`,
        sources: [],
        catalogItems: [],
        needsClarification: false,
        handoff,
      };
    }
  }

  if (!activity) return undefined;

  if (/\b(?:expert|ahli|konsultasi|konsul)\b/i.test(question)) {
    const need = expertNeed(question) ?? expertNeed(userHistory.map((turn) => turn.content).join(" "));
    const handoff = need ? buildExpertHandoff(question, history, need) : null;
    if (need && handoff) {
      return {
        answer: `Untuk kebutuhan ${need.label}, aku merekomendasikan expert bidang ${need.label}. Pilih tombol di bawah untuk melihat expert dan jadwal yang tersedia.`,
        sources: [],
        catalogItems: [],
        needsClarification: false,
        handoff,
      };
    }
  }

  if (isWaitingForKpsStatus(history)) {
    if (/\b(?:mau|ingin|pengen)\s+(?:gabung|bergabung|ikut(?:an)?)\b/i.test(question) &&
      /\b(?:kemana|ke\s+mana|harus|caranya|cara|hubungi|kontak)\b/i.test(question)) {
      return answerKpsGroupJoin(question);
    }
    const connection = kpsConnection(question);
    if (!connection) {
      const statesBusinessExists = /\b(?:memiliki|punya|sudah|udah|menjalankan|jalanin|berjalan|penjual|pedagang|jualan|produsen|berdagang)\b/i.test(question);
      const acknowledgement = statesBusinessExists
        ? `Oh, berarti ${subject === "temanmu" ? `usaha ${activity.label} temanmu` : `usaha ${activity.label}-mu`} memang sudah berjalan. `
        : "";
      const actor = subject === "temanmu" ? "temanmu" : "kamu";
      return {
        answer: `${acknowledgement}Biar aku bisa mengarahkan langkah KUPS dengan tepat, usaha ini dijalankan ${actor} bersama kelompok Perhutanan Sosial/KPS atau masih sendiri?`,
        sources: [],
        catalogItems: [],
        needsClarification: true,
      };
    }

    const need = expertNeed(question) ?? expertNeed(userHistory.map((turn) => turn.content).join(" "));
    if (need) {
      const handoff = buildExpertHandoff(question, history, need);
      if (handoff) {
        const connectionText = connection === "connected"
          ? `Oke, berarti ${subject} sudah terhubung dengan KPS.`
          : `Oke, berarti ${subject} belum terhubung dengan KPS. Langkah awalnya mencari KPS atau pendamping Perhutanan Sosial di daerahnya.`;
        const grounded = await answerFromApprovedFaq(
          retrievalQuestion,
          "permenlhk-9-2021-business",
          `${connectionText} Untuk kebutuhan ${need.label}, aku merekomendasikan expert bidang ${need.label}. Kalau kamu mau, pilih expert dan jadwal yang tersedia; ringkasan ceritamu akan disiapkan agar kamu tidak perlu mengulang dari awal.`,
          false,
          question,
        );
        return { ...grounded, handoff };
      }
    }

    const nextQuestion = `${connection === "connected" ? "Sip, berarti sudah ada kelompok KPS yang terlibat." : `Paham, berarti langkah awalnya mencari KPS atau pendamping Perhutanan Sosial di daerah ${subject === "temanmu" ? "temanmu" : "usahamu"}.`} Biar aku bisa arahkan ke expert yang pas, kebutuhan paling utama sekarang apa: kelembagaan/KPS, produksi dan mutu, branding/kemasan, pemasaran, atau pembiayaan?`;
    return answerFromApprovedFaq(retrievalQuestion, "permenlhk-9-2021-business", nextQuestion, true, question);
  }

  if (isWaitingForSupportNeed(history)) {
    const need = expertNeed(question);
    if (!need) {
      return {
        answer: "Boleh pilih satu yang paling mendesak: kelembagaan/KPS, produksi dan mutu, branding/kemasan, pemasaran, atau pembiayaan?",
        sources: [],
        catalogItems: [],
        needsClarification: true,
      };
    }
    const handoff = buildExpertHandoff(question, history, need);
    if (!handoff) return undefined;
    return {
      answer: `Oke, dari ceritamu, kebutuhan yang paling pas dibahas dulu adalah ${need.label}. Aku bisa bantu mengarahkanmu ke expert bidang itu. Kalau kamu lanjut, ringkasan ceritamu akan disiapkan untuk konsultasi supaya kamu tidak perlu mengulang semuanya.`,
      sources: [],
      catalogItems: [],
      needsClarification: false,
      handoff,
    };
  }

  if (/\b(?:expert|ahli|konsultasi)\b/i.test(question)) {
    const need = expertNeed(question) ?? expertNeed(userHistory.map((turn) => turn.content).join(" "));
    if (!need) return undefined;
    const handoff = buildExpertHandoff(question, history, need);
    if (!handoff) return undefined;
    return {
      answer: `Untuk kebutuhan ${need.label}, aku merekomendasikan expert bidang ${need.label}. Pilih tombol di bawah untuk melihat expert dan jadwal yang tersedia.`,
      sources: [],
      catalogItems: [],
      needsClarification: false,
      handoff,
    };
  }

  return undefined;
}

async function answerBusinessPlanningQuestion(question: string): Promise<ChatResult> {
  const activity = businessActivity(question);
  const alreadyHasBusiness = /\b(?:sudah|udah|punya|memiliki|ada|menjalankan|jalanin)\b.{0,35}\b(?:usaha|bisnis|jualan|produksi)\b/i.test(question) ||
    /\b(?:usaha|bisnis)\b.{0,35}\b(?:sudah|udah|berjalan|jalan)\b/i.test(question);
  const asksWhereToStart = /\b(?:mulai|langkah|awal|dari\s+mana|memulai)\b/i.test(question);
  if (activity && alreadyHasBusiness) {
    const guide = asksWhereToStart
      ? `Sip, usaha ${activity.label}-mu sudah ada. Kalau kamu ingin mengembangkannya lewat KUPS, langkah awalnya cek apakah usaha itu bisa dijalankan bersama KPS/kelompok pemegang persetujuan Perhutanan Sosial, karena KUPS dibentuk oleh KPS. Kalau belum terhubung, cari KPS dan pendamping Perhutanan Sosial di daerahmu; kalau sudah, bawa rencana usaha ${activity.label}-mu untuk dibahas bersama kelompok dan KPH. Usahamu sudah terhubung dengan KPS atau belum?`
      : `Oke, berarti usaha ${activity.label}-mu memang sudah berjalan. Kalau ingin mengembangkannya lewat KUPS, langkah awalnya memastikan usaha itu terhubung dengan KPS/kelompok Perhutanan Sosial, karena KUPS dibentuk oleh KPS. Usahamu sudah dijalankan bersama KPS atau masih sendiri?`;
    return answerWithGroundedGuide(
      question,
      question,
      "permenlhk-9-2021",
      guide,
    );
  }
  let items: PublicCatalogItem[] = [];
  let catalogWasChecked = false;
  if (activity) {
    try {
      const result = await searchPublicCatalog({ type: activity.type, query: activity.label });
      items = result.items;
      catalogWasChecked = true;
    } catch {
      // The conversational guidance still works if the live public catalogue is unavailable.
    }
  }
  const answer = activity
    ? items.length > 0
      ? `Siap, kita bahas rencana ${activity.label} pelan-pelan. Aku menemukan ${items.length} contoh listing publik di KUPS-Web; kartu di bawah bisa jadi gambaran contoh yang sudah tampil, bukan penilaian kelayakan usahamu. Biar arah bantuannya pas, usaha ini akan dikelola kelompok Perhutanan Sosial/KPS atau masih rencana pribadi?`
      : catalogWasChecked
        ? `Siap, kita bahas rencana ${activity.label} pelan-pelan. Aku belum menemukan listing ${activity.label} yang cocok di data publik KUPS-Web saat ini, tapi itu tidak menentukan apakah rencanamu bisa dijalankan. Biar arah bantuannya pas, usaha ini akan dikelola kelompok Perhutanan Sosial/KPS atau masih rencana pribadi?`
        : `Siap, kita bahas rencana ${activity.label} pelan-pelan. Aku belum bisa mengecek katalog KUPS-Web saat ini, tapi kita tetap bisa mulai dari situasimu. Usaha ini akan dikelola kelompok Perhutanan Sosial/KPS atau masih rencana pribadi?`
    : "Bisa, kita urai dari kebutuhanmu dulu. Kamu sudah punya jenis usaha yang ingin dijalankan, atau masih mencari ide? Sebutkan juga daerahnya kalau sudah tahu; setelah itu aku bisa cek profil, contoh produk/wisata, dan panduan publik yang paling nyambung.";
  return { answer, sources: [], catalogItems: items, needsClarification: true };
}

async function answerSupportNeed(question: string): Promise<ChatResult> {
  const activity = businessActivity(question);
  let items: PublicCatalogItem[] = [];
  let catalogWasChecked = false;
  if (activity) {
    try {
      const result = await searchPublicCatalog({ type: activity.type, query: activity.label });
      items = result.items;
      catalogWasChecked = true;
    } catch {
      // Offer a useful clarification even when the live public site cannot be reached.
    }
  }

  const isFunding = /\b(?:modal|pendanaan|bantuan\s+dana|hibah)\b/i.test(question);
  const isMarket = /\b(?:akses\s+pasar|pasar|pemasaran|promosi|jualan|jual)\b/i.test(question);
  const isGeneralHelp = /\b(?:bisa|dapat)\s+bantu(?:in)?\b.{0,35}\b(?:usaha|bisnis)\b|\b(?:bantu|membantu)\s+(?:usaha|bisnis)\s+(?:saya|aku|kami)\b/i.test(question);
  const answer = isFunding
    ? "Aku bisa bantu mencari informasi yang tersedia, tapi belum punya data program bantuan atau kepastian pendanaannya. Kamu sedang mencari program tertentu? Sebutkan nama program atau daerahnya agar aku bisa arahkan ke sumber yang tepat."
    : isMarket && activity && items.length > 0
      ? `Paham, kamu sedang butuh bantuan soal pemasaran ${activity.label}. Aku menemukan beberapa contoh listing publik yang sudah tampil di KUPS-Web; kartu di bawah bisa membantu melihat cara produk sejenis dipresentasikan. Produkmu sudah siap dipasarkan atau masih tahap rencana?`
      : isMarket && activity && catalogWasChecked
        ? `Paham, kamu sedang butuh bantuan soal pemasaran ${activity.label}. Aku belum menemukan listing publik yang cocok di KUPS-Web; itu bukan berarti usahanya tidak ada. Produkmu sudah siap dipasarkan atau masih tahap rencana?`
        : isMarket
          ? "Paham, akses pasar bisa jadi tantangan. Aku bisa bantu cek contoh listing publik dan informasi yang tersedia, lalu petakan pertanyaan berikutnya. Produk atau jasa apa yang ingin kamu pasarkan, dan di daerah mana?"
          : isGeneralHelp
            ? "Bisa, kita petakan dulu kebutuhannya biar bantuannya tepat. Aku bisa bantu soal jalur KUPS, produksi/mutu, kemasan, pemasaran, atau mencari informasi pendanaan yang tersedia. Usahamu bergerak di bidang apa, dan kendala yang paling ingin dibereskan sekarang apa?"
            : "Aku bantu urai satu per satu. Bagian yang paling mendesak buatmu apa—pemasaran, produksi/kemasan, pendanaan, atau memastikan informasi KUPS? Ceritakan jenis usaha atau kelompoknya, nanti aku cari data publik yang paling nyambung.";
  return { answer, sources: [], catalogItems: items, needsClarification: true };
}

function isCatalogChoiceReply(question: string, history: ChatTurn[]): boolean {
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const priorItem = previousUserQuestion(history).trim();
  return /\b(?:katalog|produk|lihat|cari)\b/i.test(question) &&
    isAmbiguousSingleItem(priorItem) &&
    /\b(?:katalog|produk|rencana\s+usaha|bisnis)\b/i.test(lastAssistant);
}

function contextualCatalogIntent(question: string, history: ChatTurn[]): CatalogIntent | undefined {
  const compact = question.trim().toLocaleLowerCase();
  const topic = compact.match(/^(?:(?:kalau|kalo|terus|trus|dan|untuk)\s+)?(produk|produk-produk|wisata|destinasi|publikasi)(?:\s+(?:itu|nya|tuh|aja|saja|apa))?[?!.,\s]*$/)?.[1];
  if (!topic) return undefined;
  const previousQuestion = previousUserQuestion(history);
  const previousIntent = detectCatalogIntent(previousQuestion);
  const lastAssistant = lastAssistantMessage(history);
  const hasRecentCatalogContext = Boolean(previousIntent) ||
    /(?:di\s+(?:direktori|katalog)\s+publik|hasil\s+destinasi\s+wisata|kartu\s+di\s+bawah\s+(?:memuat|menunjukkan)|data\s+publik\s+KUPS-Web)/i.test(lastAssistant);
  if (!hasRecentCatalogContext) return undefined;
  const type: CatalogIntent["type"] = /publikasi/.test(topic) ? "publication" : /wisata|destinasi/.test(topic) ? "tourism" : "product";
  return { type, query: "" };
}

function isBareCatalogTopic(question: string): boolean {
  return /^(?:(?:kalau|kalo|terus|trus|dan|untuk)\s+)?(?:produk|produk-produk|wisata|destinasi|publikasi)(?:\s+(?:itu|nya|tuh|aja|saja|apa))?[?!.,\s]*$/i.test(question.trim());
}

function isBusinessChoiceReply(question: string, history: ChatTurn[]): boolean {
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  return isAmbiguousSingleItem(previousUserQuestion(history)) &&
    /\b(?:merencanakan\s+usaha|rencana\s+usaha|bisnis)\b/i.test(lastAssistant) &&
    /\b(?:usaha|bisnis|merintis|pribadi|mulai|rencana)\b/i.test(question);
}

function isKupsLookupReply(question: string, history: ChatTurn[]): boolean {
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  return /\b(?:nama\s+KUPS|kabupaten|provinsinya)\b/i.test(lastAssistant) &&
    cleanCatalogQuery(question).length >= 2;
}

function isSupportFollowup(question: string, history: ChatTurn[]): "group" | "individual" | undefined {
  if (!isContextualFollowup(question, history)) return undefined;
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  if (!/\b(?:kelompok\s+perhutanan\s+sosial|kps)\b/i.test(lastAssistant)) return undefined;
  if (/\b(?:pribadi|sendiri|belum|individu)\b/i.test(question)) return "individual";
  if (/\b(?:kps|kelompok|sudah|iya|ada)\b/i.test(question)) return "group";
  return undefined;
}

function isEligibilityContextFollowup(question: string, history: ChatTurn[]): boolean {
  if (history.length === 0) return false;
  const priorQuestion = previousUserQuestion(history);
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const repeatsBusiness = BUSINESS_PLANNING.test(question) || Boolean(businessActivity(question));
  const alreadyAnsweredGroupStatus = /\b(?:KPS|kelompok|sendiri|perorangan|individu|tergabung|sudah|belum|iya|enggak|nggak|tidak)\b/i.test(question);
  return (PERSONAL_KUPS_ELIGIBILITY.test(priorQuestion) || KUPS_REGISTRATION_GUIDE.test(priorQuestion)) &&
    /(?:tergabung.{0,50}KPS|KPS.{0,50}(?:sendiri|kelompok)|kelompok.{0,50}KPS)/i.test(lastAssistant) &&
    repeatsBusiness &&
    !alreadyAnsweredGroupStatus;
}

export async function answerQuestion(question: string, history: ChatTurn[] = []): Promise<ChatResult> {
  const { original, normalized } = normalizeQuestion(question);
  const compactQuestion = normalized.trim();
  const detectedCatalogIntent = detectCatalogIntent(compactQuestion) ?? contextualCatalogIntent(compactQuestion, history);
  if (GREETING_ONLY.test(compactQuestion)) {
    return quickReply("Hai! Aku asisten KUPS-Web. Kamu bisa tanya istilah atau aturan KUPS, minta dicari profil/produk/wisata/publikasi yang tampil di situs, atau cerita soal rencana usahamu. Lagi butuh bantuan yang mana?");
  }
  if (CAPABILITY_QUESTION.test(compactQuestion)) {
    return quickReply("Aku asisten informasi KUPS-Web. Aku bisa mencari profil, produk, wisata, publikasi dan statistik publik; menjelaskan aturan dengan rujukan; atau bantu memetakan langkah awal usaha. Aku tidak menetapkan status resmi, tapi kalau kebutuhanmu perlu dibahas lebih dalam, aku bisa merekomendasikan bidang expert dan membantu melihat pilihan jadwal konsultasi.");
  }
  if (IDENTITY_QUESTION.test(compactQuestion)) {
    return quickReply("Aku asisten informasi KUPS-Web. Aku membantu mencari profil kelompok, produk, wisata, publikasi, statistik, dan memahami aturan KUPS dari sumbernya. Kalau kamu sedang merintis usaha, ceritakan situasimu; aku bantu susun langkah awal dan, bila perlu, rekomendasikan expert KUPS yang bidangnya sesuai.");
  }
  if (isWaitingForConsultationFollowup(history)) {
    const consultation = await answerBusinessGuideFollowup(compactQuestion, history);
    if (consultation) return consultation;
  }
  if (/\b(?:expert|ahli|konsultasi|konsul)\b/i.test(compactQuestion)) {
    const consultation = await answerBusinessGuideFollowup(compactQuestion, history);
    if (consultation) return consultation;
    return quickReply("Bisa, aku bantu arahkan. Kamu ingin konsultasi soal kelembagaan/KUPS, produksi dan mutu, legalitas, branding/kemasan, pemasaran, atau pembiayaan? Ceritakan jenis usahamu dan kabupaten/kotanya supaya rekomendasinya lebih pas.");
  }
  if (WEBSITE_QUESTION.test(compactQuestion) && !detectedCatalogIntent) {
    return quickReply("Ini KUPS-Web, tempat melihat profil dan penawaran publik dari Kelompok Usaha Perhutanan Sosial, seperti produk dan destinasi wisata, serta publikasi terkait. Aku bisa bantu cari di dalam situs atau menjelaskan istilah dan aturan yang berkaitan. Kamu ingin mencari nama kelompok, produk, atau topik tertentu?");
  }

  if (PRIVATE_CONTACT_REQUEST.test(compactQuestion)) {
    return quickReply("Aku nggak bisa memberikan nomor pribadi seseorang. Kalau ada kontak yang memang dipublikasikan resmi, aku bisa bantu mencarinya dari profil atau kanal resmi; sebutkan nama KUPS dan daerahnya.");
  }
  if (PUBLIC_OFFICER_LOOKUP.test(compactQuestion)) {
    return answerPublicOfficerLookup();
  }
  if (WEBSITE_MANAGEMENT_QUESTION.test(compactQuestion)) {
    return answerWebsiteManagement(compactQuestion);
  }

  if (isRegistrationRequirementsFollowup(compactQuestion, history)) {
    return answerRegistrationRequirementsFollowup(compactQuestion, history);
  }

  if (KUPS_GROUP_COMPARISON.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021",
      "Kelompok tani biasa belum otomatis menjadi KPS atau KUPS. Dalam aturan, kelompok tani hutan dapat menjadi KPS jika memegang persetujuan Perhutanan Sosial; KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Jadi yang perlu dicek untuk kelompokmu adalah status persetujuan Perhutanan Sosial dan apakah KPS-nya sudah membentuk KUPS.",
    );
  }
  if (KPS_PS_DIFFERENCE.test(compactQuestion)) {
    return answerKupsTermQuestion(original, normalized, "comparison");
  }
  if (ACRONYM_CLARIFICATION.test(compactQuestion) || KPS_DEFINITION_QUESTION.test(compactQuestion)) {
    const asksPs = /\bps\b/i.test(compactQuestion) && !/\bkps\b/i.test(compactQuestion);
    const isGpsAmbiguous = ACRONYM_CLARIFICATION.test(compactQuestion) || /\bgps\b/i.test(compactQuestion);
    const answer = isGpsAmbiguous
      ? "Kalau konteksnya Perhutanan Sosial, PS berarti Perhutanan Sosial; istilah kelompoknya adalah KPS (Kelompok Perhutanan Sosial). Jadi mungkin “GPS” yang kamu dengar maksudnya “KPS”. KUPS adalah Kelompok Usaha Perhutanan Sosial yang dibentuk oleh KPS [S1]. Kamu sedang ingin memahami istilah atau mengecek usaha tertentu?"
      : asksPs
        ? "PS adalah Perhutanan Sosial: sistem pengelolaan hutan lestari yang dijalankan masyarakat setempat atau masyarakat adat sebagai pelaku utama. KPS adalah kelompok pemegang persetujuan Perhutanan Sosial, sedangkan KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Kamu menanyakan artinya saja atau kaitannya dengan usaha?"
        : "KPS adalah Kelompok Perhutanan Sosial. KUPS adalah kelompok usaha yang dibentuk oleh KPS dan sudah atau akan menjalankan usaha [S1]. Kalau kamu mau, aku bisa jelaskan bedanya dengan PS.";
    return answerFromApprovedFaq(normalized, "permenlhk-9-2021", answer, ACRONYM_CLARIFICATION.test(compactQuestion));
  }
  if (
    KUPS_DEFINITION_QUESTION.test(compactQuestion) &&
    !KUPS_BENEFIT_QUESTION.test(compactQuestion) &&
    !isKupsListQuestion(compactQuestion) &&
    detectedCatalogIntent &&
    ["product", "tourism", "both", "publication"].includes(detectedCatalogIntent.type)
  ) {
    return answerWithCatalogAttachment(
      original,
      detectedCatalogIntent,
      answerKupsTermQuestion(original, normalized, "definition"),
    );
  }
  if (
    KUPS_DEFINITION_QUESTION.test(compactQuestion) &&
    !KUPS_BENEFIT_QUESTION.test(compactQuestion) &&
    !isKupsListQuestion(compactQuestion)
  ) {
    return answerKupsTermQuestion(original, normalized, "definition");
  }
  if (KUPS_CLASS_QUESTION.test(compactQuestion)) {
    const asksToAdvance = /\b(?:naik|meningkatkan|menjadi|menaikkan|syarat|nilai)\b/i.test(compactQuestion);
    const classLead = /\b(?:pemula|madya|utama)\b/i.test(compactQuestion)
      ? "Dokumen resmi yang dirujuk bot menyebut kelas Blue/Biru, Silver/Perak, Gold/Emas, dan Platinum; aku belum menemukan label Pemula, Madya, dan Utama di sumber itu. "
      : "Sumber resmi yang dirujuk bot menyebut empat kelas KUPS: Blue/Biru, Silver/Perak, Gold/Emas, dan Platinum. ";
    const nextStep = asksToAdvance
      ? "Dokumen yang tersedia hanya memberi gambaran umum, bukan skor atau ambang kenaikan yang bisa dipakai menilai kelompokmu. Untuk langkah tepat, cocokkan status dan kriteria operasional di GoKUPS atau minta pendamping/KPH meninjau data kelompok."
      : "Gambaran umumnya: Blue tahap awal; Silver menguatkan kelembagaan dan pengelolaan areal; Gold berkembang pada kelembagaan, kawasan, dan usaha; Platinum memiliki pasar stabil nasional atau internasional.";
    return answerFromApprovedFaq(
      normalized,
      "permenhut-18-2025",
      `${classLead}${nextStep} Kamu sedang ingin memahami nama kelas atau mengecek cara memperkuat kelompokmu? [S1]`,
    );
  }
  if (PERHUTANAN_SOCIAL_OVERVIEW.test(compactQuestion)) {
    return answerPerhutananSocialOverview(normalized);
  }

  if (KUPS_FEE_QUESTION.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021-business",
      "Materi resmi yang tersedia di sini menjelaskan pembentukan dan penetapan KUPS, tetapi tidak mencantumkan tarif pendaftaran. Jadi aku belum bisa memastikan gratis atau berbayar; konfirmasi ke KPH atau pendamping Perhutanan Sosial di daerahmu sebelum melakukan pembayaran apa pun [S1]. Kamu berada di kabupaten/kota mana?",
      true,
    );
  }
  if (KUPS_GUARANTEED_OUTCOME_QUESTION.test(compactQuestion)) {
    const isTimeline = /\b(?:hari|minggu|bulan|tujuh|7)\b/i.test(compactQuestion) && /\b(?:diterima|daftar|pendaftaran|lolos)\b/i.test(compactQuestion);
    const asksAcceptance = /\b(?:diterima|lolos|jadi\s+KUPS|menjadi\s+KUPS)\b/i.test(compactQuestion);
    const answer = isTimeline
      ? "Aku tidak menemukan jaminan pengajuan KUPS pasti diterima dalam jangka waktu yang disebutkan. Aturan yang tersedia menyebut penetapan KUPS dilakukan Kepala KPH; bila belum ditetapkan dalam 14 hari kerja, penetapan dilakukan Kepala UPT. Batas 14 hari kerja itu adalah jalur penetapan, bukan jaminan permohonan pasti disetujui [S1]."
      : asksAcceptance
        ? "Memiliki usaha saja tidak otomatis membuat seseorang diterima sebagai KUPS. KUPS dibentuk oleh KPS untuk mengembangkan usaha Perhutanan Sosial; jadi yang perlu dicek adalah apakah usahanya bisa dijalankan melalui KPS, lalu kelompok membahas potensi dan meminta arahan proses penetapan kepada KPH/pendamping [S1]. Usaha atau kelompoknya sudah terhubung dengan KPS?"
      : "Status atau keanggotaan KUPS tidak otomatis menjamin setiap orang mendapat bantuan modal/dana. Aturan menyebut beberapa peluang fasilitasi dan akses permodalan, tetapi aksesnya bergantung pada program dan persyaratan [S1]. Kamu sedang mencari jenis bantuan tertentu?";
    return answerFromApprovedFaq(normalized, "permenlhk-9-2021-business", answer, !isTimeline);
  }

  const asksKupsGuidance =
    KUPS_REGISTRATION_GUIDE.test(compactQuestion) ||
    KUPS_BENEFIT_QUESTION.test(compactQuestion) ||
    PERSONAL_KUPS_ELIGIBILITY.test(compactQuestion) ||
    KUPS_RELATIONSHIP_QUESTION.test(compactQuestion);
  if (
    asksKupsGuidance &&
    detectedCatalogIntent &&
    ["product", "tourism", "both", "publication"].includes(detectedCatalogIntent.type)
  ) {
    const guidance = KUPS_BENEFIT_QUESTION.test(compactQuestion)
      ? answerKupsBusinessGuide(original, normalized, "benefits", history)
      : KUPS_REGISTRATION_GUIDE.test(compactQuestion)
        ? answerKupsBusinessGuide(original, normalized, "registration", history)
        : answerEligibilityQuestion(original, normalized);
    return answerWithCatalogAttachment(original, detectedCatalogIntent, guidance);
  }

  // Guidance questions take precedence over directory words such as "daftar".
  if (GENERIC_REGISTRATION_REQUEST.test(compactQuestion)) {
    return quickReply("Siap. Kamu mau bergabung dengan KUPS yang sudah ada, mengajukan pembentukan KUPS untuk kelompokmu, atau daftar sebagai pengelola di KUPS-Web? Kalau ceritakan jenis usahamu dan kabupaten/kotanya, aku bantu tentukan jalur yang pas.");
  }
  if (KUPS_BENEFIT_QUESTION.test(compactQuestion)) {
    return answerKupsBusinessGuide(original, normalized, "benefits", history);
  }
  if (KUPS_MEMBER_JOIN_GUIDE.test(compactQuestion)) {
    return answerKupsMembershipQuestion(normalized);
  }
  const asksExplicitRegistrationProcess = /\b(?:cara|langkah|prosedur|syarat|persyaratan|pendaftaran|pengajuan)\b.{0,45}\b(?:daftar|mendaftar|bergabung|KUPS)\b/i.test(compactQuestion);
  const asksEligibility = PERSONAL_KUPS_ELIGIBILITY.test(compactQuestion) &&
    /\b(?:bisa|boleh|layak|termasuk|masuk)\b/i.test(compactQuestion);
  if (asksEligibility && !asksExplicitRegistrationProcess) {
    return answerEligibilityQuestion(original, normalized);
  }
  if (KUPS_REGISTRATION_GUIDE.test(compactQuestion)) {
    return answerKupsBusinessGuide(original, normalized, "registration", history);
  }
  if (KPS_GROUP_JOIN_GUIDE.test(compactQuestion)) {
    return answerKpsGroupJoin(normalized);
  }
  if (KUPS_GROUP_FORMATION_QUESTION.test(compactQuestion)) {
    return answerKupsGroupFormation(normalized);
  }
  if (KUPS_RELATIONSHIP_QUESTION.test(compactQuestion) && businessActivity(compactQuestion)) {
    return answerEligibilityQuestion(original, normalized);
  }
  if (PERSONAL_KUPS_ELIGIBILITY.test(compactQuestion)) {
    return answerEligibilityQuestion(original, normalized);
  }
  if (isEligibilityContextFollowup(compactQuestion, history)) {
    const activity = businessActivity(`${previousUserQuestion(history)} ${normalized}`);
    const activityText = activity ? `usaha ${activity.label}` : "usahamu";
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021",
      `Oh, paham—kamu memang sudah punya ${activityText}. Untuk masuk sebagai KUPS, yang perlu dipastikan bukan cuma jenis usahanya: KUPS dibentuk oleh KPS [S1]. Usaha itu sekarang kamu jalankan sendiri atau bersama kelompok Perhutanan Sosial/KPS?`,
      true,
    );
  }

  if (PERSONAL_KUPS_STATUS.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "gokups-home",
      "Aku tidak punya data status tiap kelompok dalam indeks ini. Cek profil dan kelas kelompok langsung di GoKUPS karena datanya dapat berubah [S1].",
    );
  }

  if (CONTEXTUAL_COUNT_QUESTION.test(compactQuestion) && !detectedCatalogIntent) {
    const previousQuestion = previousUserQuestion(history);
    const previousIntent = detectCatalogIntent(previousQuestion);
    if (!previousIntent) {
      return quickReply("Yang mau kamu hitung yang mana: jumlah profil KUPS, produk, destinasi wisata, atau jumlahnya di daerah tertentu?");
    }
    const intent: CatalogIntent = previousIntent.type === "kups" && !previousIntent.query
      ? { type: "stats", query: "" }
      : previousIntent;
    const result = await searchPublicCatalog(intent);
    const answer = intent.type === "stats"
      ? previousIntent.type === "kups" && result.stats
        ? `Di data publik KUPS-Web ada ${result.stats.kups} profil KUPS. Ini jumlah profil publik yang tersedia di portal, dan bisa berubah saat datanya diperbarui.`
        : await answerFromPublicResults(original, intent, result.items, result.retrievedAt, result.stats)
      : await answerFromPublicResults(original, intent, result.items, result.retrievedAt, result.stats);
    const sources = intent.type === "stats"
      ? [websiteSource(result.retrievedAt)].filter((source): source is ChatSource => Boolean(source))
      : sourcesFromPublicItems(result.items, result.retrievedAt);
    return { answer, sources, catalogItems: result.items, needsClarification: false };
  }
  if (CONTEXTUAL_LOCATION_QUESTION.test(compactQuestion) && !detectedCatalogIntent) {
    const previousQuestion = previousUserQuestion(history);
    const previousIntent = detectCatalogIntent(previousQuestion);
    if (previousIntent && ["kups", "product", "tourism"].includes(previousIntent.type)) {
      const result = await searchPublicCatalog(previousIntent);
      const answer = await answerFromPublicResults(original, previousIntent, result.items, result.retrievedAt, result.stats);
      return {
        answer,
        sources: sourcesFromPublicItems(result.items, result.retrievedAt),
        catalogItems: result.items,
        needsClarification: result.items.length === 0,
      };
    }
    return quickReply("Profil KUPS, produk, atau destinasi yang mana yang ingin kamu cek lokasinya? Sebutkan nama atau komoditasnya, nanti aku cari di data publik.");
  }
  if (BUSINESS_DEVELOPMENT_FOLLOWUP.test(compactQuestion) && (history.length > 0 || /\bkups\b/i.test(compactQuestion))) {
    return answerBusinessDevelopmentFollowup(normalized, history);
  }

  if (/\b(?:expert|ahli|konsultasi)\b/i.test(compactQuestion)) {
    const explicitHandoff = await answerBusinessGuideFollowup(compactQuestion, history);
    if (explicitHandoff?.handoff) return explicitHandoff;
  }

  const businessFollowup = await answerBusinessGuideFollowup(compactQuestion, history);
  if (businessFollowup) return businessFollowup;

  if (isSupportFollowup(compactQuestion, history) === "group" && !SUPPORT_NEED.test(compactQuestion) && !expertNeed(compactQuestion)) {
    return quickReply("Oke, berarti ada kelompok yang terlibat. Apa nama KUPS/kelompoknya dan kabupaten atau provinsinya? Aku bisa cek profil publik yang tersedia.");
  }
  if (isSupportFollowup(compactQuestion, history) === "individual") {
    const activity = businessActivity(previousUserQuestion(history));
    if (activity) {
      return answerFromApprovedFaq(
        normalized,
        "permenlhk-9-2021-business",
        `Oke, berarti usaha ${activity.label} kamu sudah berjalan sendiri. KUPS dibentuk oleh KPS, jadi kamu tidak mendaftar sebagai KUPS perorangan. Langkah awalnya mencari KPS pemegang persetujuan Perhutanan Sosial di daerahmu, lalu membahas usaha ini sebagai potensi kelompok [S1]. Kabupaten/kota usahamu di mana? Aku bantu cari sumber publik yang paling nyambung.`,
        true,
      );
    }
    return quickReply("Oke, berarti masih berjalan sendiri. Untuk masuk ke skema KUPS, kamu perlu terhubung dengan KPS/kelompok Perhutanan Sosial di daerahmu. Kamu sudah tahu ada KPS di sekitar tempat usahamu?");
  }

  if (isCatalogChoiceReply(compactQuestion, history)) {
    const item = previousUserQuestion(history);
    const intent = { type: "product" as const, query: cleanCatalogQuery(item) };
    const result = await searchPublicCatalog(intent);
    const answer = await answerFromPublicResults(
      `${item} (pengguna memilih untuk melihat katalog)`,
      intent,
      result.items,
      result.retrievedAt,
      result.stats,
    );
    return {
      answer,
      sources: sourcesFromPublicItems(result.items, result.retrievedAt),
      catalogItems: result.items,
      needsClarification: result.items.length === 0,
    };
  }

  const catalogIntent = detectedCatalogIntent;
  if (catalogIntent) {
    const result = await searchPublicCatalog(catalogIntent);
    const answer = await answerFromPublicResults(original, catalogIntent, result.items, result.retrievedAt, result.stats);
    const sources = catalogIntent.type === "stats"
      ? [websiteSource(result.retrievedAt)].filter((source): source is ChatSource => Boolean(source))
      : sourcesFromPublicItems(result.items, result.retrievedAt);
    return {
      answer,
      sources,
      catalogItems: result.items,
      needsClarification: catalogIntent.type === "stats" ? !result.stats : result.items.length === 0,
    };
  }

  if (isKupsLookupReply(compactQuestion, history)) {
    const intent: CatalogIntent = { type: "kups", query: cleanCatalogQuery(compactQuestion) };
    const result = await searchPublicCatalog(intent);
    const answer = await answerFromPublicResults(original, intent, result.items, result.retrievedAt, result.stats);
    return {
      answer,
      sources: sourcesFromPublicItems(result.items, result.retrievedAt),
      catalogItems: result.items,
      needsClarification: result.items.length === 0,
    };
  }

  if (isBusinessChoiceReply(compactQuestion, history)) {
    return answerBusinessPlanningQuestion(`${previousUserQuestion(history)} ${normalized}`);
  }
  if (SUPPORT_NEED.test(compactQuestion)) {
    return answerSupportNeed(normalized);
  }
  if (BUSINESS_PLANNING.test(compactQuestion)) {
    return answerBusinessPlanningQuestion(original);
  }

  if (isAmbiguousSingleItem(compactQuestion)) {
    return {
      answer: `Maksudmu “${compactQuestion}” ingin melihat contoh yang sudah tayang di katalog KUPS-Web, atau sedang merencanakan usaha ${compactQuestion}? Kalau soal rencana usaha, ceritakan sedikit tahapmu; kalau katalog, balas “lihat katalog”.`,
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }
  if (isBareCatalogTopic(compactQuestion)) {
    return {
      answer: "Maksudmu ingin melihat produk atau destinasi yang terdaftar di katalog publik KUPS-Web, atau sedang membahas produk/usaha yang ingin kamu kembangkan?",
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }
  if (compactQuestion.split(/\s+/).length === 1) {
    return {
      answer: `Aku belum nangkep maksud “${compactQuestion}”. Kamu mau cari profil KUPS, tanya aturan/istilah, melihat produk atau wisata, atau sedang butuh bantuan untuk rencana usaha?`,
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }

  return answerFromKnowledge(original, normalized, history);
}
