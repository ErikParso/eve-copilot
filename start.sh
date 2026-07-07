#!/bin/sh

# Companion runtime config (models were baked into the image at build time).
export HOME=/app
export OLLAMA_MODELS=/app/.ollama/models
export HF_HOME=/app/.cache/hf
export OLLAMA_URL=http://127.0.0.1:11434
export OLLAMA_KEEP_ALIVE=-1
export KOKORO_DTYPE=q4

# Start Ollama in the background and wait until it answers.
ollama serve &
until curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do sleep 1; done

# Start the Node.js Express backend in the background
cd /app/server
node --max-old-space-size=1536 dist/index.js &

# Start Nginx in the foreground
nginx -c /etc/nginx/nginx.conf
