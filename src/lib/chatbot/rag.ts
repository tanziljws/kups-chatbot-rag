import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { cleanCatalogQuery, detectCatalogIntent, isAmbiguousSingleItem, searchPublicCatalog, type CatalogIntent, type PublicCatalogItem } from "./catalog";
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
const PERSONAL_KUPS_ELIGIBILITY = /\b(?:bisnis|usaha|wisata|ekowisata|kegiatan|jualan|produk|kayu|madu|kopi)\b.{0,140}\b(?:masuk|termasuk|layak|memenuhi|bisa|boleh|jadi|terdaftar|daftar|mendaftar|registrasi|gabung|bergabung)\b.{0,60}\bkups\b|\bkups\b.{0,60}\b(?:masuk|termasuk|layak|bisnis|usaha|wisata|kegiatan|daftar|mendaftar|registrasi)\b.{0,80}\b(?:bisnis|usaha|wisata|ekowisata|kegiatan|jualan|produk|kayu|madu|kopi)\b|\b(?:daftar|mendaftar|registrasi)\b.{0,35}\bkups\b.{0,70}\b(?:bisnis|usaha|wisata|kegiatan|jualan|produk|kayu|madu|kopi)\b/i;
const BUSINESS_PLANNING = /\b(?:mau|ingin|pengen|rencana|merintis|memulai|bikin|buat|membangun|jalanin|menjalankan|kepikiran)\b.{0,55}\b(?:bisnis|usaha|jualan|produksi|madu|kopi|kayu|wisata|kerajinan|produk)\b|\b(?:bisnis|usaha)\b.{0,45}\b(?:madu|kopi|kayu|wisata|kerajinan|produk)\b/i;
const SUPPORT_NEED = /\b(?:bingung|sulit|kesulitan|kendala|masalah|butuh\s+bantuan|perlu\s+bantuan|akses\s+pasar|pemasaran|promosi|kemasan|modal|pendanaan)\b/i;
const KUPS_DEFINITION_QUESTION = /\b(?:arti|pengertian|definisi|singkatan|kepanjangan)\b.{0,35}\bkups\b|\bapa\s+(?:itu|arti|pengertian|apaan)\s+kups\b|\bkups\b.{0,35}\b(?:itu|tu|tuh|apa|apaan|adalah|arti|pengertian|definisi|singkatan|kepanjangan)\b/i;
const KPS_PS_DIFFERENCE = /\b(?:beda|bedanya|perbedaan)\b.{0,35}\b(?:kps|ps)\b.{0,30}\b(?:kps|ps)\b|\b(?:kps|ps)\b.{0,20}\b(?:sama|sm|dan|vs|dengan)\b.{0,20}\b(?:kps|ps)\b.{0,35}\b(?:beda|bedanya|perbedaan)\b/i;
const KUPS_BENEFIT_QUESTION = /\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?)\b.{0,90}\b(?:kups|daftar|jadi|bergabung|anggota)\b|\b(?:kups|anggota\s+kups)\b.{0,70}\b(?:manfaat(?:nya)?|keuntungan(?:nya)?|faedah(?:nya)?|untung(?:nya)?)\b/i;
const KUPS_REGISTRATION_GUIDE = /\b(?:gimana|bagaimana|cara|langkah|prosedur|persyaratan|syarat)\b.{0,90}\b(?:daftar|mendaftar|pendaftaran|bergabung|gabung|jadi)\b.{0,35}\bkups\b/i;
const KPS_DEFINITION_QUESTION = /\b(?:arti|pengertian|definisi|singkatan|kepanjangan|siapa)\b.{0,35}\b(?:kps|ps|gps)\b|\b(?:kps|ps|gps)\b.{0,35}\b(?:apa|arti|pengertian|definisi|singkatan|kepanjangan|siapa)\b/i;
const KUPS_CLASS_QUESTION = /\bkelas(?:nya)?\b.{0,35}\bkups\b|\bkups\b.{0,35}\bkelas(?:nya)?\b|\b(?:blue|biru|silver|perak|gold|emas|platinum)\b/i;
const PERSONAL_KUPS_STATUS = /\b(?:kelas|status)\b.{0,40}\b(?:saya|aku|kelompok)\b|\b(?:saya|aku|kelompok)\b.{0,40}\b(?:kelas|status)\b/i;
const ACRONYM_CLARIFICATION = /\bgps\b.{0,40}\bps\b|\bps\b.{0,40}\bgps\b/i;

let inferenceQueue: Promise<void> = Promise.resolve();

