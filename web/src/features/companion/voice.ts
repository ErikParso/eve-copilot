// Companion voice. The reaction request already returns the spoken audio (natural
// Kokoro voice, base64 WAV) alongside the text, so we just play it via <audio> —
// which, unlike speechSynthesis, keeps playing in background / unfocused tabs.
// Fallback: the browser's built-in speechSynthesis when no audio was returned
// (TTS disabled server-side or synthesis failed).

let currentAudio: HTMLAudioElement | null = null;

/** Speak the companion's line: prefer the server-provided audio, else the browser. */
export function playVoice(text: string, audioBase64: string | null): void {
  stopSpeaking();
  if (audioBase64) {
    try {
      const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
      currentAudio = audio;
      const done = () => {
        if (currentAudio === audio) currentAudio = null;
      };
      audio.onended = done;
      audio.onerror = () => {
        done();
        speakViaBrowser(text);
      };
      void audio.play().catch(() => speakViaBrowser(text));
      return;
    } catch {
      /* fall through to the browser voice */
    }
  }
  speakViaBrowser(text);
}

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// ── Browser speechSynthesis fallback ─────────────────────────────────────────

const FEMALE_HINTS = [
  'female',
  'zira', 'hazel', 'susan', 'linda', 'heera', 'catherine',
  'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'veena',
  'google us english', 'google uk english female', 'jenny', 'aria', 'michelle', 'eva',
];

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickFemaleVoice(): SpeechSynthesisVoice | null {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const name = (v: SpeechSynthesisVoice) => v.name.toLowerCase();
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const pool = english.length ? english : voices;
  const female = pool.find((v) => FEMALE_HINTS.some((h) => name(v).includes(h)));
  return female ?? pool[0] ?? null;
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  cachedVoice = pickFemaleVoice();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = pickFemaleVoice() ?? cachedVoice;
  });
}

function speakViaBrowser(text: string): void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = cachedVoice ?? pickFemaleVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  synth.speak(utterance);
}
