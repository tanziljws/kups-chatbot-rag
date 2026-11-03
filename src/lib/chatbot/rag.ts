import {
  cleanCatalogQuery,
  detectCatalogIntent,
  isAmbiguousSingleItem,
  isKupsListQuestion,
  searchPublicCatalog,
  type CatalogIntent,
  type PublicCatalogItem,
} from "./catalog";
import {
  answerFromPublicResults,
  answerWithCatalogAttachment,
  formatCheckedAt,
  sourcesFromPublicItems,
  websiteSource,
} from "./catalog-answers";
import { getChatbotConfig } from "./config";
import {
  answerFromApprovedFaq,
  answerFromKnowledge,
  clarificationAnswer,
  getApprovedSource,
} from "./knowledge-answers";
import {
  buildConversationContext,
  businessActivity,
  extractLocation,
  extractOwnership,
  extractScale,
  isKupsConversation,
  isPersonalEligibilityFollowup,
  type ConversationContext,
} from "./conversation-context";
import { answerKupsDevelopmentFollowup } from "./kups-development-followup";
import { normalizeQuestion } from "./normalize";
import {
  type ChatResult,
  type ChatSource,
  type ChatTurn,
  type ExpertHandoff,
} from "./types";

export type { ChatResult, ChatSource, ChatTurn, ExpertHandoff } from "./types";

type ExpertNeed = { specialty: ExpertHandoff["specialty"]; label: string };

// -----------------------------------------------------------------------------
// Intent patterns. These are routing hints, not a substitute for evidence.
// -----------------------------------------------------------------------------

const GREETING_ONLY =
  /^(?:halo+|hai+|hi+|hello+|hey+|assalamu'?alaikum|assalamualaikum|pagi|selamat pagi|siang|selamat siang|sore|selamat sore|malam|selamat malam)[.!?,\s]*$/i;

const CONVERSATION_OPENER =
  /^(?:halo+|hai+|hi+|hello+|hey+|assalamu'?alaikum|assalamualaikum)[\s,.!]*(?:(?:min|kak|admin|pak|bu)[\s,.!]*)?(?:(?:aku|saya|gue|gw)\s+)?(?:mau|ingin|pengen|boleh)\s+tanya(?:\s+(?:dong|nih|ya))?[.!?]*$/i;

const IDENTITY_QUESTION =
  /\b(?:siapa|apa)\b.{0,25}\b(?:kamu|anda|asisten|chatbot|bot)\b|\b(?:kamu|anda|asisten|chatbot|bot)\b.{0,25}\b(?:siapa|apa)\b/i;

const WEBSITE_QUESTION =
  /\b(?:website|situs|web)\b.{0,35}\b(?:ini|tentang|isinya|apa)\b|\b(?:apa|tentang)\b.{0,25}\b(?:website|situs|web)\b/i;

const KUPS_PORTAL_QUESTION =
  /\b(?:portal|website|situs|web)\b.{0,50}\b(?:cari|mencari|data|profil|komoditas|produk|statistik)\b|\b(?:cari|mencari|lihat|cek)\b.{0,55}\b(?:data|profil|komoditas|hasil\s+produk|statistik)\b.{0,45}\bkups\b.{0,35}\b(?:di\s+mana|dimana|lihat|akses)\b|\b(?:di\s+mana|dimana)\b.{0,40}\b(?:data|profil|komoditas|hasil\s+produk|statistik)\b.{0,45}\bkups\b/i;

const GOKUPS_STATISTICS_QUESTION =
  /\b(?:statistik|jumlah|angka|data)\b.{0,55}\b(?:gokups|portal)\b.{0,55}\b(?:tetap|berubah|update|diperbarui)\b|\b(?:gokups|portal)\b.{0,55}\b(?:statistik|data)\b.{0,55}\b(?:tetap|berubah|update|diperbarui)\b/i;

const KPS_KUPS_RELATIONSHIP_QUESTION =
  /\bkps\b.{0,35}\b(?:sama|sm|berbeda|beda|bedanya|vs|dengan)\b.{0,30}\bkups\b|\bkups\b.{0,35}\b(?:sama|sm|berbeda|beda|bedanya|vs|dengan)\b.{0,30}\bkps\b/i;

const CAPABILITY_QUESTION =
  /\b(?:kamu|anda|asisten|chatbot|bot)\b.{0,30}\b(?:bisa|dapat|mampu)\b.{0,30}\b(?:apa|aja|saja|bantu|ngapain|lakukan|kerjakan)\b|\bapa saja yang bisa\b/i;

const PERSONAL_KUPS_ELIGIBILITY =
  /\b(?:punya|memiliki|menjalankan|usaha|bisnis|jualan|produk|produksi|olahan)\b.{0,110}\b(?:bisa|boleh|layak|masuk|menjadi|jadi|termasuk|bergabung|gabung|daftar|mendaftar|registrasi)\b.{0,90}\bkups\b|\bkups\b.{0,90}\b(?:bisa|boleh|layak|masuk|menjadi|jadi|termasuk|daftar|mendaftar|registrasi)\b.{0,110}\b(?:usaha|bisnis|jualan|produk|produksi|olahan)\b/i;

const KUPS_RELATIONSHIP_QUESTION =
  /\b(?:hubungan|hubungannya|terkait|kaitannya)\b.{0,60}\bkups\b|\bkups\b.{0,60}\b(?:hubungan|terkait|kaitan)\b/i;

const GENERIC_REGISTRATION_REQUEST =
  /^(?:(?:aku|saya|gue|gw)\s+)?(?:(?:mau|ingin|pengen)\s+)?(?:daftar|mendaftar|daftarin)(?:\s+(?:dong|nih|ya))?[.!?\s]*$/i;

const BUSINESS_PLANNING =
  /\b(?:mau|ingin|pengen|rencana|merintis|memulai|bikin|buat|membangun|jalanin|menjalankan|kepikiran|punya|memiliki)\b.{0,80}\b(?:bisnis|usaha|jualan|produksi|madu|kopi|kayu|wisata|kerajinan|produk|bambu|rotan|durian)\b|\b(?:bisnis|usaha)\b.{0,60}\b(?:madu|kopi|kayu|wisata|kerajinan|produk|bambu|rotan|durian)\b/i;

const SUPPORT_NEED =
  /\b(?:bingung|sulit|kesulitan|kendala|masalah|butuh\s+bantuan|perlu\s+bantuan|bisa\s+bantu(?:in)?|bantu\s+usaha|membantu\s+usaha|akses\s+pasar|pemasaran|promosi|kemasan|modal|pendanaan|pendamping)\b/i;

const BUSINESS_DEVELOPMENT_FOLLOWUP =
  /\b(?:cara|gimana|bagaimana)\b.{0,45}\b(?:mengembangkan|ngembangin|mengembangkannya|kembangkan|dikembangkan)\b|\b(?:mengembangkan|ngembangin|mengembangkannya|kembangkan)\b.{0,55}\b(?:usaha|bisnis|produk|itu|nya)\b/i;

const KUPS_DEFINITION_QUESTION =
  /\b(?:arti|pengertian|definisi|singkatan|singktn|kepanjangan)\b.{0,45}\bkups\b|\b(?:apa|apaan)\s+(?:(?:itu|sih|ya)\s+)?kups\b|\bkups\b.{0,25}\b(?:itu|tu|tuh|adalah|arti|pengertian|definisi|singkatan|singktn|kepanjangan)\b|\bkups\s+(?:apa|apaan)\b|\b(?:apa|apaan)\b.{0,35}\bkelompok\s+usaha\s+perhutanan\s+sosial\b/i;

const KPS_PS_DIFFERENCE =
  /\b(?:beda|bedanya|perbedaan)\b.{0,45}\b(?:kps|ps)\b.{0,35}\b(?:kps|ps)\b|\b(?:kps|ps)\b.{0,25}\b(?:sama|sm|dan|vs|dengan)\b.{0,25}\b(?:kps|ps)\b.{0,40}\b(?:beda|bedanya|perbedaan)\b/i;

const KUPS_GROUP_COMPARISON =
  /\b(?:beda|bedanya|perbedaan)\b.{0,45}\bkups\b.{0,55}\b(?:kelompok\s+tani|kelompok\s+biasa|kelompok\s+usaha|kps)\b|\b(?:kelompok\s+tani|kelompok\s+biasa)\b.{0,55}\bkups\b.{0,40}\b(?:beda|bedanya|perbedaan)\b/i;

const KUPS_BENEFIT_QUESTION =
  /\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?|dukungan|fasilitas|bantuan|modal|pendanaan)\b.{0,120}\b(?:kups|usaha|daftar|jadi|ikut(?:an)?|gabung|bergabung|anggota|saya|aku|kami|seperti\s+saya)\b|\b(?:kups|anggota\s+kups|usaha\s+saya|usaha\s+aku)\b.{0,120}\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?|dukungan|fasilitas|bantuan|modal|pendanaan|mengembangkan|berkembang)\b|\bkups\b.{0,70}\b(?:bisa|dapat)\s+(?:bantu|membantu|mendukung)\b/i;

