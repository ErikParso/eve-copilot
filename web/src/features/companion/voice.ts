// Browser text-to-speech for the companion's lines. No dependencies — the Web
// Speech API ships in all target browsers. Best-effort: silently no-ops where
// SpeechSynthesis is unavailable.

// Name fragments that identify a female voice across Windows / macOS / Chrome.
// (Voice names are not standardised, so we match on the known ones.)
const FEMALE_HINTS = [
  'female',
  'zira', 'hazel', 'susan', 'linda', 'heera', 'catherine', // Windows
  'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'veena', // macOS
  'google us english', 'google uk english female', 'jenny', 'aria', 'michelle', 'eva',
];

let cachedVoice: SpeechSynthesisVoice | null = null;

/** Choose an English female voice if one is available, else any female voice,
 * else the first voice. Returns null while the voice list is still loading. */
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

// Voices load asynchronously in some browsers — resolve once now and refresh when
// the list arrives.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  cachedVoice = pickFemaleVoice();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = pickFemaleVoice() ?? cachedVoice;
  });
}

export function speak(text: string): void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return;
  // Drop anything queued/in-flight so voice never lags behind the panel when
  // reactions arrive back-to-back.
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

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
