FROM node:20-slim

# Nginx + curl (Ollama install & health check) + certs + zstd (Ollama installer needs it)
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama (glibc binary — does not run on Alpine/musl, hence node:20-slim)
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app

# Copy all source files
COPY . .

# Build the Backend
WORKDIR /app/server
RUN npm ci
RUN npm run build

# Build the Frontend (Vite). The AI companion is enabled by default — no flag needed.
WORKDIR /app/web
RUN npm ci

# Build the frontend using the Hugging Face secret mount
RUN --mount=type=secret,id=VITE_EVE_CLIENT_ID,mode=0444,required=true \
    --mount=type=secret,id=VITE_ADSENSE_CLIENT_ID,mode=0444,required=false \
    --mount=type=secret,id=VITE_ADSENSE_DESKTOP_SLOT_ID,mode=0444,required=false \
    --mount=type=secret,id=VITE_ADSENSE_MOBILE_SLOT_ID,mode=0444,required=false \
    VITE_EVE_CLIENT_ID=$(cat /run/secrets/VITE_EVE_CLIENT_ID) \
    VITE_ADSENSE_CLIENT_ID=$( [ -f /run/secrets/VITE_ADSENSE_CLIENT_ID ] && cat /run/secrets/VITE_ADSENSE_CLIENT_ID || echo "" ) \
    VITE_ADSENSE_DESKTOP_SLOT_ID=$( [ -f /run/secrets/VITE_ADSENSE_DESKTOP_SLOT_ID ] && cat /run/secrets/VITE_ADSENSE_DESKTOP_SLOT_ID || echo "" ) \
    VITE_ADSENSE_MOBILE_SLOT_ID=$( [ -f /run/secrets/VITE_ADSENSE_MOBILE_SLOT_ID ] && cat /run/secrets/VITE_ADSENSE_MOBILE_SLOT_ID || echo "" ) \
    npm run build

# --- Bake the AI models into the image ---
# The Space's disk is ephemeral, so a runtime download would repeat on every cold
# start. Baking them makes boot fast and offline. Owned by UID 1000 via the chown below.
ENV OLLAMA_MODELS=/app/.ollama/models
ENV HF_HOME=/app/.cache/hf

# Ollama LLM: start the daemon, wait for it, pull the model into OLLAMA_MODELS,
# then KILL the daemon — otherwise the backgrounded `ollama serve` keeps this RUN
# step alive forever and the build hangs.
RUN mkdir -p /app/.ollama/models
RUN ollama serve & OLLAMA_PID=$!; \
    until curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do sleep 1; done; \
    ollama pull llama3.2:1b; STATUS=$?; \
    kill "$OLLAMA_PID" 2>/dev/null; \
    exit $STATUS

# Kokoro TTS: dist/tts.js is already built; one synth downloads the ONNX model into HF_HOME.
RUN cd /app/server && node -e "import('./dist/tts.js').then(m=>m.synthesize('warm up')).then(()=>console.log('kokoro baked')).catch(e=>{console.error(e);process.exit(1)})"

# Set up Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Set up startup entrypoint
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Hugging Face Spaces runs as user 1000, so we make sure the app directory (incl.
# the baked models) is writable
RUN chown -R 1000:1000 /app /var/lib/nginx /var/log/nginx

# Run as non-root user (required by Hugging Face)
USER 1000

EXPOSE 7860

ENTRYPOINT ["/app/start.sh"]
