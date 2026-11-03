export type ExpertProfile = {
  id: string;
  title: string;
  specialties: string[];
  description: string;
  relatedTopics: string[];
};

// Illustrative expertise categories. Replace with verified KUPS expert records before launch.
export const expertDirectory: ExpertProfile[] = [
  {
    id: "pengembangan-usaha",
    title: "Ahli pengembangan usaha",
    specialties: ["Strategi usaha", "Rencana pengembangan", "Model bisnis"],
    description:
      "Membantu kelompok memetakan kondisi usaha dan menentukan langkah pengembangan yang realistis.",
    relatedTopics: ["Pengembangan usaha", "Modal & rencana usaha"],
  },
  {
    id: "pemasaran-akses-pasar",
    title: "Ahli pemasaran & akses pasar",
    specialties: [
      "Pemasaran produk",
      "Pengembangan pasar",
      "Kemitraan pembeli",
    ],
    description:
      "Membahas cara mengenalkan produk, memahami calon pembeli, dan memilih saluran pemasaran.",
    relatedTopics: ["Pemasaran & akses pasar", "Merek & kemasan"],
  },
  {
    id: "produksi-mutu",
    title: "Ahli produksi & mutu",
    specialties: [
      "Pengolahan komoditas",
      "Kualitas produk",
      "Standar produksi",
    ],
    description:
      "Membantu meninjau proses produksi, mutu hasil, dan kesiapan produk untuk dikembangkan.",
    relatedTopics: ["Produksi & mutu", "Pengelolaan komoditas"],
  },
  {
    id: "kelembagaan-legalitas",
    title: "Ahli kelembagaan & legalitas",
    specialties: ["Penguatan kelompok", "Legalitas usaha", "Perhutanan sosial"],
    description:
      "Membahas pengelolaan kelompok, pembagian peran, dan kebutuhan legalitas yang relevan.",
    relatedTopics: ["Kelembagaan KUPS", "Legalitas & sertifikasi"],
  },
];

export function findExpert(id: string | null | undefined) {
  return expertDirectory.find((expert) => expert.id === id);
}
