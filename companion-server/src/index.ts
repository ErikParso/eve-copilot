// Standalone AI companion server. One endpoint: POST /api/companion/react →
// { text, audio }. Runs its own Ollama (LLM) + Kokoro (TTS) so it never contends
// with the main app's market crawler. Listens directly on $PORT (no nginx).
import express from 'express';
import cors from 'cors';
import { generateReaction, buildReactionPrompt, warmModel } from './companion.js';
import { isCompanionAction } from './briefs.js';
import { synthesize, isTtsEnabled, warmTts } from './tts.js';

const PORT = Number(process.env.PORT ?? 7860);
// Hard cap per reaction so a slow one can't hog resources indefinitely.
const COMPANION_TIMEOUT_MS = Number(process.env.COMPANION_TIMEOUT_MS ?? 30_000);
// Single-flight: at most one reaction at a time. Extra requests get "occupied"
// instead of queuing (a queue is what let the LLM back up to minutes).
let companionBusy = false;

// Never let a stray error take the server down.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection (ignored):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception (ignored):', err);
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// One call returns both the text reaction and its spoken audio (base64 WAV).
app.post('/api/companion/react', async (req, res) => {
  const { action, payload } = (req.body ?? {}) as Record<string, unknown>;
  if (!isCompanionAction(action)) {
    return res.status(400).json({ error: 'unknown or missing action' });
  }
  // Reject concurrent reactions instead of queuing them.
  if (companionBusy) {
    console.log(`[Companion] occupied — rejecting ${action} (a reaction is already running)`);
    return res.status(429).json({ status: 'occupied' });
  }
  companionBusy = true;

  const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMPANION_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const { system, user } = buildReactionPrompt(action, data);
    const text = await generateReaction(system, user, controller.signal);
    const tLlm = Date.now();

    let audio: string | null = null;
    if (isTtsEnabled() && text) {
      // TTS can't be cancelled mid-synth, so don't start it if already over budget.
      if (Date.now() - t0 >= COMPANION_TIMEOUT_MS) {
        console.log(`[Companion] ${action}: over budget after LLM (${tLlm - t0}ms) — skipping TTS`);
      } else {
        try {
          const wav = await synthesize(text);
          audio = wav.toString('base64');
        } catch (err) {
          console.error('[Companion] TTS failed (text still returned)', err);
        }
      }
    }
    const tTts = Date.now();
    console.log(`[Companion] ${action}: LLM ${tLlm - t0}ms, TTS ${tTts - tLlm}ms, total ${tTts - t0}ms`);
    res.json({ text, audio });
  } catch (err) {
    if (controller.signal.aborted) {
      console.warn(`[Companion] ${action}: ABORTED after ${Date.now() - t0}ms (>${COMPANION_TIMEOUT_MS}ms) — generation stopped, resources freed`);
      res.status(504).json({ status: 'aborted' });
    } else {
      console.error('POST /api/companion/react failed', err);
      res.status(502).json({ error: err instanceof Error ? err.message : 'Companion error' });
    }
  } finally {
    clearTimeout(timeout);
    companionBusy = false;
  }
});

app.listen(PORT, () => {
  console.log(`Companion server listening on :${PORT}`);
  // Warm both models in the background so the first reaction isn't a cold load.
  void warmModel();
  void warmTts();
});
