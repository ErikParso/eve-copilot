// Companion text-to-speech via Microsoft Edge's online neural voices (msedge-tts).
// It's free, needs no API key, and streams MP3 from Microsoft's cloud — so nothing
// heavy runs locally and there are no metered credits to deplete. Rate-limited by MS
// but effectively unlimited for a personal companion.
//
// Returns { buffer, mime } — the MP3 bytes and their MIME type — which the browser
// plays via <audio>. (MIME is threaded end-to-end so playback isn't hardcoded to WAV.)
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export interface SpeechResult {
  buffer: Buffer;
  /** MIME type of the audio. Edge TTS returns MP3. */
  mime: string;
}

// Any Edge neural voice ShortName. Vivienne is a French multilingual voice — she
// speaks the English lines with a French accent. Swap here to audition others
// (e.g. en-US-EmmaMultilingualNeural, en-US-AvaNeural, fr-FR-RemyMultilingualNeural).
const VOICE = 'fr-FR-VivienneMultilingualNeural';

export function isTtsEnabled(): boolean {
  return process.env.COMPANION_TTS !== 'off';
}

/** Synthesize `text` to an MP3 buffer via Edge TTS. A fresh client per call keeps the
 * WebSocket from going stale between reactions. Throws on transport failure. */
export async function synthesizeSpeech(text: string): Promise<SpeechResult> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(chunk as Buffer);
    return { buffer: Buffer.concat(chunks), mime: 'audio/mpeg' };
  } finally {
    tts.close();
  }
}

/** Best-effort warm ping at boot so the first real reaction is snappy. Returns the
 * voice label on success, or null if disabled/failed (the caller logs one warm line). */
export async function warmTts(): Promise<string | null> {
  if (!isTtsEnabled()) return null;
  try {
    await synthesizeSpeech('ready');
    return VOICE;
  } catch {
    return null;
  }
}
