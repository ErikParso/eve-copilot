#!/bin/sh

# Models were baked into the image at build time.
export HOME=/app
export OLLAMA_MODELS=/app/.ollama/models
export HF_HOME=/app/.cache/hf
export OLLAMA_URL=http://127.0.0.1:11434
export OLLAMA_KEEP_ALIVE=-1
export COMPANION_MODEL=llama3.2:1b
export KOKORO_DTYPE=q4
export PORT=7860

# Start Ollama and wait until it answers.
ollama serve &
until curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do sleep 1; done

# Node companion API (listens on $PORT directly — no nginx).
node --max-old-space-size=1536 dist/index.js
