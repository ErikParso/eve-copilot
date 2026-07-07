// Local neural text-to-speech with Kokoro (82M, ONNX) via kokoro-js. Runs on CPU,
// offline, no API key. The model is downloaded once and cached; loaded lazily.
// Returns a WAV buffer the browser plays via <audio>.
//
// Config via env:
//   COMPANION_TTS   set to "off" to disable
//   KOKORO_MODEL    default onnx-community/Kokoro-82M-v1.0-ONNX
//   KOKORO_VOICE    default af_heart (female, top-graded)
//   KOKORO_DTYPE    default q4 (fp32|fp16|q8|q4|q4f16) — q4 is ~2x faster than q8 on CPU
import type { KokoroTTS } from 'kokoro-js';

const MODEL_ID = process.env.KOKORO_MODEL ?? 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = (process.env.KOKORO_DTYPE ?? 'q4') as 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

type VoiceId = NonNullable<NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']>;
const VOICE = (process.env.KOKORO_VOICE ?? 'af_heart') as VoiceId;

export function isTtsEnabled(): boolean {
  return process.env.COMPANION_TTS !== 'off';
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/** kokoro-js resolves its bundled voice files against a `__dirname` (falling back
 * to `import.meta.dirname`), then reads `../voices/<voice>.bin`. That `__dirname`
 * is wrong in two environments: undefined on Node < 20.11, and — worse — leaked as
 * the CWD by `node -e` (our build-time bake), which resolves to a bogus
 * `<cwd>/../voices`. So we OVERRIDE a global `__dirname` to point at the package's
 * real dist dir every time, before kokoro-js is imported. */
async function shimDirnameForKokoro(): Promise<void> {
  const { createRequire } = await import('module');
  const { dirname } = await import('path');
  const require = createRequire(import.meta.url);
  (globalThis as { __dirname?: string }).__dirname = dirname(require.resolve('kokoro-js'));
}

function loadTts(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      await shimDirnameForKokoro();
      const { KokoroTTS } = await import('kokoro-js');
      console.log(`[TTS] loading Kokoro (${MODEL_ID}, dtype=${DTYPE})…`);
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE });
      console.log('[TTS] Kokoro ready.');
      return tts;
    })().catch((err) => {
      ttsPromise = null; // let the next request retry (e.g. after a failed download)
      throw err;
    });
  }
  return ttsPromise;
}

/** Synthesize `text` to a WAV buffer with the local Kokoro model. */
export async function synthesize(text: string): Promise<Buffer> {
  const tts = await loadTts();
  const audio = await tts.generate(text, { voice: VOICE });
  return Buffer.from(audio.toWav());
}

/** Load the Kokoro model at boot (a real synth) so the first user reaction doesn't
 * pay the cold load. Best-effort; no-op when disabled. */
export async function warmTts(): Promise<void> {
  if (!isTtsEnabled()) return;
  try {
    await synthesize('ready');
    console.log('[TTS] Kokoro warm (loaded).');
  } catch (err) {
    console.error('[TTS] warm failed', err);
  }
}
