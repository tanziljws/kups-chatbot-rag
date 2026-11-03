import { buildConversationContext } from "./conversation-context";
import { answerFromApprovedFaq } from "./knowledge-answers";
import type { ChatResult, ChatTurn } from "./types";

export async function answerKupsDevelopmentFollowup(
  question: string,
  history: ChatTurn[],
): Promise<ChatResult> {
  const context = buildConversationContext(history, question);
  const activityText = context.activity ? `usaha ${context.activity.label}` : "usaha";

  // A hypothetical group scenario must not change the user's saved membership status.
  const asksHypotheticalGroup =
    /\b(?:kalau|kalo|jika|misalnya|seandainya)\b.{0,45}\b(?:kelompok(?:nya)?|kps)\b/i.test(question) &&
    /\b(?:sudah|ada|terbentuk|terbina)\b/i.test(question) &&
    /\b(?:bisa|dapat|dikembangkan|bersama|gabung)\b/i.test(question);
  if (asksHypotheticalGroup) {
    return answerFromApprovedFaq(
      question,
      "permenlhk-9-2021-business",
      `Bisa dibahas bersama KPS. Jika kelompok Perhutanan Sosialnya sudah ada, kamu dapat membicarakan potensi dan rencana ${activityText} dengan kelompok tersebut. Pengembangannya perlu disepakati bersama dan disesuaikan dengan persetujuan Perhutanan Sosial serta rencana usaha kelompok. Itu belum otomatis berarti usaha perorangan langsung menjadi usaha KUPS [S1].`,
      false,
    );
  }

  if (context.connection === "not_connected") {
    return answerFromApprovedFaq(
      question,
      "permenlhk-9-2021-business",
      `Untuk mengembangkan ${activityText}, catat dulu hasil produksi, kendala mutu/pengolahan, biaya, dan calon pembeli agar rencana usahanya lebih jelas. Karena kamu belum punya kelompok, langkah berikutnya mencari KPS yang memegang persetujuan Perhutanan Sosial di wilayahmu dan menanyakan mekanisme bergabung. Setelah itu, bahas rencana dan kebutuhan usaha bersama KPS serta pendamping Perhutanan Sosial/KPH [S1].`,
      true,
    );
  }

  if (context.connection === "connected") {
    return answerFromApprovedFaq(
      question,
      "permenlhk-9-2021-business",
      `Bisa dibahas bersama KPS. Pengembangan ${activityText} dapat direncanakan sebagai bagian dari kegiatan usaha kelompok, sepanjang sesuai dengan persetujuan Perhutanan Sosial, potensi wilayah, dan kesepakatan kelompok. Bahas rencana usaha dan kebutuhan dukungannya bersama KPS serta pendamping/KPH [S1].`,
      false,
    );
  }

  return answerFromApprovedFaq(
    question,
    "permenlhk-9-2021-business",
    "Bisa dibahas bersama kelompok KPS, tetapi belum otomatis berarti usaha perorangan langsung menjadi usaha KUPS. Pengembangan usaha perlu dibicarakan dengan KPS dan disesuaikan dengan persetujuan Perhutanan Sosial serta rencana usaha kelompok [S1].",
    true,
  );
}