function withInferenceSlot<T>(task: () => Promise<T>): Promise<T> {
  const result = inferenceQueue.then(task, task);
  inferenceQueue = result.then(() => undefined, () => undefined);
  return result;
}

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

  const sourceNumbers = new Map<string, number>();
  const sourceByNumber = new Map<number, ChatSource>();
  const context = contextEntries
    .map(({ document, source }) => {
      if (!sourceNumbers.has(source.url)) {
        const number = sourceNumbers.size + 1;
        sourceNumbers.set(source.url, number);
        sourceByNumber.set(number, source);
      }
      const sourceNumber = sourceNumbers.get(source.url);
      return `[S${sourceNumber}] ${document.pageContent}`;
    })
    .join("\n\n");

  const llm = new ChatOpenAI({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    temperature: 0.1,
    maxTokens: config.llmMaxTokens,
    timeout: 30_000,
    maxRetries: 0,
    // Disable model thinking so the response is a direct answer, not a long
    // reasoning trace, through Ollama's OpenAI-compatible endpoint.
    modelKwargs: { reasoning_effort: "none" },
    configuration: { baseURL: config.llmBaseUrl },
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Kamu adalah pendamping informasi KUPS-Web yang ramah dan aktif. Pahami maksud pertanyaan saat ini dulu; gunakan riwayat hanya jika pengguna jelas merujuk ke jawaban sebelumnya. Jawab dalam bahasa Indonesia sehari-hari yang sopan, 2–5 kalimat (sekitar 30–100 kata). Jawab inti pertanyaan, jelaskan istilah dengan kata sederhana, lalu beri satu langkah lanjut atau satu pertanyaan yang membantu. Jangan menyalin paragraf sumber mentah, jangan membuka jawaban dengan salam kecuali pengguna menyapa, dan jangan mengulang informasi yang tidak ditanyakan. Gunakan hanya fakta dari konteks dan tandai klaim faktual dengan sumber [S1]. Jangan menulis bagian 'Sumber:' karena UI menampilkan tautan otomatis. Jangan mengarang data website, syarat, izin, status, bantuan, atau kelayakan. Untuk kelayakan usaha, jelaskan batas informasi dan tanyakan konteks kelompok yang diperlukan; jangan memutuskan hanya dari jenis usahanya. Jika konteks tidak cukup, katakan bagian mana yang belum diketahui dan ajukan satu pertanyaan klarifikasi. Jangan menyebut aturan terbaru jika konteks tidak membuktikan status berlakunya.",
    ],
    [
      "human",
      "Riwayat singkat:\n{history}\n\nPertanyaan: {question}\n\nKonteks sumber:\n{context}",
    ],
  ]);
  const chain = RunnableSequence.from([prompt, llm, new StringOutputParser()]);
  const historyText = (useHistory ? history.slice(-2) : [])
    .map((turn) => `${turn.role === "assistant" ? "Asisten" : "Pengguna"}: ${turn.content.slice(0, 350)}`)
    .join("\n") || "(belum ada percakapan sebelumnya)";
  const answer = await chain.invoke({ question: original, context, history: historyText });
  const needsClarification = answer.trim().startsWith("BUTUH_KLARIFIKASI:");
  let cleanedAnswer = answer.trim().replace(/^BUTUH_KLARIFIKASI:\s*/i, "");
  if (!cleanedAnswer) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }
  const citedNumbers = [...new Set([...answer.matchAll(/\[S(\d+)\]/gi)].map((match) => Number(match[1])))]
    .filter((number) => sourceByNumber.has(number));
  if (citedNumbers.length === 0) {
    citedNumbers.push(1);
    cleanedAnswer = `${cleanedAnswer} [S1]`;
  }
  const citedSources = citedNumbers.flatMap((number) => {
    const source = sourceByNumber.get(number);
    return source ? [source] : [];
  });
  return {
    answer: cleanedAnswer,
    sources: citedSources,
    catalogItems: [],
    needsClarification,
  };
}

