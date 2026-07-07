FROM node:20-slim

# curl (Ollama install & health check) + certs + zstd (Ollama installer needs it)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama (glibc binary — does not run on Alpine/musl, hence node:20-slim)
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app
COPY . .

RUN npm ci
RUN npm run build

# --- Bake the models into the image (the Space's disk is ephemeral) ---
ENV OLLAMA_MODELS=/app/.ollama/models
ENV HF_HOME=/app/.cache/hf

# Ollama LLM: start the daemon, wait, pull the model, then KILL the daemon —
# otherwise the backgrounded `ollama serve` keeps this RUN step alive forever.
RUN mkdir -p /app/.ollama/models
RUN ollama serve & OLLAMA_PID=$!; \
    until curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do sleep 1; done; \
    ollama pull llama3.2:1b; STATUS=$?; \
    kill "$OLLAMA_PID" 2>/dev/null; \
    exit $STATUS

# Kokoro TTS: one synth downloads the ONNX model into HF_HOME. process.exit(0) so
# the run doesn't hang (kokoro's onnxruntime threads would keep it alive).
RUN node -e "import('./dist/tts.js').then(m=>m.synthesize('warm up')).then(()=>{console.log('kokoro baked');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Hugging Face Spaces runs as UID 1000 — everything (incl. baked models) must be writable.
RUN chown -R 1000:1000 /app

USER 1000
EXPOSE 7860
ENTRYPOINT ["/app/start.sh"]
