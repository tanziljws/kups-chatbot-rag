import type { ChatTurn } from "./types";

type KpsConnection = "connected" | "not_connected";
type BusinessActivity = { label: string; type: "product" | "tourism" };

export type ConversationContext = {
  activity?: BusinessActivity;
  connection?: KpsConnection;
  scale?: "small" | "medium" | "large";
  ownership?: "individual" | "family" | "group";
  location?: string;
  talkingAboutFriend: boolean;
};

export function businessActivity(question: string): BusinessActivity | undefined {
  const match = question.match(
    /\b(madu|kopi|duren|durian|bambu|rotan|kerajinan|wisata|ekowisata|homestay|aren|gula\s+semut|gaharu|kemiri|porang|jamur|lebah|madu\s+hutan)\b/i,
  )?.[0];
  if (!match) return undefined;
  const isTourism = /^(wisata|ekowisata|homestay)$/i.test(match);
  return { label: match, type: isTourism ? "tourism" : "product" };
}

function latestBusinessActivity(
  history: ChatTurn[],
  currentQuestion = "",
): BusinessActivity | undefined {
  const turns = [
    ...history.filter((turn) => turn.role === "user"),
    ...(currentQuestion ? [{ role: "user" as const, content: currentQuestion }] : []),
  ];
  for (const turn of turns.reverse()) {
    const activity = businessActivity(turn.content);
    if (activity) return activity;
  }
  return undefined;
}

/**
 * Only explicit first-person statements update the user's KPS relationship.
 * Hypothetical questions such as "kalau kelompoknya sudah ada" do not.
 */
function kpsConnection(question: string): KpsConnection | undefined {
  const text = question.trim();

  const explicitNegative =
    /\b(?:aku|saya|kami|usaha\s+saya|usaha\s+kami)\b.{0,65}\b(?:belum)\b.{0,35}\b(?:punya|memiliki|bergabung|tergabung|terhubung)\b.{0,35}\b(?:kelompok|kps)\b/i.test(text) ||
    /\b(?:belum\s+(?:punya|memiliki|tergabung|terhubung|bergabung))\s+(?:dengan\s+)?(?:kelompok|kps)\b/i.test(text) ||
    /\b(?:tidak|enggak|nggak|gak|belum)\s+(?:punya|memiliki)\s+(?:kelompok|kps)\b/i.test(text) ||
    /\b(?:masih\s+sendiri|dikelola\s+sendiri|usaha\s+(?:saya|aku)\s+sendiri)\b/i.test(text);
  if (explicitNegative) return "not_connected";

  const hypothetical =
    /^(?:kalau|kalo|jika|misalnya|seandainya)\b/i.test(text) ||
    /\b(?:kalau|jika|misalnya|seandainya)\s+(?:kelompok|kps)\b/i.test(text);
  if (hypothetical) return undefined;

  const explicitPositive =
    /\b(?:aku|saya|kami|usaha\s+saya|usaha\s+kami)\b.{0,65}\b(?:sudah|telah)\b.{0,35}\b(?:punya|memiliki|bergabung|tergabung|terhubung)\b.{0,35}\b(?:kelompok|kps)\b/i.test(text) ||
    /\b(?:sudah|telah)\s+(?:bergabung|tergabung|terhubung)\s+(?:dengan\s+)?(?:kelompok|kps)\b/i.test(text) ||
    /\b(?:sudah|telah)\s+punya\s+(?:kelompok|kps)\b/i.test(text);
  if (explicitPositive) return "connected";

  return undefined;
}

export function extractScale(text: string): ConversationContext["scale"] {
  if (/\b(?:kecil(?:-kecilan)?|skala\s+kecil|baru\s+mulai|rintisan)\b/i.test(text)) return "small";
  if (/\b(?:menengah|skala\s+menengah)\b/i.test(text)) return "medium";
  if (/\b(?:besar|skala\s+besar)\b/i.test(text)) return "large";
  return undefined;
}

export function extractOwnership(text: string): ConversationContext["ownership"] {
  if (/\b(?:dikelola\s+keluarga|usaha\s+keluarga|bersama\s+keluarga|keluarga\s+saya)\b/i.test(text)) return "family";
  if (/\b(?:sendiri|perorangan|individu|pribadi)\b/i.test(text)) return "individual";
  if (/\b(?:bersama\s+kelompok|dikelola\s+kelompok|kelompok\s+saya|kelompok\s+kami)\b/i.test(text)) return "group";
  return undefined;
}

export function extractLocation(text: string): string | undefined {
  const match = text.match(
    /\b(?:tinggal\s+di|berada\s+di|lokasi(?:\s+usaha)?\s+di|di\s+wilayah|di\s+kabupaten|di\s+kota)\s+([A-Z][\p{L} .'-]{1,45}?)(?=[,.;!?]|\s+(?:ada|apakah|mau|ingin|dan|untuk|sekitar)\b|$)/iu,
  );
  return match?.[1]?.trim().replace(/\s+/g, " ");
}

export function buildConversationContext(
  history: ChatTurn[],
  currentQuestion: string,
): ConversationContext {
  const userMessages = [
    ...history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    currentQuestion,
  ].filter(Boolean);

  let connection: KpsConnection | undefined;
  let scale: ConversationContext["scale"];
  let ownership: ConversationContext["ownership"];
  let location: string | undefined;

  for (const message of userMessages) {
    const nextConnection = kpsConnection(message);
    if (nextConnection) connection = nextConnection;
    scale = extractScale(message) ?? scale;
    ownership = extractOwnership(message) ?? ownership;
    location = extractLocation(message) ?? location;
  }

  const allUserText = userMessages.join(" ");
  return {
    activity: latestBusinessActivity(history, currentQuestion),
    connection,
    scale,
    ownership,
    location,
    talkingAboutFriend: /\b(?:teman|temen|kawan|sahabat)\b/i.test(allUserText),
  };
}

export function isKupsConversation(history: ChatTurn[]): boolean {
  const recentText = history.slice(-12).map((turn) => turn.content).join(" ");
  return /\b(?:kups|kps|perhutanan\s+sosial|kelompok\s+perhutanan\s+sosial)\b/i.test(recentText);
}

export function isPersonalEligibilityFollowup(question: string, history: ChatTurn[]): boolean {
  if (!isKupsConversation(history)) return false;
  const mentionsPersonalBusiness = /\b(?:aku|saya|kami|usaha|bisnis|jualan|sendiri|perorangan|individu|kecil(?:-kecilan)?)\b/i.test(question);
  const asksAboutParticipation = /\b(?:bisa|boleh|ikut|gabung|bergabung|masuk|layak|gimana|bagaimana)\b/i.test(question);
  return mentionsPersonalBusiness && asksAboutParticipation;
}