async function answerKupsTermQuestion(
  original: string,
  normalized: string,
  kind: "definition" | "comparison",
): Promise<ChatResult> {
  const config = getChatbotConfig();
  const matches = await searchKnowledge(normalized, Math.max(config.topK, 8), 0);
  const definition = matches.find(({ document }) => document.metadata.sourceId === "permenlhk-9-2021");
  const source = definition ? sourceFromMetadata(definition.document.metadata) : undefined;
  if (!definition || !source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const llm = new ChatOpenAI({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    temperature: 0.1,
    maxTokens: Math.min(config.llmMaxTokens, 150),
    timeout: 30_000,
    maxRetries: 0,
    modelKwargs: { reasoning_effort: "none" },
    configuration: { baseURL: config.llmBaseUrl },
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      kind === "comparison"
        ? "Jawab dalam bahasa Indonesia sehari-hari, paling banyak 3 kalimat. Bedakan langsung: PS adalah sistem/skema Perhutanan Sosial, KPS adalah kelompok pemegang persetujuan/pengelolanya, dan KUPS adalah kelompok usaha yang dibentuk KPS. Jelaskan dengan sederhana dan jangan menambah fakta di luar sumber. Jangan menulis catatan sumber terpisah; aplikasi menampilkan tautan sumber."
        : "Jawab dalam bahasa Indonesia sehari-hari, paling banyak 3 kalimat. Jelaskan apa itu KUPS dengan sederhana: kelompok usaha yang dibentuk KPS dalam Perhutanan Sosial dan akan/sudah menjalankan usaha. Jangan tertukar dengan izin usaha perorangan atau mengarang manfaat. Jangan menulis catatan sumber terpisah; aplikasi menampilkan tautan sumber.",
    ],
    ["human", "Pertanyaan pengguna: {question}\n\nSumber resmi [S1]: {context}"],
  ]);
  const chain = RunnableSequence.from([prompt, llm, new StringOutputParser()]);
  let generatedText = "";
  try {
    generatedText = await withInferenceSlot(() => chain.invoke({
      question: original,
      context: definition.document.pageContent,
    }));
  } catch {
    // The grounded short answer below remains available if local inference fails.
  }
  const answerText = generatedText.trim();
  const generatedHasKupsTerms = /\bKUPS\b/i.test(answerText) && /\bKPS\b/i.test(answerText);
  const generatedHasComparison = /\bPS\b.{0,80}\b(?:sistem|skema)\b/i.test(answerText) &&
    /\bKPS\b.{0,80}\bkelompok\b/i.test(answerText) &&
    /\bKUPS\b.{0,80}\b(?:kelompok|usaha)\b/i.test(answerText);
  const answerIsConcise = answerText.split(/\s+/).filter(Boolean).length <= 100;
  const hasBadSourceFootnote = /(?:^|\n)\s*S1[.:]/i.test(answerText);
  const mislabelsPsAsGroup = /\bkelompok\s+perhutanan\s+sosial\s*\(\s*PS\s*\)/i.test(answerText);
  if (generatedHasKupsTerms && answerIsConcise && !hasBadSourceFootnote && !mislabelsPsAsGroup && (kind === "definition" || generatedHasComparison)) {
    const cleanGenerated = answerText.replace(/\s*\[S1\]\s*/gi, " ").trim();
    return {
      answer: `${cleanGenerated} [S1]`,
      sources: [source],
      catalogItems: [],
      needsClarification: false,
    };
  }

  const answer = kind === "comparison"
    ? "Gampangnya: PS (Perhutanan Sosial) adalah sistem pengelolaan hutannya; KPS adalah kelompok pemegang persetujuan/pengelola Perhutanan Sosial; KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Jadi PS itu skemanya, KPS kelompoknya, KUPS wadah usahanya. Kamu lagi mencari tahu jalur usaha kopi lewat KUPS?"
    : "Gampangnya, KUPS adalah kelompok usaha yang dibentuk oleh KPS (Kelompok Perhutanan Sosial) untuk menjalankan atau mengembangkan usaha dalam skema Perhutanan Sosial [S1]. Jadi usaha kopi atau madu bisa dibahas lewat kelompok KPS; usaha perorangan saja belum otomatis menjadi KUPS. Kamu lagi ingin memahami istilahnya atau mencari langkah untuk usahamu?";
  return { answer, sources: [source], catalogItems: [], needsClarification: false };
}

function quickReply(answer: string): ChatResult {
  return { answer, sources: [], catalogItems: [], needsClarification: false };
}

