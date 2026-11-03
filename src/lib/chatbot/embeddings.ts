import { Embeddings } from "@langchain/core/embeddings";
import { env, pipeline, type FeatureExtractionPipelineType } from "@huggingface/transformers";

env.cacheDir = `${process.cwd()}/.cache/huggingface`;
env.allowRemoteModels = process.env.HF_ALLOW_REMOTE !== "false";
env.useBrowserCache = false;

let extractorPromise: Promise<FeatureExtractionPipelineType> | undefined;
const createPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: { dtype: "uint8"; device: "cpu" },
) => Promise<FeatureExtractionPipelineType>;

async function getExtractor() {
  extractorPromise ??= createPipeline(
    "feature-extraction",
    process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",
    // The Xenova ONNX repository provides model_uint8.onnx, an 8-bit quantized
    // encoder that Transformers.js loads with dtype="uint8".
    { dtype: "uint8", device: "cpu" },
  ).catch((error) => {
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
}

function asRows(output: Awaited<ReturnType<FeatureExtractionPipelineType>>, count: number): number[][] {
  const width = output.dims.at(-1);
  if (!width || output.data.length !== count * width) {
    throw new Error("Embedding model returned an unexpected shape.");
  }
  return Array.from({ length: count }, (_, index) =>
    Array.from(output.data.slice(index * width, (index + 1) * width), Number),
  );
}

export class LocalMiniLMEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    const extractor = await getExtractor();
    const output = await extractor(documents, { pooling: "mean", normalize: true });
    return asRows(output, documents.length);
  }

  async embedQuery(query: string): Promise<number[]> {
    const extractor = await getExtractor();
    const output = await extractor(query, { pooling: "mean", normalize: true });
    return asRows(output, 1)[0];
  }
}
