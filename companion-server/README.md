---
title: EVE Companion Server
emoji: 🛰️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# EVE Companion Server

Standalone AI companion backend for the EVE multitool. Runs its **own** local
Ollama (`llama3.2:1b`, text) + Kokoro TTS (voice) so it never contends for CPU with
the main app's market crawler. Both models are baked into the image.

## API

`POST /api/companion/react` — body `{ action, payload }` → `{ text, audio }`
(`audio` = base64 WAV, or `null` if TTS is off/failed).

- `429 { status: "occupied" }` — a reaction is already running (single-flight).
- `504 { status: "aborted" }` — hit the 30s timeout; generation stopped, CPU freed.

`GET /api/health` → `{ ok: true }`.

CORS is open, so the main app's frontend can call this Space directly.

## Deploy (Hugging Face Docker Space)

1. Create a new **Docker** Space.
2. Push this `companion-server/` directory as the Space repo root (so `Dockerfile`
   is at the root). The build bakes the models (~2GB image, slow first build).
3. Point the main app's frontend at this Space via `VITE_COMPANION_URL`
   (e.g. `https://<owner>-<space>.hf.space`).

## Env

`OLLAMA_URL` (127.0.0.1:11434), `COMPANION_MODEL` (llama3.2:1b), `COMPANION_TTS`
(`off` to disable), `KOKORO_VOICE` (af_heart), `KOKORO_DTYPE` (q4),
`COMPANION_TIMEOUT_MS` (30000), `PORT` (7860).

## Local dev

```bash
npm install
ollama serve           # if not already running
ollama pull llama3.2:1b
npm run dev            # listens on :7860
```
The web app's Vite dev server proxies `/api/companion` → `http://localhost:7860`.
