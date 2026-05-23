/** Read-aloud (Web Speech API) — zero-cost, works offline for TTS. */
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