async function answerEligibilityQuestion(original: string, normalized: string): Promise<ChatResult> {
  const config = getChatbotConfig();
  const matches = await searchKnowledge(normalized, Math.max(config.topK, 8), 0);
  const definition = matches.find(({ document }) => document.metadata.sourceId === "permenlhk-9-2021");
  const source = definition ? sourceFromMetadata(definition.document.metadata) : undefined;
  if (!definition || !source) {
    return { answer: clarificationAnswer(normalized), sources: [], catalogItems: [], needsClarification: true };
  }
  // Keep eligibility answers grounded in the definition document and let the
  // language model answer the user's actual wording. Passing the retrieved
  // match avoids embedding the same query a second time.
  const generated = await answerFromKnowledge(original, normalized, [], [definition]);
  const confirmsBoundary = /\b(?:belum cukup|belum bisa memastikan|belum dapat memastikan|tidak bisa memastikan|tidak dapat memastikan|belum tentu)\b/i.test(generated.answer);
  const mentionsKps = /\bKPS\b|Kelompok Perhutanan Sosial/i.test(generated.answer);
  const asksUsefulFollowup = /\?/.test(generated.answer) && /\b(?:kelompok|tergabung|sendiri|daerah|nama)\b/i.test(generated.answer);
  const talkingAboutFriend = /\b(?:teman|temen|kawan|sahabat)\b/i.test(normalized);
  const preservesSubject = !talkingAboutFriend || /\b(?:temanmu|temennya|temannya|kawannya|sahabatnya)\b/i.test(generated.answer);
  if (confirmsBoundary && mentionsKps && asksUsefulFollowup && preservesSubject) return generated;

  const registrationQuestion = /\b(?:daftar|mendaftar|pendaftaran|registrasi)\b/i.test(normalized);
  const activity = businessActivity(normalized);
  const activityLabel = activity
    ? talkingAboutFriend ? `Usaha ${activity.label} milik temanmu` : `Usaha ${activity.label}-mu`
    : talkingAboutFriend ? "Jenis usaha temanmu" : "Jenis usahamu";
  return {
    answer: registrationQuestion
      ? `${activityLabel} saja belum cukup untuk memastikan pendaftaran KUPS. Acuan yang kutemukan menjelaskan bahwa KUPS dibentuk oleh KPS dan sudah atau akan menjalankan usaha [S1]. Jadi, hal pertama yang perlu dicek ialah apakah usaha itu dijalankan bersama kelompok Perhutanan Sosial/KPS. ${talkingAboutFriend ? "Temanmu" : "Kamu"} sudah terhubung dengan KPS atau belum?`
      : `${activityLabel} saja belum cukup untuk memastikan cocok masuk KUPS. Acuan yang kutemukan menjelaskan bahwa KUPS dibentuk oleh KPS dan sudah atau akan menjalankan usaha [S1]. ${talkingAboutFriend ? "Temanmu" : "Kamu"} menjalankan usaha itu bersama kelompok Perhutanan Sosial/KPS atau masih sendiri?`,
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
  const config = getChatbotConfig();
  const matches = await searchKnowledge(normalized, Math.max(config.topK, 8), 0);
  const guide = matches.find(({ document }) => document.metadata.sourceId === "permenlhk-9-2021-business");
  const source = guide ? sourceFromMetadata(guide.document.metadata) : undefined;
  if (!guide || !source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const priorBusiness = [...history].reverse().find((turn) => turn.role === "user" && businessActivity(turn.content));
  const activity = businessActivity(normalized) ?? (priorBusiness ? businessActivity(priorBusiness.content) : undefined);
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
      : `Pendaftaran KUPS ditempuh lewat kelompok Perhutanan Sosial/KPS, bukan sebagai usaha perorangan. Biar aku bisa bantu petakan langkah berikutnya, jenis usaha apa yang mau ${talkingAboutFriend ? "dikembangkan temanmu" : "kamu kembangkan"}?`;
    return { answer, sources: [source], catalogItems: [], needsClarification: true };
  }

  // Give the small local model the retrieved legal passage, then check that it
  // retained the key facts. If it drifts, use a concise grounded guide.
  const generated = await answerFromKnowledge(original, normalized, history, [guide]);
  const generatedHasKps = /\bKPS\b|Kelompok Perhutanan Sosial/i.test(generated.answer);
  const generatedHasSource = generated.sources.some((item) => item.sourceId === source.sourceId);
  const generatedHasCoreFacts = kind === "benefits"
    ? /(?:produksi|nilai tambah)/i.test(generated.answer) && /(?:pasar|pemasaran|promosi)/i.test(generated.answer)
    : generatedHasKps && /\bKPH\b/i.test(generated.answer);
  const generatedHasCaveat = kind === "benefits"
    ? /(?:tidak|belum|bukan|tergantung).{0,45}(?:jamin|otomatis|pasti|program|syarat)|(?:tidak|belum|bukan).{0,35}otomatis/i.test(generated.answer)
    : /\?/.test(generated.answer) && /(?:kelompok|pendamping|wilayah|kabupaten|daerah)/i.test(generated.answer) &&
      (!/\bUPT\b/i.test(generated.answer) || /14\s*hari/i.test(generated.answer));
  const asksKpsStatus = /\bKPS\b|Kelompok Perhutanan Sosial/i.test(generated.answer) &&
    /\?/.test(generated.answer) && /(?:tergabung|terhubung|kelompok|sudah|belum)/i.test(generated.answer);
  const preservesSubject = !talkingAboutFriend || /\b(?:temanmu|temannya|temennya|kawannya)\b/i.test(generated.answer);
  if (generatedHasSource && generatedHasKps && generatedHasCoreFacts && generatedHasCaveat && asksKpsStatus && preservesSubject && activity && !userPreviouslySaidRunsOwn) {
    return generated;
  }

  const activityText = activity ? `Untuk usaha ${activity.label}, ` : "";
  const answer = kind === "benefits"
    ? talkingAboutFriend
      ? `Kalau temanmu mengembangkan usaha${activity ? ` ${activity.label}` : ""} lewat KUPS, dukungan yang bisa difasilitasi mencakup peningkatan produksi dan nilai tambah, promosi/pemasaran, serta akses permodalan [S1]. Tapi status KUPS tidak otomatis menjamin dapat uang, alat, pembeli, atau bantuan; itu bergantung pada program dan persyaratannya. Karena KUPS dibentuk oleh KPS, temanmu perlu mengecek apakah usahanya bisa dijalankan bersama kelompok Perhutanan Sosial. Temanmu sudah terhubung dengan KPS atau belum?`
      : `${activity ? `Buat usaha ${activity.label}, ` : ""}KUPS menjadi wadah kelompok untuk mengembangkan usaha Perhutanan Sosial. Dukungan yang bisa difasilitasi mencakup peningkatan produksi dan nilai tambah, promosi/pemasaran, serta akses permodalan [S1]. Tapi menjadi KUPS tidak otomatis menjamin dapat uang, alat, pembeli, atau bantuan; semuanya bergantung pada program dan persyaratan. ${userPreviouslySaidRunsOwn ? `Karena kamu bilang usahamu berjalan sendiri, langkah awalnya mencari KPS di daerahmu untuk membahas apakah usaha ini bisa dikembangkan bersama kelompok. Kamu berada di kabupaten/kota mana?` : `${activityText}Kamu sudah terhubung dengan KPS atau kelompok Perhutanan Sosial?`}`
    : `${activityText}jalurnya lewat kelompok, bukan mendaftar sebagai perorangan. KUPS dibentuk oleh KPS untuk mengembangkan usaha Perhutanan Sosial. Bahas komoditas dan rencana usahanya bersama KPS serta pendamping/KPH di daerahmu; penetapan KUPS dilakukan Kepala KPH. Jika belum ditetapkan dalam 14 hari kerja, penetapan dilakukan Kepala UPT [S1]. ${talkingAboutFriend ? "Temanmu" : "Kamu"} sudah tergabung di KPS atau belum?`;
  return { answer, sources: [source], catalogItems: [], needsClarification: true };
}

async function answerWithGroundedGuide(
  original: string,
  normalized: string,
  sourceId: "permenlhk-9-2021" | "permenlhk-9-2021-business",
  fallbackAnswer: string,
): Promise<ChatResult> {
  const config = getChatbotConfig();
  const matches = await searchKnowledge(normalized, Math.max(config.topK, 8), 0);
  const match = matches.find(({ document }) => document.metadata.sourceId === sourceId);
  const source = match ? sourceFromMetadata(match.document.metadata) : undefined;
  if (!match || !source) {
    return { answer: clarificationAnswer(original), sources: [], catalogItems: [], needsClarification: true };
  }

  const llm = new ChatOpenAI({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    temperature: 0.1,
    maxTokens: Math.min(config.llmMaxTokens, 150),
    timeout: 30_000,
    maxRetries: 0,
    modelKwargs: { reasoning_effort: "none" },
    configuration: { baseURL: config.llmBaseUrl },
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Kamu pendamping informasi KUPS-Web. Pengguna sudah punya usaha dan bertanya langkah awal. Jawab langsung dengan bahasa Indonesia percakapan, pakai aku/kamu, 2–3 kalimat. Jelaskan bahwa KUPS dibentuk oleh KPS, jadi langkah pertama adalah mengecek apakah usahanya terkait kelompok Perhutanan Sosial/KPS. Jangan putuskan kelayakan otomatis dan jangan mengarang bantuan. Akhiri dengan satu pertanyaan spesifik apakah pengguna sudah terhubung ke KPS dan di daerah mana. Jangan tulis catatan sumber; aplikasi menambahkan sitasi.",
    ],
    ["human", "Pertanyaan: {question}\n\nKonteks resmi: {context}"],
  ]);
  const chain = RunnableSequence.from([prompt, llm, new StringOutputParser()]);
  let generatedAnswer = "";
  try {
    generatedAnswer = await withInferenceSlot(() => chain.invoke({
      question: original,
      context: match.document.pageContent,
    }));
  } catch {
    // Use the grounded guide below if local inference fails.
  }
  const generated = generatedAnswer.trim();
  const usefulAndGrounded = /\bKUPS\b/i.test(generated) && /\bKPS\b/i.test(generated) &&
    /\?/.test(generated) && generated.split(/\s+/).filter(Boolean).length <= 90 &&
    !/\b(?:layanan|jaminan|pasti bisa|pasti dapat|otomatis layak)\b/i.test(generated);
  if (usefulAndGrounded) {
    return {
      answer: /\[S1\]/i.test(generated) ? generated : `${generated} [S1]`,
      sources: [source],
      catalogItems: [],
      needsClarification: true,
    };
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
  const config = getChatbotConfig();
  const matches = await searchKnowledge(normalized, Math.max(config.topK, 8), 0);
  const match = matches.find(({ document }) => document.metadata.sourceId === sourceId);
  const source = match ? sourceFromMetadata(match.document.metadata) : undefined;
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
  if (intent.type === "kups") return publicDataAnswer(intent, items, retrievedAt, stats);
  if (items.length === 0 && !stats) return publicDataAnswer(intent, items, retrievedAt, stats);

  const config = getChatbotConfig();
  const llm = new ChatOpenAI({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    temperature: 0.1,
    maxTokens: config.llmMaxTokens,
    timeout: 30_000,
    maxRetries: 0,
    modelKwargs: { reasoning_effort: "none" },
    configuration: { baseURL: config.llmBaseUrl },
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Kamu adalah asisten KUPS-Web yang ramah dan jelas. Jawab pertanyaan saat ini hanya memakai hasil retrieval. Pakai aku/kamu, bukan Anda. Di data, 'Nama listing' adalah nama produk/profil/publikasi; 'Kelompok pemilik' adalah KUPS pemilik listing; 'Kategori' adalah jenis produk, bukan nama atau kategori pemilik; 'Unit' adalah satuan produk. Jangan tertukar antar kolom. Sebut nama listing persis dan kelompok pemilik bila tersedia. Jika pengguna bertanya 'apa saja', sebutkan semua nama hasil yang diberikan, jangan hanya berkata ada hasil. Jika judul/deskripsi menyebut demo/contoh, jelaskan bahwa itu data demonstrasi, bukan konfirmasi penawaran nyata. Jangan mengarang harga, kontak, lokasi, status, syarat, atau fakta lain. Hasil kosong hanya berarti belum ditemukan di data publik. Jawab 2–4 kalimat, natural dan langsung. Jika relevan, tutup dengan pertanyaan spesifik seperti 'Mau aku bukakan detailnya?'. Jangan menyalin format data mentah atau menambah bagian Sumber; UI sudah menampilkan tautan.",
    ],
    [
      "human",
      "Pertanyaan asli pengguna:\n{question}\n\nJenis retrieval: {intent}\nKata kunci retrieval: {query}\nHasil retrieval dari data publik website:\n{context}\n\nData diambil pada: {checkedAt} WIB",
    ],
  ]);
  const context = [
    ...(stats ? [`Statistik publik: ${stats.kups} profil KUPS; ${stats.products} produk; ${stats.destinations} destinasi wisata; ${stats.provinces} provinsi.`] : []),
    ...items.map((item, index) => [
      `Hasil ${index + 1} — ${item.type}`,
      `Nama listing: ${item.title}`,
      `Kelompok pemilik: ${item.kupsName || "tidak dicantumkan"}`,
      `Kategori/jenis: ${item.category || "tidak dicantumkan"}`,
      `Deskripsi: ${item.description || "tidak dicantumkan"}`,
      `Lokasi: ${item.location || "tidak dicantumkan"}`,
      `Status: ${item.availability || "tidak dicantumkan"}`,
      `Unit: ${item.unit || "tidak dicantumkan"}`,
    ].join("\n")),
  ].join("\n\n");
  try {
    const chain = RunnableSequence.from([prompt, llm, new StringOutputParser()]);
    const answer = await withInferenceSlot(() => chain.invoke({
      question,
      intent: intent.type,
      query: intent.query || "(semua yang cocok)",
      context,
      checkedAt: formatCheckedAt(retrievedAt),
    }));
    const cleaned = answer.trim().replace(/^BUTUH_KLARIFIKASI:\s*/i, "");
    const completeListingAnswer = items.every((item) =>
      cleaned.toLocaleLowerCase().includes(item.title.toLocaleLowerCase()) &&
      (!item.kupsName || cleaned.toLocaleLowerCase().includes(item.kupsName.toLocaleLowerCase()))
    );
    const labelsDemoData = items.every((item) =>
      !/demo|contoh|demonstrasi/i.test(`${item.title} ${item.description}`) || /demo|contoh|demonstrasi/i.test(cleaned)
    );
    const correctFieldMapping = !/kategori\s+(?:pemilik|owner)|pemilik\s+(?:kategori|jenis)/i.test(cleaned);
    return cleaned && completeListingAnswer && labelsDemoData && correctFieldMapping
      ? cleaned
      : publicDataAnswer(intent, items, retrievedAt, stats);
  } catch {
    return publicDataAnswer(intent, items, retrievedAt, stats);
  }
}

