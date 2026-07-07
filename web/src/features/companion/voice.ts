// Companion voice. The reaction request already returns the spoken audio (natural
// Kokoro voice, base64 WAV) alongside the text, so we just play it via <audio> —
// which, unlike speechSynthesis, keeps playing in background / unfocused tabs.
// Fallback: None. Only play server-provided Kokoro audio.
//
// We also expose a "speaking" signal (pub/sub) so UI — the reactor orb — can
// animate a talking state.

let currentAudio: HTMLAudioElement | null = null;

// ── Speaking state (for the orb) ─────────────────────────────────────────────
type SpeakingListener = (speaking: boolean) => void;
const speakingListeners = new Set<SpeakingListener>();
let speaking = false;

function setSpeaking(value: boolean): void {
  if (speaking === value) return;
  speaking = value;
  for (const l of speakingListeners) l(value);
}

export function isSpeaking(): boolean {
  return speaking;
}

/** Subscribe to talking on/off. Fires immediately with the current value. */
export function onSpeakingChange(listener: SpeakingListener): () => void {
  speakingListeners.add(listener);
  listener(speaking);
  return () => speakingListeners.delete(listener);
}

// ── Playback ─────────────────────────────────────────────────────────────────

/** Speak the companion's line: play the server-provided audio (WAV/FLAC/MP3). */
export function playVoice(audioBase64: string | null, mime = 'audio/wav'): void {
  stopSpeaking();
  if (audioBase64) {
    try {
      const audio = new Audio(`data:${mime};base64,${audioBase64}`);
      currentAudio = audio;
      const done = () => {
        if (currentAudio === audio) currentAudio = null;
        setSpeaking(false);
      };
      audio.onplay = () => setSpeaking(true);
      audio.onended = done;
      audio.onerror = () => {
        done();
        console.error('[Companion] Failed to play audio element');
      };
      void audio.play().catch((err) => {
        setSpeaking(false);
        console.error('[Companion] Audio playback blocked or failed:', err);
      });
      return;
    } catch (err) {
      console.error('[Companion] Error initializing audio:', err);
    }
  } else {
    console.warn('[Companion] No audio returned by backend');
  }
}

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  setSpeaking(false);
}
