import type { PublicCatalogItem } from "./catalog";

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