function publicDataAnswer(intent: CatalogIntent, items: PublicCatalogItem[], retrievedAt: string, stats?: { kups: number; products: number; destinations: number; provinces: number }): string {
  const checkedAt = formatCheckedAt(retrievedAt);
  if (intent.type === "stats" && stats) {
    return `Di data publik KUPS-Web saat ini tercatat ${stats.kups} profil KUPS, ${stats.products} produk, dan ${stats.destinations} destinasi wisata yang tersebar di ${stats.provinces} provinsi. Angka ini bisa berubah saat data situs diperbarui; data diperiksa ${checkedAt} WIB.`;
  }
  if (intent.type === "stats") {
    return "Aku belum bisa membaca statistik publik KUPS-Web saat ini. Kamu tetap bisa mencari profil KUPS atau listing tertentu, atau coba tanya statistiknya lagi sebentar.";
  }
  if (items.length === 0) {
    const target = intent.query ? ` untuk “${intent.query}”` : "";
    const scope = intent.type === "kups" ? "profil KUPS" : intent.type === "publication" ? "publikasi" : intent.type === "tourism" ? "destinasi wisata" : "listing produk";
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
    return `Di katalog publik KUPS-Web, aku menemukan ${productCount}${queryText}: ${resultDetails}. Mau aku bukakan detailnya? Data diperiksa ${checkedAt} WIB.`;
  }
  return `Yang aku temukan ${items.length} hasil ${label}${queryText}: ${resultDetails}. ${nextStep[intent.type]} Data diperiksa ${checkedAt} WIB.`;
}