const KUPS_MEMBER_JOIN_GUIDE =
  /\b(?:anggota|keanggotaan)\b.{0,50}\bkups\b|\bkups\b.{0,50}\b(?:anggota|bergabung|gabung|ikut)\b|\b(?:bergabung|gabung|ikut)\b.{0,45}\bkups\b/i;

const REGISTRATION_REQUIREMENTS_FOLLOWUP =
  /\b(?:syarat(?:nya)?|persyaratan|berkas|dokumen|ribet|susah|sulit|lama|proses(?:nya)?)\b/i;

const KUPS_REGISTRATION_GUIDE =
  /\b(?:gimana|bagaimana|cara|langkah|prosedur|persyaratan|syarat(?:nya)?|pengajuan|ajukan|daftar|daftarin|mendaftar|pendaftaran|mulai|awal)\b.{0,120}\b(?:daftar|daftarin|mendaftar|pendaftaran|mengajukan|pengajuan|bergabung|gabung|ikut(?:an)?|program|jadi|menjadi|masuk|syarat|persyaratan)\b.{0,90}\b(?:kups|kelompok\s+usaha\s+perhutanan\s+sosial)\b|\b(?:kups|kelompok\s+usaha\s+perhutanan\s+sosial)\b.{0,100}\b(?:syarat|persyaratan|pengajuan|daftar|daftarin|mendaftar|pendaftaran|gabung|bergabung|ikutan|ikut|masuk|proses|cara)\b|\b(?:aku|saya|gue|gw)\b.{0,40}\b(?:mau|ingin|pengen)\s+(?:daftar|gabung|ikut(?:an)?|masuk)\b.{0,60}\bkups\b|\b(?:ikut|ikutan|bergabung|gabung)\b.{0,50}\b(?:program\s+)?kups\b|\b(?:bisa|boleh)\s+(?:aku|saya|gue|gw)?\s*(?:(?:ga|gak|gk|ngga|nggak|enggak|tidak)\s+)?(?:daftar|gabung|ikut(?:an)?|masuk)\b.{0,55}\bkups\b|\bkups\b.{0,55}\b(?:bisa|boleh)\s+(?:(?:ga|gak|gk|ngga|nggak|enggak|tidak)\s+)?(?:daftar|gabung|ikut(?:an)?|masuk)\b|\b(?:syarat|persyaratan|daftar|mendaftar|proses)\b.{0,70}\bkups\b/i;

const KPS_DEFINITION_QUESTION =
  /\b(?:arti|pengertian|definisi|singkatan|kepanjangan|siapa)\b.{0,35}\b(?:kps|ps|gps)\b|\b(?:kps|ps|gps)\b.{0,40}\b(?:apa|arti|pengertian|definisi|singkatan|kepanjangan|siapa)\b/i;

const KUPS_CLASS_QUESTION =
  /\b(?:kelas(?:nya)?|pemula|madya|utama)\b.{0,45}\bkups\b|\bkups\b.{0,45}\b(?:kelas(?:nya)?|pemula|madya|utama)\b|\b(?:blue|biru|silver|perak|gold|emas|platinum|platina)\b/i;

const PERSONAL_KUPS_STATUS =
  /\b(?:kelas|status)\b.{0,40}\b(?:saya|aku|kelompok)\b|\b(?:saya|aku|kelompok)\b.{0,40}\b(?:kelas|status)\b/i;

const ACRONYM_CLARIFICATION = /\bgps\b.{0,40}\bps\b|\bps\b.{0,40}\bgps\b/i;

const PERHUTANAN_SOCIAL_OVERVIEW =
  /\b(?:awam|jelasin|jelaskan|ceritakan|dari\s+awal|apa\s+itu)\b.{0,100}\b(?:perhutanan\s+sosial|ps)\b|\b(?:perhutanan\s+sosial|ps)\b.{0,100}\b(?:awam|jelasin|jelaskan|ceritakan|dari\s+awal)\b/i;

const KPS_GROUP_JOIN_GUIDE =
  /\b(?:cara|gimana|bagaimana|mau|ingin|pengen|harus)\b.{0,70}\b(?:gabung|bergabung|ikut|ikutan|masuk|cari)\b.{0,90}\b(?:kelompok\s+perhutanan\s+sosial|kps|kelompok)\b|\b(?:belum\s+punya|belum\s+ada)\s+(?:kelompok|kps)\b/i;

const KUPS_GROUP_FORMATION_QUESTION =
  /\b(?:cara|gimana|bagaimana)\b.{0,50}\b(?:bikin|membuat|bentuk|membentuk)\b.{0,65}\b(?:kelompok|kups)\b|\b(?:bikin|membuat|membentuk)\b.{0,65}\bkelompok\b|\b(?:bentuk|membentuk)\b.{0,65}\b(?:kelompok\s+(?:perhutanan\s+sosial|kps|usaha)|kps|kups)\b/i;

const WEBSITE_MANAGEMENT_QUESTION =
  /\b(?:ubah|mengubah|edit|mengedit|perbarui|memperbarui|update|tambah|menambah|menambahkan|tambahkan|upload|unggah)\b.{0,55}\b(?:profil|profile|produk|penawaran|listing|data)\b|\b(?:profil|profile|produk|penawaran|listing)\b.{0,50}\b(?:ubah|edit|perbarui|update|tambah|menambahkan|tambahkan|upload|unggah)\b/i;

const PUBLIC_OFFICER_LOOKUP =
  /\b(?:siapa|nama|kontak|hubungi|petugas|pendamping|penanggung\s+jawab|mendapatkan|mencari)\b.{0,110}\b(?:mengurus|daftar|pendaftaran|pengajuan|kups|desa|kecamatan|kabupaten|daerah|sekitar|wilayah|hubungi)\b|\b(?:petugas|pendamping|kontak)\b.{0,100}\b(?:desa|kecamatan|kabupaten|daerah|kups|sekitar|wilayah|siapa|menghubungi)\b|\b(?:mau|ingin|perlu)\s+mendapatkan\s+pendamping\b/i;

const LOCAL_LOOKUP_QUESTION =
  /\b(?:di\s+sekitar|sekitar\s+sini|dekat\s+sini|di\s+daerah|wilayah\s+saya|tinggal\s+di|berada\s+di|lokasi\s+saya)\b/i;

const KUPS_FEE_QUESTION =
  /\b(?:biaya|bayar|tarif|pungutan)\b.{0,65}\b(?:daftar|pendaftaran|pengajuan|kups)\b|\b(?:daftar|pendaftaran|pengajuan|kups)\b.{0,65}\b(?:biaya|bayar|tarif|pungutan)\b/i;

const KUPS_GUARANTEED_OUTCOME_QUESTION =
  /\b(?:pasti|dijamin|menjamin|garansi|menggaransi|otomatis)\b.{0,70}\b(?:diterima|lolos|bantuan|modal|dana|uang|kups|anggota|jadi)\b|\b(?:bantuan|modal|dana|uang|diterima|lolos|menjadi\s+kups)\b.{0,70}\b(?:pasti|dijamin|menjamin|otomatis)\b/i;

