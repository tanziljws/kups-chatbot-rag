#!/bin/sh
set -eu

: "${LLAMA_MODEL_PATH:?Set LLAMA_MODEL_PATH to a local Qwen3-0.6B GGUF file}"
if [ ! -f "$LLAMA_MODEL_PATH" ]; then
  printf '%s\n' "Model file not found: $LLAMA_MODEL_PATH" >&2
  exit 1
fi

exec llama-server \
  --model "$LLAMA_MODEL_PATH" \
  --host 127.0.0.1 \
  --port 8081 \
  --ctx-size 2048 \
  --parallel 1 \
  --threads 2 \
  --n-gpu-layers 0