function businessActivity(question: string): { label: string; type: "product" | "tourism" } | undefined {
  const match = question.match(/\b(madu|kopi|duren|durian|kayu|kerajinan|wisata|ekowisata|homestay)\b/i)?.[0];
  if (!match) return undefined;
  const isTourism = /^(wisata|ekowisata|homestay)$/i.test(match);
  return { label: match, type: isTourism ? "tourism" : "product" };
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

function buildExpertHandoff(
  question: string,
  history: ChatTurn[],
  need: ExpertNeed,
): ExpertHandoff | null {
  const userText = [...history, { role: "user" as const, content: question }]
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join(" ");
  const activity = businessActivity(userText);
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
  const activity = businessActivity(combinedUserText);
  if (!activity) return undefined;
  const subject = /\b(?:teman|temen|kawan|sahabat)\b/i.test(combinedUserText) ? "temanmu" : "usahamu";

  if (isWaitingForKpsStatus(history)) {
    const connection = kpsConnection(question);
    if (!connection) {
      const statesBusinessExists = /\b(?:memiliki|punya|sudah|udah|menjalankan|jalanin|berjalan)\b/i.test(question);
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
  const answer = isFunding
    ? "Aku bisa bantu mencari informasi yang tersedia, tapi belum punya data program bantuan atau kepastian pendanaannya. Kamu sedang mencari program tertentu? Sebutkan nama program atau daerahnya agar aku bisa arahkan ke sumber yang tepat."
    : isMarket && activity && items.length > 0
      ? `Paham, kamu sedang butuh bantuan soal pemasaran ${activity.label}. Aku menemukan beberapa contoh listing publik yang sudah tampil di KUPS-Web; kartu di bawah bisa membantu melihat cara produk sejenis dipresentasikan. Produkmu sudah siap dipasarkan atau masih tahap rencana?`
      : isMarket && activity && catalogWasChecked
        ? `Paham, kamu sedang butuh bantuan soal pemasaran ${activity.label}. Aku belum menemukan listing publik yang cocok di KUPS-Web; itu bukan berarti usahanya tidak ada. Produkmu sudah siap dipasarkan atau masih tahap rencana?`
        : isMarket
          ? "Paham, akses pasar bisa jadi tantangan. Aku bisa bantu cek contoh listing publik dan informasi yang tersedia, lalu petakan pertanyaan berikutnya. Produk atau jasa apa yang ingin kamu pasarkan, dan di daerah mana?"
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
  if (GREETING_ONLY.test(compactQuestion)) {
    return quickReply("Hai! Aku asisten KUPS-Web. Kamu bisa tanya istilah atau aturan KUPS, minta dicari profil/produk/wisata/publikasi yang tampil di situs, atau cerita soal rencana usahamu. Lagi butuh bantuan yang mana?");
  }
  if (CAPABILITY_QUESTION.test(compactQuestion)) {
    return quickReply("Aku asisten informasi KUPS-Web. Aku bisa mencari profil, produk, wisata, publikasi dan statistik publik; menjelaskan aturan dengan rujukan; atau bantu memetakan langkah awal usaha. Aku tidak menetapkan status resmi, tapi kalau kebutuhanmu perlu dibahas lebih dalam, aku bisa merekomendasikan bidang expert dan membantu melihat pilihan jadwal konsultasi.");
  }
  if (IDENTITY_QUESTION.test(compactQuestion)) {
    return quickReply("Aku asisten informasi KUPS-Web. Aku membantu mencari profil kelompok, produk, wisata, publikasi, statistik, dan memahami aturan KUPS dari sumbernya. Kalau kamu sedang merintis usaha, ceritakan situasimu; aku bantu susun langkah awal dan, bila perlu, rekomendasikan expert KUPS yang bidangnya sesuai.");
  }
  if (WEBSITE_QUESTION.test(compactQuestion)) {
    return quickReply("Ini KUPS-Web, tempat melihat profil dan penawaran publik dari Kelompok Usaha Perhutanan Sosial, seperti produk dan destinasi wisata, serta publikasi terkait. Aku bisa bantu cari di dalam situs atau menjelaskan istilah dan aturan yang berkaitan. Kamu ingin mencari nama kelompok, produk, atau topik tertentu?");
  }

  if (/\b(?:expert|ahli|konsultasi)\b/i.test(compactQuestion)) {
    const explicitHandoff = await answerBusinessGuideFollowup(compactQuestion, history);
    if (explicitHandoff?.handoff) return explicitHandoff;
  }

  // Guidance questions take precedence over directory words such as "daftar".
  if (KUPS_REGISTRATION_GUIDE.test(compactQuestion)) {
    return answerKupsBusinessGuide(original, normalized, "registration", history);
  }
  if (KUPS_BENEFIT_QUESTION.test(compactQuestion)) {
    return answerKupsBusinessGuide(original, normalized, "benefits", history);
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
  const catalogIntent = detectCatalogIntent(normalized);
  if (catalogIntent?.type === "kups") {
    const result = await searchPublicCatalog(catalogIntent);
    const answer = await answerFromPublicResults(original, catalogIntent, result.items, result.retrievedAt, result.stats);
    return {
      answer,
      sources: sourcesFromPublicItems(result.items, result.retrievedAt),
      catalogItems: result.items,
      needsClarification: result.items.length === 0,
    };
  }
  const businessFollowup = await answerBusinessGuideFollowup(compactQuestion, history);
  if (businessFollowup) return businessFollowup;
  if (BUSINESS_PLANNING.test(compactQuestion)) {
    return answerBusinessPlanningQuestion(original);
  }

  if (isSupportFollowup(compactQuestion, history) === "group") {
    const groupDetails = cleanCatalogQuery(compactQuestion);
    if ( /\bkups\b/i.test(compactQuestion) && groupDetails.split(/\s+/).filter(Boolean).length >= 2) {
      const intent: CatalogIntent = { type: "kups", query: groupDetails };
      const result = await searchPublicCatalog(intent);
      const answer = await answerFromPublicResults(original, intent, result.items, result.retrievedAt, result.stats);
      return {
        answer,
        sources: sourcesFromPublicItems(result.items, result.retrievedAt),
        catalogItems: result.items,
        needsClarification: result.items.length === 0,
      };
    }
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

  if (isAmbiguousSingleItem(compactQuestion)) {
    return {
      answer: `Maksudmu “${compactQuestion}” ingin melihat contoh yang sudah tayang di katalog KUPS-Web, atau kamu sedang merencanakan usaha ${compactQuestion}? Kalau soal rencana usaha, ceritakan sedikit tahapmu; kalau katalog, balas “lihat katalog”.`,
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }

  if (KPS_PS_DIFFERENCE.test(compactQuestion)) {
    return answerKupsTermQuestion(original, normalized, "comparison");
  }

  if (ACRONYM_CLARIFICATION.test(compactQuestion) || KPS_DEFINITION_QUESTION.test(compactQuestion)) {
    const asksPs = /\bps\b/i.test(compactQuestion) && !/\bkps\b/i.test(compactQuestion);
    const isGpsAmbiguous = ACRONYM_CLARIFICATION.test(compactQuestion) || /\bgps\b/i.test(compactQuestion);
    const answer = isGpsAmbiguous
      ? "Kalau konteksnya Perhutanan Sosial, PS berarti Perhutanan Sosial; istilah kelompoknya adalah KPS (Kelompok Perhutanan Sosial). Jadi mungkin “GPS” yang kamu dengar maksudnya “KPS”. KUPS sendiri adalah kelompok usaha yang dibentuk oleh KPS dan sudah atau akan menjalankan usaha [S1]. Kamu sedang ingin memahami istilahnya atau mengecek rencana usaha tertentu?"
      : asksPs
        ? "PS adalah Perhutanan Sosial: sistem pengelolaan hutan lestari yang dijalankan masyarakat setempat atau masyarakat adat sebagai pelaku utama, untuk meningkatkan kesejahteraan sambil menjaga lingkungan dan kehidupan sosial-budaya [S1]. KPS berarti Kelompok Perhutanan Sosial; KUPS adalah kelompok usaha yang dibentuk oleh KPS [S1]. Kamu menanyakan artinya saja atau ingin tahu kaitannya dengan rencana usaha?"
        : "KPS adalah Kelompok Perhutanan Sosial. KUPS merupakan kelompok usaha yang dibentuk oleh KPS dan akan atau sudah menjalankan usaha [S1]. Kalau kamu ceritakan konteksnya, aku bisa bantu hubungkan istilah ini dengan informasi yang kamu butuhkan.";
    return answerFromApprovedFaq(normalized, "permenlhk-9-2021", answer, ACRONYM_CLARIFICATION.test(compactQuestion));
  }
  if (SUPPORT_NEED.test(compactQuestion)) {
    return answerSupportNeed(normalized);
  }
  if (PERSONAL_KUPS_STATUS.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "gokups-home",
      "Aku tidak punya data status tiap kelompok dalam indeks ini. Cek profil dan kelas kelompok langsung di GoKUPS karena datanya dapat berubah [S1].",
    );
  }
  if (KUPS_CLASS_QUESTION.test(compactQuestion)) {
    return answerFromApprovedFaq(
      normalized,
      "permenhut-18-2025",
      "Gambaran kelasnya bertahap: Blue/Biru masih di tahap awal; Silver/Perak mulai menguatkan kelembagaan dan pengelolaan areal; Gold/Emas berkembang pada kelembagaan, kawasan, dan usaha; Platinum sudah memiliki pasar stabil nasional atau internasional [S1]. Ini ringkasan, bukan rumus otomatis untuk menentukan kelas. Kamu ingin memahami kelas tertentu atau mencari status kelompokmu?",
    );
  }
  if (KUPS_DEFINITION_QUESTION.test(compactQuestion)) {
    return answerKupsTermQuestion(original, normalized, "definition");
  }
  if (compactQuestion.split(/\s+/).length === 1) {
    return {
      answer: `Aku belum nangkep maksud “${compactQuestion}”. Kamu mau cari profil KUPS, tanya aturan/istilah, melihat produk atau wisata, atau sedang butuh bantuan untuk rencana usaha?`,
      sources: [],
      catalogItems: [],
      needsClarification: true,
    };
  }

  return withInferenceSlot(() => answerFromKnowledge(original, normalized, history));
}