const PRIVATE_CONTACT_REQUEST =
  /\b(?:nomor\s+whatsapp\s+pribadi|wa\s+pribadi|nomor\s+telepon\s+pribadi|nomor\s+pribadi|kontak\s+pribadi)\b/i;

const CONTEXTUAL_COUNT_QUESTION =
  /\b(?:ada\s+berapa(?:\s+banyak)?|berapa\s+banyak|jumlahnya)\b|^\s*berapa\s*[?!.,]*$/i;

const CONTEXTUAL_LOCATION_QUESTION =
  /\b(?:lokasinya|lokasi\s+kelompok|aku\s+mau\s+tahu\s+lokasinya|saya\s+ingin\s+tahu\s+lokasinya|di\s+mana|dimana|lokasi)\b/i;

function quickReply(answer: string): ChatResult {
  return { answer, sources: [], catalogItems: [], needsClarification: false };
}

function previousUserQuestion(history: ChatTurn[]): string {
  return [...history].reverse().find((turn) => turn.role === "user")?.content ?? "";
}

function lastAssistantMessage(history: ChatTurn[]): string {
  return [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
}

function isRegistrationRequirementsFollowup(question: string, history: ChatTurn[]): boolean {
  if (!REGISTRATION_REQUIREMENTS_FOLLOWUP.test(question)) return false;
  const previousUserTurns = history.filter((turn) => turn.role === "user").slice(-6);
  const hasRegistrationContext = previousUserTurns.some((turn) =>
    KUPS_REGISTRATION_GUIDE.test(turn.content) ||
    KUPS_MEMBER_JOIN_GUIDE.test(turn.content) ||
    PERSONAL_KUPS_ELIGIBILITY.test(turn.content),
  );
  return hasRegistrationContext && /\b(?:KUPS|KPS|kelompok\s+perhutanan\s+sosial)\b/i.test(lastAssistantMessage(history));
}

// -----------------------------------------------------------------------------
// Grounded KUPS answers.
// -----------------------------------------------------------------------------

async function answerKupsTermQuestion(
  original: string,
  kind: "definition" | "comparison",
): Promise<ChatResult> {
  const source = await getApprovedSource("permenlhk-9-2021");
  if (!source) {
    return {
      answer: clarificationAnswer(original),
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }

  const answer = kind === "comparison"
    ? "Gampangnya: PS (Perhutanan Sosial) adalah skema pengelolaan hutannya; KPS adalah kelompok pemegang persetujuan/pengelola Perhutanan Sosial; KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Jadi PS itu skemanya, KPS kelompoknya, dan KUPS wadah usahanya."
    : "Gampangnya, KUPS adalah Kelompok Usaha Perhutanan Sosial. KUPS merupakan kelompok usaha yang dibentuk oleh KPS untuk menjalankan atau merencanakan usaha dalam skema Perhutanan Sosial. Jadi, KUPS bukan pendaftaran usaha perorangan secara langsung [S1].";

  return { answer, sources: [source], catalogItems: [], needsClarification: false };
}

async function answerPerhutananSocialOverview(question: string): Promise<ChatResult> {
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021",
    "Gampangnya, Perhutanan Sosial (PS) adalah skema pengelolaan hutan lestari yang memberi peran kepada masyarakat setempat atau masyarakat adat. KPS adalah kelompok pemegang persetujuan Perhutanan Sosial, sedangkan KUPS merupakan kelompok usaha yang dibentuk oleh KPS [S1]. Kamu ingin memahami cara bergabung dengan kelompok yang sudah ada atau jalur mengembangkan usaha?",
  );
}

async function answerKpsGroupJoin(question: string, context: ConversationContext): Promise<ChatResult> {
  const locationText = context.location ? ` di ${context.location}` : " di wilayahmu";
  const answer =
    `Iya, langkah awalnya mencari KPS yang sudah memegang persetujuan Perhutanan Sosial${locationText}. ` +
    "Kamu bisa meminta arahan kepada pendamping Perhutanan Sosial atau KPH setempat untuk mengetahui kelompok yang relevan dan mekanisme bergabungnya. " +
    "Penerimaan anggota mengikuti ketentuan dan kesepakatan kelompok; jadi jangan menganggap semua KPS otomatis menerima anggota baru. " +
    (context.location ? `Kalau nanti ingin dicari berdasarkan wilayah, sebutkan apakah lokasimu Kabupaten/Kota ${context.location}.` : "Kalau ingin dicari berdasarkan wilayah, sebutkan kabupaten/kota tempat usahamu.");
  return answerFromApprovedFaq(question, "permenlhk-9-2021-business", answer, true);
}

async function answerKupsMembershipQuestion(question: string): Promise<ChatResult> {
  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021-business",
    "Kalau maksudmu bergabung sebagai anggota KUPS yang sudah ada, itu berbeda dari membentuk KUPS baru. Aturan yang tersedia menjelaskan KUPS dibentuk oleh KPS, tetapi tidak merinci syarat penerimaan anggota perorangan. Tanyakan mekanisme ke KUPS/KPS tujuan atau pendamping/KPH setempat. Kalau yang kamu maksud membentuk KUPS baru, jalurnya melalui KPS [S1].",
    true,
  );
}

async function answerKupsGroupFormation(question: string): Promise<ChatResult> {
  const asksAboutKps = /\b(?:KPS|kelompok\s+perhutanan\s+sosial|persetujuan\s+perhutanan\s+sosial|belum\s+punya\s+kelompok|kelompok\s+sendiri)\b/i.test(question);
  const answer = asksAboutKps
    ? "Kalau belum ada kelompok Perhutanan Sosial, itu tahap yang berbeda dari membentuk KUPS. KUPS dibentuk oleh KPS; jadi untuk mulai dari nol, perlu lebih dulu memastikan jalur persetujuan Perhutanan Sosial dan kelembagaan kelompok bersama pendamping/KPH setempat. Persyaratan dan proses rinci perlu dikonfirmasi sesuai wilayah [S1]."
    : "Kalau yang kamu maksud membentuk KUPS, jalurnya melalui KPS. Rencana usaha dibahas bersama KPS berdasarkan potensi kelompok, kemudian proses penetapan mengikuti ketentuan dan arahan KPH/UPT setempat [S1].";
  return answerFromApprovedFaq(question, "permenlhk-9-2021-business", answer, true);
}

