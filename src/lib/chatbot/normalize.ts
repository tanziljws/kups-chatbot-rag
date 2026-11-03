const safeCorrections: Array<[RegExp, string]> = [
  [/\bsebenernya\b/gi, "sebenarnya"],
  [/\bklompok\b/gi, "kelompok"],
  [/\bgmn\b/gi, "gimana"],
  [/\bjd\b/gi, "jadi"],
  [/\bsm\b/gi, "sama"],
  [/\bsingktn\b/gi, "singkatan"],
  [/\bpngajuan\b/gi, "pengajuan"],
  [/\bgimna\b/gi, "gimana"],
  [/\bkalo\b/gi, "kalau"],
  [/\bttg\b/gi, "tentang"],
  [/\b(perhutnaan|perhutanan)\s+sosil\b/gi, "Perhutanan Sosial"],
  [/\bperhutanan\s+social\b/gi, "Perhutanan Sosial"],
  [/\bkelompok\s+usaha\s+perhutanan\s+social\b/gi, "Kelompok Usaha Perhutanan Sosial"],
  [/\b(pruduk|prodak|produck|produk2)\b/gi, "produk"],
  [/\b(wistaa|wista)\b/gi, "wisata"],
  [/\b(publiaksi|publikassi)\b/gi, "publikasi"],
  [/\bduren\b/gi, "durian"],
  [/\bkups\b/gi, "KUPS"],
  [/\bkps\b/gi, "KPS"],
];

export type NormalizedQuestion = {
  original: string;
  normalized: string;
};

export function normalizeQuestion(input: string): NormalizedQuestion {
  const original = input.normalize("NFC").trim();
  let normalized = original
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ");

  for (const [pattern, replacement] of safeCorrections) {
    normalized = normalized.replace(pattern, replacement);
  }

  return { original, normalized };
}
