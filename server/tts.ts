// Local neural text-to-speech with Kokoro (82M, ONNX) via kokoro-js. Runs on CPU,
// offline, no API key. The model (~80MB at q8) is downloaded once on first use and
// cached; we load it lazily so server startup and the model download only happen if
// TTS is actually used. Returns a WAV buffer the browser plays via <audio>.
//
// Config via env:
//   COMPANION_TTS   set to "off" to disable (FE then uses the browser voice)
//   KOKORO_MODEL    default onnx-community/Kokoro-82M-v1.0-ONNX
//   KOKORO_VOICE    default af_heart (female, top-graded)
//   KOKORO_DTYPE    default q4 (fp32|fp16|q8|q4|q4f16) — q4 is ~2x faster than q8
//                   on CPU with only a small quality cost
import type { KokoroTTS } from 'kokoro-js';

const MODEL_ID = process.env.KOKORO_MODEL ?? 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = (process.env.KOKORO_DTYPE ?? 'q4') as 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

type VoiceId = NonNullable<NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']>;
const VOICE = (process.env.KOKORO_VOICE ?? 'af_heart') as VoiceId;

export function isTtsEnabled(): boolean {
  return process.env.COMPANION_TTS !== 'off';
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/** kokoro-js resolves its bundled voice files with `import.meta.dirname`, which is
 * undefined on Node < 20.11 (crashing generate() with a path.resolve error). Point
 * a global `__dirname` at the package's dist dir so `resolve(__dirname,
 * '../voices/*.bin')` works. Guarded + no-op on Node 20+ where dirname exists. */
async function shimDirnameForKokoro(): Promise<void> {
  const g = globalThis as { __dirname?: string };
  if (g.__dirname !== undefined) return;
  if ((import.meta as { dirname?: string }).dirname !== undefined) return;
  const { createRequire } = await import('module');
  const { dirname } = await import('path');
  const require = createRequire(import.meta.url);
  g.__dirname = dirname(require.resolve('kokoro-js'));
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