async function answerEligibilityQuestion(
  original: string,
  normalized: string,
  history: ChatTurn[],
): Promise<ChatResult> {
  const source = await getApprovedSource("permenlhk-9-2021");
  if (!source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const context = buildConversationContext(history, normalized);
  const activity = context.activity;
  const subject = context.talkingAboutFriend ? "temanmu" : "kamu";
  let nextStep: string;
  if (context.connection === "not_connected") {
    nextStep = "Karena belum terhubung dengan KPS, langkah awalnya mencari KPS/pemegang persetujuan Perhutanan Sosial di wilayahmu. Setelah itu, diskusikan apakah usaha tersebut dapat dikembangkan sebagai usaha kelompok bersama KPS dan pendamping/KPH.";
  } else if (context.connection === "connected") {
    nextStep = "Karena sudah terhubung dengan KPS, bicarakan komoditas dan rencana usaha bersama kelompok. KPS dapat meminta arahan pendamping/KPH mengenai proses pengembangan dan penetapan KUPS.";
  } else {
    nextStep = "Yang perlu dipastikan adalah apakah usaha tersebut dapat dijalankan atau direncanakan bersama KPS/pemegang persetujuan Perhutanan Sosial, karena KUPS dibentuk oleh KPS.";
  }

  const eligibilityIntro = context.scale === "small"
    ? "Usaha skala kecil tetap bisa dibahas untuk dikembangkan lewat KUPS, tetapi KUPS bukan pendaftaran usaha perorangan. "
    : "Usaha tersebut bisa dibahas sebagai potensi KUPS, tetapi KUPS bukan pendaftaran usaha perorangan. ";
  const businessSubject = subject === "temanmu"
    ? "Usaha temanmu"
    : activity
      ? `Usaha ${activity.label}-mu`
      : "Usahamu";
  const answer =
    `${eligibilityIntro}${businessSubject} perlu dilihat keterkaitannya dengan kelompok Perhutanan Sosial/KPS. ${nextStep} [S1]`;

  return { answer, sources: [source], catalogItems: [], needsClarification: context.connection === undefined };
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

  const context = buildConversationContext(history, normalized);
  const activityText = context.activity ? `usaha ${context.activity.label}` : "usaha";

  if (kind === "benefits") {
    const benefitText =
      "KUPS menjadi wadah kelompok untuk mengembangkan usaha Perhutanan Sosial. Dukungan yang dapat difasilitasi antara lain peningkatan produksi dan nilai tambah, promosi/pemasaran, serta akses permodalan. Namun, menjadi KUPS tidak otomatis menjamin mendapat uang, alat, pembeli, atau bantuan; semuanya bergantung pada program, kebutuhan kelompok, dan persyaratan [S1].";

    let nextStep: string;
    if (context.connection === "not_connected") {
      nextStep = "Karena kamu belum punya kelompok, langkah awalnya mencari KPS/pemegang persetujuan Perhutanan Sosial di daerahmu dan membahas kemungkinan mengembangkan usaha bersama kelompok.";
    } else if (context.connection === "connected") {
      nextStep = "Karena kamu sudah terhubung dengan KPS, bicarakan kebutuhan usaha bersama kelompok dan pendamping/KPH agar bisa dipetakan dukungan yang sesuai.";
    } else if (context.activity) {
      nextStep = `Untuk${activityText}, hal pertama yang perlu dicek adalah apakah usaha tersebut dapat dikembangkan bersama KPS. ${context.talkingAboutFriend ? "Temanmu" : "Kamu"} sudah terhubung dengan KPS atau masih menjalankan usaha sendiri?`;
    } else {
      nextStep = "Usaha apa yang sedang kamu jalankan atau rencanakan? Aku bisa bantu arahkan langkah yang relevan.";
    }

    return {
      answer: `${benefitText} ${nextStep}`,
      sources: [source],
      catalogItems: [],
      needsClarification: context.connection === undefined && !context.activity,
    };
  }

  let nextStep: string;
  if (context.connection === "not_connected") {
    nextStep = "Karena kamu belum punya kelompok, cari dulu KPS/pemegang persetujuan Perhutanan Sosial di wilayahmu. Pendamping Perhutanan Sosial atau KPH setempat dapat membantu menjelaskan kelompok yang relevan dan jalur berikutnya.";
  } else if (context.connection === "connected") {
    nextStep = "Karena kamu sudah terhubung dengan KPS, bahas komoditas, potensi, dan rencana usaha bersama kelompok. Setelah itu minta arahan pendamping/KPH mengenai proses usulan dan penetapan KUPS.";
  } else {
    nextStep = "Langkah awalnya memastikan kelompokmu merupakan KPS/pemegang persetujuan Perhutanan Sosial. Setelah itu, bahas potensi dan rencana usaha bersama kelompok serta minta arahan pendamping/KPH setempat.";
  }

  return {
    answer: `Untuk membentuk KUPS, jalurnya melalui KPS, bukan pendaftaran sebagai usaha perorangan. ${nextStep} Persyaratan teknis dan proses setempat perlu dikonfirmasi kepada KPH/pendamping yang menangani wilayahmu [S1].`,
    sources: [source],
    catalogItems: [],
    needsClarification: context.connection === undefined,
  };
}

// -----------------------------------------------------------------------------
// Expert handoff / consultation routing.
// -----------------------------------------------------------------------------

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

function buildExpertHandoff(
  question: string,
  history: ChatTurn[],
  need: ExpertNeed,
): ExpertHandoff | null {
  const userText = [...history, { role: "user" as const, content: question }]
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join(" ");
  const context = buildConversationContext(history, question);
  if (!context.activity) return null;

  const subject = context.talkingAboutFriend ? "Usaha teman" : "Usaha";
  const connectionSummary = context.connection === "connected"
    ? "sudah terhubung dengan KPS"
    : context.connection === "not_connected"
      ? "belum terhubung dengan KPS"
      : "status KPS belum dikonfirmasi";

  return {
    specialty: need.specialty,
    reason: `Kebutuhan ${need.label} paling relevan dibahas bersama expert bidang ini.`,
    summary: `${subject}: ${context.activity.label}. Status kelompok: ${connectionSummary}. Konteks: ${userText.slice(-700)}.`,
  };
}

async function answerConsultationQuestion(
  question: string,
  history: ChatTurn[],
): Promise<ChatResult | undefined> {
  if (!/\b(?:expert|ahli|konsultasi|konsul)\b/i.test(question)) return undefined;
  const need = expertNeed(question) ?? expertNeed(history.filter((turn) => turn.role === "user").map((turn) => turn.content).join(" "));
  if (!need) {
    return quickReply("Bisa, aku bantu arahkan. Kamu ingin konsultasi soal kelembagaan/KUPS, produksi dan mutu, legalitas, branding/kemasan, pemasaran, atau pembiayaan?");
  }
  const handoff = buildExpertHandoff(question, history, need);
  if (!handoff) {
    return quickReply("Boleh ceritakan jenis usaha dan kabupaten/kotanya dulu? Setelah tahu konteksnya, aku bisa mengarahkan ke bidang expert yang sesuai.");
  }
  return {
    answer: `Untuk kebutuhan ${need.label}, expert bidang ini paling relevan. Ringkasan ceritamu bisa diteruskan agar kamu tidak perlu mengulang konteks dari awal.`,
    sources: [],
    catalogItems: [],
    needsClarification: false,
    handoff,
  };
}

// -----------------------------------------------------------------------------
// Website management and public directory responses.
// -----------------------------------------------------------------------------

async function answerWebsiteManagement(question: string): Promise<ChatResult> {
  const config = getChatbotConfig();
  const base = config.catalogUrl ? new URL(config.catalogUrl).origin : "";
  const asksProduct = /\b(?:produk|penawaran|listing)\b/i.test(question);
  const asksProfile = /\b(?:profil|profile|data)\b/i.test(question);
  const links = base
    ? [`[dashboard pengelola](${base}/kelola)`, `[daftar produk](${base}/kelola/produk)`, `[tambah produk](${base}/kelola/produk/baru)`]
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
    ? `Kalau kamu Admin KUPS, login ke ${links[0] ?? "dashboard KUPS-Web"}, lalu buka ${links[1] ?? "/kelola/produk"} untuk mengelola produk. Penawaran baru dibuat lewat ${links[2] ?? "/kelola/produk/baru"}.`
    : "";
  const profileText = asksProfile
    ? "Untuk perubahan profil KUPS, aku belum menemukan halaman edit profil mandiri yang terverifikasi. Minta bantuan admin/pengelola KUPS-Web untuk perubahan profil."
    : "";

  return {
    answer: [productText, profileText].filter(Boolean).join(" ") || "Kamu ingin mengubah profil KUPS, produk, atau destinasi wisatanya?",
    sources: source ? [source] : [],
    catalogItems: [],
    needsClarification: !asksProduct && !asksProfile,
  };
}

async function answerSupportNeed(question: string): Promise<ChatResult> {
  const activity = businessActivity(question);
  const isFunding = /\b(?:modal|pendanaan|pembiayaan|pinjaman|investasi|hibah)\b/i.test(question);
  const isMarketing = /\b(?:pasar|pemasaran|promosi|pembeli|buyer|penjualan|jualan|distribusi)\b/i.test(question);
  const isProduction = /\b(?:produksi|mutu|kualitas|pengolahan|panen)\b/i.test(question);
  const isPackaging = /\b(?:kemasan|branding|merek|label)\b/i.test(question);

  let catalogItems: PublicCatalogItem[] = [];
  let catalogNote = "";
  if (activity && activity.type === "product" && (isMarketing || isPackaging)) {
    try {
      const catalog = await searchPublicCatalog({ type: "product", query: activity.label });
      catalogItems = catalog.items;
      catalogNote = catalog.items.length
        ? ` Aku juga menemukan ${catalog.items.length} listing publik terkait ${activity.label}; kartu hasilnya bisa menjadi contoh bagaimana produk ditampilkan, bukan jaminan produkmu akan laku.`
        : ` Aku belum menemukan listing publik yang cocok untuk ${activity.label}; ini bukan bukti bahwa pasarnya tidak ada.`;
    } catch {
      catalogNote = " Pencarian katalog publik sedang tidak tersedia.";
    }
  }

  const need = isFunding
    ? "pembiayaan dan modal"
    : isMarketing
      ? "pemasaran dan akses pasar"
      : isProduction
        ? "produksi dan mutu"
        : isPackaging
          ? "branding dan kemasan"
          : "kebutuhan pengembangan usaha";
  const answer = isFunding
    ? "Untuk modal, KUPS dapat membuka peluang fasilitasi akses permodalan, tetapi tidak otomatis menjamin bantuan atau pinjaman. Ketersediaannya bergantung pada program, persyaratan, kesiapan kelompok, dan proses penilaian. Tanyakan program yang sedang tersedia kepada KPS, pendamping, atau KPH setempat."
    : isMarketing
      ? "Untuk pemasaran, langkah awalnya memetakan produk, calon pembeli, kualitas yang konsisten, kemasan, harga, dan kanal penjualan. Dalam skema KUPS, penguatan promosi/pemasaran dapat dibahas bersama KPS dan pendamping."
      : isProduction
        ? "Untuk produksi dan mutu, petakan dulu kapasitas produksi, bahan baku, proses pengolahan, konsistensi kualitas, dan standar produk. Kebutuhan ini bisa dibahas bersama KPS serta pendamping atau expert produksi/mutu."
        : isPackaging
          ? "Untuk branding dan kemasan, mulai dari identitas produk, informasi label, keamanan kemasan, ukuran, dan target pembeli. Kebutuhan ini bisa dibahas dengan pendamping atau expert branding/kemasan."
          : `Aku bisa bantu memetakan ${need}. Ceritakan bagian yang paling mendesak dan kondisi usahamu saat ini.`;

  return {
    answer: `${answer}${catalogNote}`,
    sources: catalogItems.length ? sourcesFromPublicItems(catalogItems, new Date().toISOString()) : [],
    catalogItems,
    needsClarification: true,
  };
}

function answerPublicOfficerLookup(): ChatResult {
  return {
    answer: "Untuk mencari pendamping Perhutanan Sosial, kamu bisa mulai dari KPH atau pendamping Perhutanan Sosial yang menangani wilayahmu. Aku belum memiliki direktori nama dan kontak pendamping per desa yang bisa dipastikan. Sebutkan kabupaten/kota dan kecamatanmu; aku bisa mencoba mencari profil KUPS publik di wilayah tersebut, tetapi hasil profil KUPS bukan direktori resmi pendamping.",
    sources: [],
    catalogItems: [],
    needsClarification: true,
  };
}

// -----------------------------------------------------------------------------
// Catalog and contextual follow-up helpers.
// -----------------------------------------------------------------------------

function contextualCatalogIntent(question: string, history: ChatTurn[]): CatalogIntent | undefined {
  const compact = question.trim().toLocaleLowerCase();
  const topic = compact.match(/^(?:(?:kalau|kalo|terus|trus|dan|untuk)\s+)?(produk|produk-produk|wisata|destinasi|publikasi)(?:\s+(?:itu|nya|tuh|aja|saja|apa))?[?!.,\s]*$/)?.[1];
  if (!topic) return undefined;

  const previousIntent = detectCatalogIntent(previousUserQuestion(history));
  const lastAssistant = lastAssistantMessage(history);
  const hasRecentCatalogContext = Boolean(previousIntent) ||
    /(?:di\s+(?:direktori|katalog)\s+publik|hasil\s+destinasi\s+wisata|kartu\s+di\s+bawah|data\s+publik\s+kups-web)/i.test(lastAssistant);
  if (!hasRecentCatalogContext) return undefined;

  const type: CatalogIntent["type"] = /publikasi/.test(topic)
    ? "publication"
    : /wisata|destinasi/.test(topic)
      ? "tourism"
      : "product";
  return { type, query: "" };
}

function isCatalogChoiceReply(question: string, history: ChatTurn[]): boolean {
  const lastAssistant = lastAssistantMessage(history);
  const priorItem = previousUserQuestion(history).trim();
  return /\b(?:katalog|produk|lihat|cari)\b/i.test(question) &&
    isAmbiguousSingleItem(priorItem) &&
    /\b(?:katalog|produk|rencana\s+usaha|bisnis)\b/i.test(lastAssistant);
}

function isBusinessChoiceReply(question: string, history: ChatTurn[]): boolean {
  const lastAssistant = lastAssistantMessage(history);
  return isAmbiguousSingleItem(previousUserQuestion(history)) &&
    /\b(?:merencanakan\s+usaha|rencana\s+usaha|bisnis)\b/i.test(lastAssistant) &&
    /\b(?:usaha|bisnis|merintis|pribadi|mulai|rencana)\b/i.test(question);
}

function isKupsLookupReply(question: string, history: ChatTurn[]): boolean {
  const lastAssistant = lastAssistantMessage(history);
  return /\b(?:nama\s+KUPS|kabupaten|provinsinya|wilayahnya)\b/i.test(lastAssistant) &&
    cleanCatalogQuery(question).length >= 2;
}

function isBareCatalogTopic(question: string): boolean {
  return /^(?:(?:kalau|kalo|terus|trus|dan|untuk)\s+)?(?:produk|produk-produk|wisata|destinasi|publikasi)(?:\s+(?:itu|nya|tuh|aja|saja|apa))?[?!.,\s]*$/i.test(question.trim());
}

function isAmbiguousKupsFollowup(question: string): boolean {
  return /^(?:terus\s+)?(?:manfaatnya|keuntungannya|syaratnya|caranya|prosesnya|lokasinya|pendampingnya|modalnya|bantuannya)\s*[?!.,]*$/i.test(question.trim());
}

// -----------------------------------------------------------------------------
// Main router.
// -----------------------------------------------------------------------------

export async function answerQuestion(question: string, history: ChatTurn[] = []): Promise<ChatResult> {
  const { original, normalized } = normalizeQuestion(question);
  const compactQuestion = normalized.trim();
  const detectedCatalogIntent = detectCatalogIntent(compactQuestion) ?? contextualCatalogIntent(compactQuestion, history);
  const context = buildConversationContext(history, compactQuestion);
  const inKupsContext = isKupsConversation(history);

  // 1) Social openers must never trigger vector search.
  if (GREETING_ONLY.test(compactQuestion) || CONVERSATION_OPENER.test(compactQuestion)) {
    return quickReply("Halo! Boleh banget. Mau tanya tentang apa nih? Aku bisa bantu jelaskan KUPS, mencari profil/produk/destinasi publik, atau membahas rencana usahamu.");
  }

  if (CAPABILITY_QUESTION.test(compactQuestion)) {
    return quickReply("Aku asisten informasi KUPS-Web. Aku bisa mencari profil, produk, wisata, publikasi, dan statistik publik; menjelaskan aturan dengan rujukan; atau membantu memetakan langkah awal usaha. Aku tidak menetapkan status resmi atau menjamin bantuan, tetapi bisa mengarahkanmu ke informasi dan bidang expert yang relevan.");
  }

  if (IDENTITY_QUESTION.test(compactQuestion)) {
    return quickReply("Aku asisten informasi KUPS-Web. Aku membantu mencari profil kelompok, produk, wisata, publikasi, statistik, dan memahami aturan KUPS dari sumbernya. Kalau kamu sedang merintis atau mengembangkan usaha, ceritakan situasimu dan aku bantu susun langkah awal.");
  }

  if (KUPS_PORTAL_QUESTION.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "gokups-home",
      "Data publik Perhutanan Sosial, profil kelompok, komoditas, hasil produk, dan statistik bisa dilihat di portal GoKUPS. Data dapat berubah, jadi buka portal langsung untuk informasi terbaru [S1].",
    );
  }

  if (GOKUPS_STATISTICS_QUESTION.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "gokups-home",
      "Angka dan statistik di GoKUPS dapat berubah seiring pembaruan data. Untuk angka terkini, periksa portal langsung dan tanggal pembaruan datanya [S1].",
    );
  }

  if (WEBSITE_QUESTION.test(compactQuestion) && !detectedCatalogIntent) {
    return quickReply("Ini KUPS-Web, tempat melihat profil dan penawaran publik dari Kelompok Usaha Perhutanan Sosial, seperti produk dan destinasi wisata, serta publikasi terkait. Kamu ingin mencari kelompok, produk, destinasi, atau informasi aturan?");
  }

  if (PRIVATE_CONTACT_REQUEST.test(compactQuestion)) {
    return quickReply("Aku nggak bisa memberikan nomor pribadi seseorang. Kalau ada kontak yang dipublikasikan resmi, aku bisa bantu mencarinya dari profil atau kanal resmi; sebutkan nama KUPS dan daerahnya.");
  }

  if (WEBSITE_MANAGEMENT_QUESTION.test(compactQuestion)) {
    return answerWebsiteManagement(compactQuestion);
  }

  // 2) Direct regulatory questions take precedence over catalog keyword matches.
  if (KUPS_GROUP_COMPARISON.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021",
      "Kelompok tani biasa belum otomatis menjadi KPS atau KUPS. Kelompok tani hutan dapat menjadi KPS jika memegang persetujuan Perhutanan Sosial; KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Jadi, yang perlu dicek adalah status persetujuan Perhutanan Sosial kelompok dan apakah KPS tersebut sudah membentuk KUPS.",
    );
  }

  if (KPS_PS_DIFFERENCE.test(compactQuestion)) {
    return answerKupsTermQuestion(original, "comparison");
  }

  if (KPS_KUPS_RELATIONSHIP_QUESTION.test(compactQuestion)) {
    return answerKupsTermQuestion(original, "comparison");
  }

  if (ACRONYM_CLARIFICATION.test(compactQuestion) || KPS_DEFINITION_QUESTION.test(compactQuestion)) {
    const asksPs = /\bps\b/i.test(compactQuestion) && !/\bkps\b/i.test(compactQuestion);
    const isGpsAmbiguous = ACRONYM_CLARIFICATION.test(compactQuestion) || /\bgps\b/i.test(compactQuestion);
    const answer = isGpsAmbiguous
      ? "Kalau konteksnya Perhutanan Sosial, PS berarti Perhutanan Sosial; istilah kelompoknya adalah KPS (Kelompok Perhutanan Sosial). Jadi mungkin ‘GPS’ yang kamu dengar maksudnya ‘KPS’. KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]."
      : asksPs
        ? "PS adalah Perhutanan Sosial, yaitu skema pengelolaan hutan lestari dengan masyarakat setempat atau masyarakat adat sebagai pelaku utama. KPS adalah kelompok pemegang persetujuan Perhutanan Sosial, sedangkan KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]."
        : "KPS adalah Kelompok Perhutanan Sosial. KUPS adalah kelompok usaha yang dibentuk oleh KPS dan akan atau sudah menjalankan usaha [S1].";
    return answerFromApprovedFaq(normalized, "permenlhk-9-2021", answer, ACRONYM_CLARIFICATION.test(compactQuestion));
  }

  if (KUPS_DEFINITION_QUESTION.test(compactQuestion) && !KUPS_BENEFIT_QUESTION.test(compactQuestion) && !isKupsListQuestion(compactQuestion)) {
    const guidance = answerKupsTermQuestion(original, "definition");
    if (detectedCatalogIntent && ["product", "tourism", "both", "publication"].includes(detectedCatalogIntent.type)) {
      return answerWithCatalogAttachment(original, detectedCatalogIntent, guidance);
    }
    return guidance;
  }

  if (KUPS_CLASS_QUESTION.test(compactQuestion)) {
    const asksToAdvance = /\b(?:naik|meningkatkan|menjadi|menaikkan|syarat|nilai)\b/i.test(compactQuestion);
    const classLead = /\b(?:pemula|madya|utama)\b/i.test(compactQuestion)
      ? "Dokumen resmi yang dirujuk bot menyebut kelas Blue/Biru, Silver/Perak, Gold/Emas, dan Platinum; aku belum menemukan label Pemula, Madya, dan Utama di sumber tersebut. "
      : "Sumber resmi yang dirujuk bot menyebut empat kelas KUPS: Blue/Biru, Silver/Perak, Gold/Emas, dan Platinum. ";
    const nextStep = asksToAdvance
      ? "Dokumen yang tersedia hanya memberi gambaran umum, bukan skor atau ambang kenaikan yang cukup untuk menilai kelompokmu. Cocokkan kriteria operasional di GoKUPS atau minta pendamping/KPH meninjau data kelompok."
      : "Gambaran umumnya: Blue tahap awal; Silver menguatkan kelembagaan dan pengelolaan areal; Gold berkembang pada kelembagaan, kawasan, dan usaha; Platinum memiliki pasar stabil nasional atau internasional.";
    return answerFromApprovedFaq(normalized, "permenhut-18-2025", `${classLead}${nextStep} [S1]`);
  }

  if (PERSONAL_KUPS_STATUS.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "gokups-home",
      "Aku tidak memiliki data status atau kelas setiap kelompok dalam indeks informasi ini. Periksa profil kelompok langsung di GoKUPS atau minta pendamping/KPH meninjau data kelompok, karena status dapat berubah [S1].",
    );
  }

  if (PERHUTANAN_SOCIAL_OVERVIEW.test(compactQuestion)) {
    return answerPerhutananSocialOverview(normalized);
  }

  if (KUPS_FEE_QUESTION.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021-business",
      "Materi resmi yang tersedia menjelaskan pembentukan dan penetapan KUPS, tetapi tidak mencantumkan tarif pendaftaran. Jadi aku belum bisa memastikan gratis atau berbayar. Konfirmasikan ke KPH atau pendamping Perhutanan Sosial di daerahmu sebelum melakukan pembayaran apa pun [S1].",
      true,
    );
  }

  if (KUPS_GUARANTEED_OUTCOME_QUESTION.test(compactQuestion)) {
    const isTimeline = /\b(?:hari|minggu|bulan|tujuh|7)\b/i.test(compactQuestion) && /\b(?:diterima|daftar|pendaftaran|lolos)\b/i.test(compactQuestion);
    const asksAcceptance = /\b(?:diterima|lolos|jadi\s+kups|menjadi\s+kups)\b/i.test(compactQuestion);
    const answer = isTimeline
      ? "Aku tidak menemukan jaminan pengajuan KUPS pasti diterima dalam jangka waktu tertentu. Aturan menyebut penetapan KUPS dilakukan Kepala KPH; jika belum ditetapkan dalam 14 hari kerja, penetapan dilakukan Kepala UPT. Batas tersebut adalah jalur penetapan, bukan jaminan permohonan pasti disetujui [S1]."
      : asksAcceptance
        ? "Memiliki usaha saja tidak otomatis membuat seseorang menjadi KUPS. KUPS dibentuk oleh KPS untuk mengembangkan usaha Perhutanan Sosial; yang perlu dicek adalah apakah usaha itu dapat dijalankan melalui KPS, lalu kelompok membahas potensi dan meminta arahan KPH/pendamping [S1]."
        : "Status atau keanggotaan KUPS tidak otomatis menjamin setiap orang mendapat bantuan modal/dana. Aturan menyebut peluang fasilitasi dan akses permodalan, tetapi aksesnya bergantung pada program dan persyaratan [S1].";
    return answerFromApprovedFaq(normalized, "permenlhk-9-2021-business", answer, !isTimeline);
  }

  // 3) Benefits and eligibility must be answered before asking for more context.
  const asksKupsBenefits = KUPS_BENEFIT_QUESTION.test(compactQuestion) ||
    (inKupsContext && /\b(?:manfaatnya|keuntungannya|bantuannya|modalnya)\b/i.test(compactQuestion));
  if (asksKupsBenefits) {
    return answerKupsBusinessGuide(original, normalized, "benefits", history);
  }

  if (isRegistrationRequirementsFollowup(compactQuestion, history)) {
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021-business",
      "Wajar kalau mau memastikan syaratnya dulu. Sumber resmi yang tersedia menjelaskan bahwa KUPS dibentuk oleh KPS dan proses penetapannya melibatkan KPH/UPT, tetapi tidak merinci satu daftar berkas universal atau syarat penerimaan anggota untuk setiap kelompok. Karena itu, cocokkan dokumen dan mekanisme dengan KPS tujuan serta pendamping/KPH setempat [S1].",
      true,
    );
  }

  if (GENERIC_REGISTRATION_REQUEST.test(compactQuestion)) {
    return {
      ...quickReply("Siap. Kamu mau bergabung dengan KUPS yang sudah ada, mengajukan pembentukan KUPS untuk kelompokmu, atau mengelola profil di KUPS-Web? Ceritakan jenis usaha dan kabupaten/kotanya, aku bantu tentukan jalur yang sesuai."),
      needsClarification: true,
    };
  }

  if (KUPS_MEMBER_JOIN_GUIDE.test(compactQuestion)) {
    if (context.connection === "not_connected") {
      return answerEligibilityQuestion(original, normalized, history);
    }
    return answerKupsMembershipQuestion(normalized);
  }

  const asksExplicitRegistrationProcess =
    /\b(?:cara|langkah|prosedur|syarat|persyaratan|pendaftaran|pengajuan)\b.{0,60}\b(?:daftar|mendaftar|bergabung|kups)\b/i.test(compactQuestion);
  const asksEligibility = PERSONAL_KUPS_ELIGIBILITY.test(compactQuestion) &&
    /\b(?:bisa|boleh|layak|termasuk|masuk)\b/i.test(compactQuestion);

  if (asksEligibility && !asksExplicitRegistrationProcess) {
    return answerEligibilityQuestion(original, normalized, history);
  }

  if (KUPS_REGISTRATION_GUIDE.test(compactQuestion)) {
    return answerKupsBusinessGuide(original, normalized, "registration", history);
  }

  if (KPS_GROUP_JOIN_GUIDE.test(compactQuestion)) {
    return answerKpsGroupJoin(normalized, context);
  }

  if (KUPS_GROUP_FORMATION_QUESTION.test(compactQuestion)) {
    return answerKupsGroupFormation(normalized);
  }

  if (KUPS_RELATIONSHIP_QUESTION.test(compactQuestion) && (businessActivity(compactQuestion) || context.activity)) {
    return answerEligibilityQuestion(original, normalized, history);
  }

  if (PERSONAL_KUPS_ELIGIBILITY.test(compactQuestion)) {
    return answerEligibilityQuestion(original, normalized, history);
  }

  // Handle hypothetical group scenarios before generic eligibility follow-ups.
  // "Kalau kelompoknya sudah ada ..." is not a statement that the user joined it.
  const asksHypotheticalGroupScenario =
    inKupsContext &&
    /\b(?:kalau|kalo|jika|misalnya|seandainya)\b.{0,45}\b(?:kelompok(?:nya)?|kps)\b/i.test(compactQuestion) &&
    /\b(?:sudah|ada|terbentuk|terbina)\b/i.test(compactQuestion) &&
    /\b(?:bisa|dapat|dikembangkan|bersama|gabung)\b/i.test(compactQuestion);
  if (asksHypotheticalGroupScenario) {
    return answerKupsDevelopmentFollowup(normalized, history);
  }

  // Specific development questions must not be mistaken for a generic
  // personal-eligibility follow-up such as "usaha ... gimana?".
  if (inKupsContext && BUSINESS_DEVELOPMENT_FOLLOWUP.test(compactQuestion)) {
    return answerKupsDevelopmentFollowup(normalized, history);
  }

  // A short follow-up such as "kalau aku punya usaha sendiri bisa ikut?"
  // inherits the KUPS topic from the previous turns even when it omits "KUPS".
  if (isPersonalEligibilityFollowup(compactQuestion, history)) {
    return answerEligibilityQuestion(original, normalized, history);
  }

  // 4) Capture new facts from the user without forcing an unrelated clarification.
  if (inKupsContext && (businessActivity(compactQuestion) || extractScale(compactQuestion) || extractOwnership(compactQuestion))) {
    const updated = buildConversationContext(history, compactQuestion);
    const activityText = updated.activity ? `budidaya/usaha ${updated.activity.label}` : "usahamu";
    const scaleText = updated.scale === "small" ? " masih skala kecil" : updated.scale === "medium" ? " berskala menengah" : "";
    const ownershipText = updated.ownership === "family" ? " dan dikelola keluarga" : updated.ownership === "individual" ? " dan dikelola sendiri" : updated.ownership === "group" ? " dan dikelola bersama kelompok" : "";
    const next = updated.connection === "not_connected"
      ? "Karena belum terhubung dengan KPS, langkah awalnya mencari KPS/pemegang persetujuan Perhutanan Sosial di wilayahmu."
      : updated.connection === "connected"
        ? "Karena sudah terhubung dengan KPS, rencana usaha bisa dibahas bersama kelompok dan pendamping/KPH."
        : "Untuk menentukan jalurnya, yang perlu diketahui berikutnya adalah apakah kamu sudah terhubung dengan KPS.";
    return answerFromApprovedFaq(
      normalized,
      "permenlhk-9-2021-business",
      `Oke, berarti ${activityText}${scaleText}${ownershipText}. ${next}`,
      updated.connection === undefined,
    );
  }

  // 5) Pendamping/local lookup is independent of KPS membership status.
  if (PUBLIC_OFFICER_LOOKUP.test(compactQuestion)) {
    if (LOCAL_LOOKUP_QUESTION.test(compactQuestion) || context.location) {
      const area = context.location ?? extractLocation(compactQuestion);
      if (area && /^bogor$/i.test(area)) {
        return quickReply("Bogor yang kamu maksud Kabupaten Bogor atau Kota Bogor? Aku perlu memperjelas wilayahnya dulu supaya pencarian profil KUPS tidak terlalu luas. Untuk nama pendamping, hasil profil KUPS publik juga tidak sama dengan direktori resmi pendamping.");
      }
      if (area) {
        try {
          const result = await searchPublicCatalog({ type: "kups", query: area });
          const answer = await answerFromPublicResults(original, { type: "kups", query: area }, result.items, result.retrievedAt, result.stats);
          const disclaimer = " Catatan: hasil ini adalah profil KUPS publik, bukan direktori resmi pendamping Perhutanan Sosial.";
          return {
            answer: `${answer}${disclaimer}`,
            sources: sourcesFromPublicItems(result.items, result.retrievedAt),
            catalogItems: result.items,
            needsClarification: result.items.length === 0,
          };
        } catch {
          return quickReply(`Aku belum bisa mengakses katalog publik untuk ${area} saat ini. Untuk pendamping, jalur yang dapat kamu tanyakan adalah KPH atau pendamping Perhutanan Sosial yang menangani wilayah tersebut. Apakah lokasimu Kabupaten Bogor atau Kota Bogor?`);
        }
      }
    }
    return answerPublicOfficerLookup();
  }

  // Specific business-development help is separate from the KPS membership slot.
  // Run this after the public-officer route so "mencari pendamping" is not
  // swallowed by the generic support classifier.
  if (inKupsContext && SUPPORT_NEED.test(compactQuestion) && !asksKupsBenefits) {
    return answerSupportNeed(compactQuestion);
  }

  // A local statement such as "Saya tinggal di Bogor..." can be a location lookup
  // even if the user did not say the word "pendamping".
  if (LOCAL_LOOKUP_QUESTION.test(compactQuestion) && /\b(?:kups|kelompok|pendamping|sekitar|sini)\b/i.test(compactQuestion)) {
    const area = context.location ?? extractLocation(compactQuestion);
    if (area && /^bogor$/i.test(area)) {
      return quickReply("Bogor yang kamu maksud Kabupaten Bogor atau Kota Bogor? Aku perlu memperjelas wilayahnya dulu supaya pencarian profil KUPS lebih tepat.");
    }
    if (area) {
      try {
        const intent: CatalogIntent = { type: "kups", query: area };
        const result = await searchPublicCatalog(intent);
        const answer = await answerFromPublicResults(original, intent, result.items, result.retrievedAt, result.stats);
        return {
          answer: `${answer} Catatan: hasil profil KUPS publik bukan direktori resmi pendamping Perhutanan Sosial.`,
          sources: sourcesFromPublicItems(result.items, result.retrievedAt),
          catalogItems: result.items,
          needsClarification: result.items.length === 0,
        };
      } catch {
        return quickReply(`Aku belum bisa mengakses data publik untuk ${area}. Untuk mencari pendamping Perhutanan Sosial, hubungi KPH atau pendamping yang menangani wilayahmu. Apakah yang kamu maksud Kabupaten Bogor atau Kota Bogor?`);
      }
    }
  }

  // 6) Continue KUPS conversation using known facts, but do not lock the user
  // into answering a previous pending question.
  if (inKupsContext && /\b(?:kalau|kalo|berarti|jadi|terus|lalu)\b/i.test(compactQuestion)) {
    if (/\b(?:kelompoknya|kelompok\s+sudah\s+ada|kalau\s+kelompok)\b/i.test(compactQuestion) && /\b(?:bisa|dapat|dikembangkan|bersama)\b/i.test(compactQuestion)) {
      return answerKupsDevelopmentFollowup(normalized, history);
    }
    if (context.connection === "not_connected" && /\b(?:cari\s+kelompok|kelompok\s+yang\s+sudah|izin\s+perhutanan\s+sosial|harus\s+cari)\b/i.test(compactQuestion)) {
      return answerKpsGroupJoin(normalized, context);
    }
    if (isAmbiguousKupsFollowup(compactQuestion)) {
      if (/\b(?:manfaat|keuntungan|bantuan|modal)\b/i.test(compactQuestion)) {
        return answerKupsBusinessGuide(original, normalized, "benefits", history);
      }
      if (/\b(?:syarat|proses|daftar)\b/i.test(compactQuestion)) {
        return answerKupsBusinessGuide(original, normalized, "registration", history);
      }
    }
  }

  // 7) Count/location follow-ups for a previously discussed public listing.
  if (CONTEXTUAL_COUNT_QUESTION.test(compactQuestion) && !detectedCatalogIntent) {
    const previousIntent = detectCatalogIntent(previousUserQuestion(history));
    if (!previousIntent) {
      return quickReply("Yang mau kamu hitung yang mana: jumlah profil KUPS, produk, destinasi wisata, atau jumlahnya di daerah tertentu?");
    }
    const intent: CatalogIntent = previousIntent.type === "kups" && !previousIntent.query
      ? { type: "stats", query: "" }
      : previousIntent;
    const result = await searchPublicCatalog(intent);
    const answer = await answerFromPublicResults(original, intent, result.items, result.retrievedAt, result.stats);
    const sources = intent.type === "stats"
      ? [websiteSource(result.retrievedAt)].filter((source): source is ChatSource => Boolean(source))
      : sourcesFromPublicItems(result.items, result.retrievedAt);
    return { answer, sources, catalogItems: result.items, needsClarification: false };
  }

  if (CONTEXTUAL_LOCATION_QUESTION.test(compactQuestion) && !detectedCatalogIntent) {
    const previousIntent = detectCatalogIntent(previousUserQuestion(history));
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
  }

  // 8) Specific business support and consultation questions.
  if (/\b(?:expert|ahli|konsultasi|konsul)\b/i.test(compactQuestion)) {
    const consultation = await answerConsultationQuestion(compactQuestion, history);
    if (consultation) return consultation;
  }

  if (inKupsContext && /\b(?:modal|pendanaan|pembiayaan|akses\s+pasar|pemasaran|promosi|kemasan|produksi)\b/i.test(compactQuestion)) {
    const need = expertNeed(compactQuestion);
    if (need && /\b(?:expert|ahli|konsultasi|konsul|dibantu|pendamping)\b/i.test(compactQuestion)) {
      const handoff = buildExpertHandoff(compactQuestion, history, need);
      if (handoff) {
        return {
          answer: `Untuk kebutuhan ${need.label}, aku bisa mengarahkanmu ke expert bidang tersebut.`,
          sources: [],
          catalogItems: [],
          needsClarification: false,
          handoff,
        };
      }
    }
  }

  // 9) Catalog intent is evaluated after domain-specific KUPS guidance.
  if (isCatalogChoiceReply(compactQuestion, history)) {
    const item = previousUserQuestion(history);
    const intent: CatalogIntent = { type: "product", query: cleanCatalogQuery(item) };
    const result = await searchPublicCatalog(intent);
    const answer = await answerFromPublicResults(`${item} (pengguna memilih katalog)`, intent, result.items, result.retrievedAt, result.stats);
    return {
      answer,
      sources: sourcesFromPublicItems(result.items, result.retrievedAt),
      catalogItems: result.items,
      needsClarification: result.items.length === 0,
    };
  }

  if (detectedCatalogIntent) {
    const result = await searchPublicCatalog(detectedCatalogIntent);
    const answer = await answerFromPublicResults(original, detectedCatalogIntent, result.items, result.retrievedAt, result.stats);
    const sources = detectedCatalogIntent.type === "stats"
      ? [websiteSource(result.retrievedAt)].filter((source): source is ChatSource => Boolean(source))
      : sourcesFromPublicItems(result.items, result.retrievedAt);
    return {
      answer,
      sources,
      catalogItems: result.items,
      needsClarification: detectedCatalogIntent.type === "stats" ? !result.stats : result.items.length === 0,
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
    return answerKupsDevelopmentFollowup(`${previousUserQuestion(history)} ${normalized}`, history);
  }

  if (SUPPORT_NEED.test(compactQuestion) && !inKupsContext) {
    return {
      ...quickReply("Aku bantu petakan kebutuhannya. Bagian yang paling mendesak apa—produksi, kemasan, pemasaran, pendanaan, atau informasi KUPS? Ceritakan jenis usaha dan daerahnya."),
      needsClarification: true,
    };
  }

  if (BUSINESS_PLANNING.test(compactQuestion) && !inKupsContext) {
    return answerFromApprovedFaq(
      compactQuestion,
      "permenlhk-9-2021-business",
      "Bisa kita bahas dari situasimu. Kalau ingin mengembangkan usaha melalui KUPS, hal pertama yang perlu dipastikan adalah hubungan usaha tersebut dengan KPS/pemegang persetujuan Perhutanan Sosial, karena KUPS dibentuk oleh KPS [S1]. Usaha apa yang ingin kamu jalankan dan di kabupaten/kota mana?",
      true,
    );
  }

  if (isAmbiguousSingleItem(compactQuestion)) {
    return {
      answer: `Maksudmu “${compactQuestion}” ingin melihat contoh yang sudah tayang di katalog KUPS-Web, atau sedang merencanakan usaha ${compactQuestion}? Kalau soal rencana usaha, ceritakan tahapmu; kalau katalog, balas “lihat katalog”.`,
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
      answer: `Aku belum menangkap maksud “${compactQuestion}”. Kamu mau cari profil KUPS, tanya aturan/istilah, melihat produk atau wisata, atau membahas rencana usaha?`,
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }

  // KUPS follow-ups that contain no explicit keyword are still resolved against
  // the previous subject, but the bot does not repeat a stale slot question.
  if (inKupsContext && /\b(?:itu|tadi|tersebut|halnya|begitu|gitu)\b/i.test(compactQuestion)) {
    return answerKupsDevelopmentFollowup(normalized, history);
  }

  return answerFromKnowledge(original, normalized, history);
}
