#!/bin/sh
set -eu

PORT="${PORT:-11434}"
export OLLAMA_HOST="0.0.0.0:${PORT}"
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_KEEP_ALIVE=30m
export NVIDIA_VISIBLE_DEVICES=void

ollama serve &
server=$!

ready=0
i=0
while [ "$i" -lt 30 ]; do
  if ollama list >/dev/null 2>&1; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "Ollama did not become ready."
  kill "$server" || true
  exit 1
fi

MODEL="${LLM_MODEL:-qwen3.5:2b}"
if ! ollama list | awk '{print $1}' | grep -qx "$MODEL"; then
  ollama pull "$MODEL"
fi

wait "$server"
