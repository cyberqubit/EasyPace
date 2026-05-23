/** Voice I/O via the Web Speech API — zero-cost, no keys. */

// ── Text-to-speech (Sage speaks) ───────────────────────────────
export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(text: string): void {
  if (!speechSupported) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.85; // slightly slower — recommended for older adults
  u.pitch = 1;
  u.volume = 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported) window.speechSynthesis.cancel();
}

// ── Speech-to-text (the senior talks) ──────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const SRClass: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;

export const sttSupported = !!SRClass;

/** Listen once and resolve with the transcript. Rejects with 'no-speech' | 'not-supported' | error. */
export function listen(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!SRClass) return reject(new Error('not-supported'));
    const rec = new SRClass();
    rec.lang = 'en-CA';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let settled = false;
    rec.onresult = (e: any) => {
      settled = true;
      resolve(String(e.results[0][0].transcript).trim());
    };
    rec.onerror = (e: any) => {
      if (!settled) reject(new Error(e.error || 'speech-error'));
    };
    rec.onend = () => {
      if (!settled) reject(new Error('no-speech'));
    };
    rec.start();
  });
}
