# Local inference runtime

Install a `llama.cpp` build that provides `llama-server`, download a Qwen3-0.6B GGUF Q4 model from a source you trust, and store it outside version control. The launcher binds only to localhost, uses CPU inference, one request slot, and a 2,048-token context. The model's memory use depends on its exact quantization and build; measure it together with Next.js and the embedding runtime before deployment.
