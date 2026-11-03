export type EvaluationQuestion = {
  id: string;
  question: string;
  expectedSource: string;
  expectedSourceId?: string;
  mustInclude: string;
  mustNotInclude?: string[];
  expectClarification: boolean;
  expectNoSources?: boolean;
  expectedCatalogType?: "product" | "tourism" | "kups" | "publication";
  expectedResponseKind?: "answer" | "clarification" | "catalog" | "handoff";
  history?: Array<{ role: "assistant" | "user"; content: string }>;
};

export type ChatResponse = {
  answer: string;
  sources: Array<{ url: string; sourceId?: string }>;
  catalogItems: Array<{ type: string; sourceUrl: string }>;
  needsClarification: boolean;
  handoff: { specialty: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEvaluationQuestion(value: unknown): EvaluationQuestion {
  if (!isRecord(value)) {
    throw new Error("Evaluation record must be an object.");
  }
  if (
    typeof value.id !== "string" ||
    typeof value.question !== "string" ||
    typeof value.expectedSource !== "string" ||
    typeof value.mustInclude !== "string" ||
    typeof value.expectClarification !== "boolean"
  ) {
    throw new Error("Evaluation record is missing a required field or has an invalid field type.");
  }
  const responseKinds = ["answer", "clarification", "catalog", "handoff"];
  const catalogTypes = ["product", "tourism", "kups", "publication"];
  if (
    (value.expectedSourceId !== undefined && typeof value.expectedSourceId !== "string") ||
    (value.mustNotInclude !== undefined &&
      (!Array.isArray(value.mustNotInclude) ||
        !value.mustNotInclude.every((phrase) => typeof phrase === "string"))) ||
    (value.expectNoSources !== undefined && typeof value.expectNoSources !== "boolean") ||
    (value.expectedCatalogType !== undefined &&
      (typeof value.expectedCatalogType !== "string" || !catalogTypes.includes(value.expectedCatalogType))) ||
    (value.expectedResponseKind !== undefined &&
      (typeof value.expectedResponseKind !== "string" || !responseKinds.includes(value.expectedResponseKind)))
  ) {
    throw new Error(`Evaluation record ${value.id} has an invalid optional field.`);
  }
  if (
    value.history !== undefined &&
    (!Array.isArray(value.history) ||
      !value.history.every(
        (turn) =>
          isRecord(turn) &&
          (turn.role === "assistant" || turn.role === "user") &&
          typeof turn.content === "string",
      ))
  ) {
    throw new Error(`Evaluation record ${value.id} has invalid history.`);
  }
  return {
    id: value.id,
    question: value.question,
    expectedSource: value.expectedSource,
    expectedSourceId: value.expectedSourceId as string | undefined,
    mustInclude: value.mustInclude,
    mustNotInclude: value.mustNotInclude as string[] | undefined,
    expectClarification: value.expectClarification,
    expectNoSources: value.expectNoSources as boolean | undefined,
    expectedCatalogType: value.expectedCatalogType as EvaluationQuestion["expectedCatalogType"],
    expectedResponseKind: value.expectedResponseKind as EvaluationQuestion["expectedResponseKind"],
    history: value.history as EvaluationQuestion["history"],
  };
}

export function parseChatResponse(value: unknown): ChatResponse {
  if (!isRecord(value)) {
    throw new Error("Chat response must be an object.");
  }
  if (
    typeof value.answer !== "string" ||
    typeof value.needsClarification !== "boolean" ||
    !Array.isArray(value.sources) ||
    !value.sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.url === "string" &&
        (source.sourceId === undefined || typeof source.sourceId === "string"),
    ) ||
    !Array.isArray(value.catalogItems) ||
    !value.catalogItems.every(
      (item) => isRecord(item) && typeof item.type === "string" && typeof item.sourceUrl === "string",
    ) ||
    (value.handoff !== undefined &&
      value.handoff !== null &&
      (!isRecord(value.handoff) || typeof value.handoff.specialty !== "string"))
  ) {
    throw new Error("Chat response does not match the expected API contract.");
  }
  const sources = value.sources.map((source) => ({
    url: (source as Record<string, unknown>).url as string,
    sourceId: (source as Record<string, unknown>).sourceId as string | undefined,
  }));
  const catalogItems = value.catalogItems.map((item) => ({
    type: (item as Record<string, unknown>).type as string,
    sourceUrl: (item as Record<string, unknown>).sourceUrl as string,
  }));
  return {
    answer: value.answer,
    sources,
    catalogItems,
    needsClarification: value.needsClarification,
    handoff: isRecord(value.handoff) ? { specialty: value.handoff.specialty as string } : null,
  };
}

export function failedEvaluationChecks(
  item: EvaluationQuestion,
  payload: ChatResponse,
): string[] {
  const answer = payload.answer.toLocaleLowerCase("id-ID");
  const hasSource = !item.expectedSource || payload.sources.some((source) => source.url === item.expectedSource);
  const hasSourceId =
    !item.expectedSourceId || payload.sources.some((source) => source.sourceId === item.expectedSourceId);
  const hasConcept = !item.mustInclude || answer.includes(item.mustInclude.toLocaleLowerCase("id-ID"));
  const hasNoForbiddenText =
    !item.mustNotInclude?.length ||
    item.mustNotInclude.every((phrase) => !answer.includes(phrase.toLocaleLowerCase("id-ID")));
  const clarificationMatches = payload.needsClarification === item.expectClarification;
  const sourcesMatch = !item.expectNoSources || payload.sources.length === 0;
  const catalogMatches =
    !item.expectedCatalogType ||
    (payload.catalogItems.length > 0 &&
      payload.catalogItems.every(
        (catalogItem) =>
          catalogItem.type === item.expectedCatalogType && Boolean(catalogItem.sourceUrl),
      ));
  const responseKindMatches =
    !item.expectedResponseKind ||
    (item.expectedResponseKind === "catalog"
      ? payload.catalogItems.length > 0
      : item.expectedResponseKind === "handoff"
        ? Boolean(payload.handoff)
        : item.expectedResponseKind === "clarification"
          ? payload.needsClarification
          : !payload.needsClarification && payload.catalogItems.length === 0 && !payload.handoff);
  return [
    !hasSource && "source URL",
    !hasSourceId && "source ID",
    !hasConcept && "answer concept",
    !hasNoForbiddenText && "forbidden claim",
    !clarificationMatches && "clarification flag",
    !sourcesMatch && "unexpected source",
    !catalogMatches && "catalog type/provenance",
    !responseKindMatches && "response kind",
  ].filter((check): check is string => Boolean(check));
}
